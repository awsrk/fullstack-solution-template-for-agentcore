import * as cdk from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as logs from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"
import * as path from "path"

/**
 * Properties for the VPC Test Service Stack.
 * 
 * This stack creates a test service in a separate VPC that is accessible
 * via AWS PrivateLink for testing VPC connectivity from AgentCore Runtime.
 */
export interface VpcTestServiceStackProps extends cdk.NestedStackProps {
  /**
   * Application configuration containing stack naming and settings.
   */
  config: AppConfig
}

/**
 * VPC Test Service Stack
 * 
 * This nested stack deploys a simple HTTP test service in a private VPC
 * that is exposed via AWS PrivateLink. The service is used to verify that
 * the AgentCore Runtime can successfully reach private VPC resources through
 * VPC endpoints.
 * 
 * Architecture:
 * - Test Service VPC (10.1.0.0/16) with private subnets in 2 AZs
 * - Lambda function with Function URL serving HTTPS requests
 * - Internal Network Load Balancer targeting the Lambda Function URL
 * - VPC Endpoint Service backed by the NLB
 * - SSM parameter storing the endpoint service DNS name
 * 
 * This architecture mimics Snowflake's PrivateLink pattern where customers
 * connect to Snowflake services through a PrivateLink endpoint backed by NLB.
 * 
 * The service is completely private (no internet access) and only accessible
 * via PrivateLink connections from other VPCs.
 */
export class VpcTestServiceStack extends cdk.NestedStack {
  /**
   * The name of the VPC Endpoint Service.
   * This is used to create VPC endpoints in other VPCs.
   */
  public readonly endpointServiceName: string
  
  /**
   * The DNS name of the VPC Endpoint Service.
   * This is the endpoint that clients will connect to.
   */
  public readonly endpointServiceDnsName: string

  constructor(scope: Construct, id: string, props: VpcTestServiceStackProps) {
    super(scope, id, props)

    // Create the Test Service VPC
    const vpc = this.createTestServiceVpc(props.config)

    // Create the Lambda function for the test service
    const testServiceLambda = this.createTestServiceLambda(props.config)

    // Create the Network Load Balancer (actually ALB for Lambda support)
    const alb = this.createNetworkLoadBalancer(
      vpc,
      testServiceLambda,
      props.config
    )

    // Create the VPC Endpoint Service
    const endpointService = this.createVpcEndpointService(alb, props.config)

    // Store the endpoint service name and DNS
    this.endpointServiceName = endpointService.vpcEndpointServiceName
    this.endpointServiceDnsName = endpointService.vpcEndpointServiceName

    // Store endpoint service DNS in SSM for runtime lookup
    this.createSsmParameters(endpointService, props.config)

    // Create CloudFormation outputs
    this.createOutputs(vpc, alb, endpointService, props.config)
  }

  /**
   * Creates the Test Service VPC with private subnets.
   * 
   * The VPC is configured with:
   * - CIDR: 10.1.0.0/16
   * - 2 private subnets across 2 availability zones
   * - No NAT Gateway (service doesn't need internet access)
   * - No Internet Gateway (fully private)
   * - VPC Endpoints for Lambda service (required for ALB to invoke Lambda)
   * 
   * @param config - Application configuration
   * @returns The created VPC
   */
  private createTestServiceVpc(config: AppConfig): ec2.Vpc {
    const vpc = new ec2.Vpc(this, "TestServiceVpc", {
      vpcName: `${config.stack_name_base}-test-service-vpc`,
      ipAddresses: ec2.IpAddresses.cidr("10.1.0.0/16"),
      maxAzs: 2,
      natGateways: 0, // No NAT Gateway needed for private-only service
      subnetConfiguration: [
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    })

    // Add VPC endpoint for Lambda service
    // This is required for ALB in private subnets to invoke Lambda functions
    vpc.addInterfaceEndpoint("LambdaEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    })

    // Tag the VPC for identification
    cdk.Tags.of(vpc).add("Name", `${config.stack_name_base}-test-service-vpc`)
    cdk.Tags.of(vpc).add("Purpose", "VPC connectivity testing")

    return vpc
  }

  /**
   * Creates the Lambda function for the test service.
   * 
   * The Lambda function serves HTTPS requests and returns a simple JSON response
   * with service identification information. It uses a Lambda Function URL to
   * receive traffic from the Network Load Balancer.
   * 
   * @param config - Application configuration
   * @returns The created Lambda function
   */
  private createTestServiceLambda(config: AppConfig): lambda.Function {
    const testServiceLambda = new lambda.Function(this, "TestServiceLambda", {
      functionName: `${config.stack_name_base}-vpc-test-service`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "vpc-test-service")
      ),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description: "VPC connectivity test service - mimics Snowflake PrivateLink pattern",
      logGroup: new logs.LogGroup(this, "TestServiceLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-vpc-test-service`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Create Lambda Function URL for NLB target
    const functionUrl = testServiceLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
    })

    // Output the Function URL for reference
    new cdk.CfnOutput(this, "TestServiceFunctionUrl", {
      value: functionUrl.url,
      description: "Lambda Function URL for the test service",
    })

    return testServiceLambda
  }

  /**
   * Creates an internal Application Load Balancer targeting the Lambda function.
   * 
   * Note: Changed from NLB to ALB because NLB does not support Lambda targets.
   * ALB supports Lambda targets and works with VPC Endpoint Services for PrivateLink.
   * 
   * The ALB is configured as:
   * - Internal (not internet-facing)
   * - Deployed in private subnets across 2 AZs
   * - Target: Lambda function (direct Lambda target)
   * - Listener: Port 443 with HTTP protocol
   * 
   * @param vpc - The VPC to deploy the ALB in
   * @param testServiceLambda - The Lambda function to target
   * @param config - Application configuration
   * @returns The created Application Load Balancer
   */
  private createNetworkLoadBalancer(
    vpc: ec2.Vpc,
    testServiceLambda: lambda.Function,
    config: AppConfig
  ): elbv2.ApplicationLoadBalancer {
    // Create the Application Load Balancer (ALB supports Lambda targets)
    const alb = new elbv2.ApplicationLoadBalancer(this, "TestServiceAlb", {
      loadBalancerName: `${config.stack_name_base}-test-svc-alb`,
      vpc: vpc,
      internetFacing: false, // Internal ALB for PrivateLink
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    })

    // Create Lambda target group for ALB
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TestServiceTargetGroup", {
      targetGroupName: `${config.stack_name_base}-test-svc-tg`,
      targetType: elbv2.TargetType.LAMBDA,
      targets: [new targets.LambdaTarget(testServiceLambda)],
    })

    // Add listener on port 443 for HTTP traffic
    alb.addListener("TestServiceListener", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    })

    return alb
  }

  /**
   * Creates a VPC Endpoint Service backed by the Application Load Balancer.
   * 
   * The VPC Endpoint Service allows other VPCs to connect to this service
   * via AWS PrivateLink. This mimics how Snowflake exposes their service
   * through PrivateLink.
   * 
   * Configuration:
   * - Auto-accept connection requests (no manual approval needed)
   * - Allow connections from any AWS principal (for testing)
   * 
   * Note: In production, you should restrict allowed principals and
   * require acceptance for security.
   * 
   * @param alb - The Application Load Balancer to back the endpoint service
   * @param config - Application configuration
   * @returns The created VPC Endpoint Service
   */
  private createVpcEndpointService(
    alb: elbv2.ApplicationLoadBalancer,
    config: AppConfig
  ): ec2.VpcEndpointService {
    const endpointService = new ec2.VpcEndpointService(this, "TestServiceEndpoint", {
      vpcEndpointServiceLoadBalancers: [alb],
      acceptanceRequired: false, // Auto-accept connections for testing
      // Note: In production, you would want to restrict allowed principals
      // and require acceptance for security
    })

    // Tag the endpoint service
    cdk.Tags.of(endpointService).add(
      "Name",
      `${config.stack_name_base}-test-service-endpoint`
    )

    return endpointService
  }

  /**
   * Creates SSM parameters to store the VPC Endpoint Service information.
   * 
   * The endpoint service name is stored in SSM Parameter Store so that
   * the VPC connectivity tool can dynamically discover the endpoint to test.
   * 
   * @param endpointService - The VPC Endpoint Service
   * @param config - Application configuration
   */
  private createSsmParameters(
    endpointService: ec2.VpcEndpointService,
    config: AppConfig
  ): void {
    new ssm.StringParameter(this, "EndpointServiceNameParam", {
      parameterName: `/${config.stack_name_base}/vpc_test_service_endpoint`,
      stringValue: endpointService.vpcEndpointServiceName,
      description: "VPC Endpoint Service name for connectivity testing",
    })
  }

  /**
   * Creates CloudFormation outputs for the stack.
   * 
   * Outputs include:
   * - VPC ID
   * - ALB ARN
   * - VPC Endpoint Service name
   * - VPC Endpoint Service DNS name
   * 
   * @param vpc - The Test Service VPC
   * @param alb - The Application Load Balancer
   * @param endpointService - The VPC Endpoint Service
   * @param config - Application configuration
   */
  private createOutputs(
    vpc: ec2.Vpc,
    alb: elbv2.ApplicationLoadBalancer,
    endpointService: ec2.VpcEndpointService,
    config: AppConfig
  ): void {
    new cdk.CfnOutput(this, "TestServiceVpcId", {
      value: vpc.vpcId,
      description: "VPC ID of the Test Service VPC",
      exportName: `${config.stack_name_base}-TestServiceVpcId`,
    })

    new cdk.CfnOutput(this, "TestServiceAlbArn", {
      value: alb.loadBalancerArn,
      description: "ARN of the Test Service Application Load Balancer",
      exportName: `${config.stack_name_base}-TestServiceAlbArn`,
    })

    new cdk.CfnOutput(this, "EndpointServiceName", {
      value: endpointService.vpcEndpointServiceName,
      description: "VPC Endpoint Service name for connectivity testing",
      exportName: `${config.stack_name_base}-EndpointServiceName`,
    })

    new cdk.CfnOutput(this, "EndpointServiceDnsName", {
      value: endpointService.vpcEndpointServiceName,
      description: "DNS name for the VPC Endpoint Service",
    })
  }
}

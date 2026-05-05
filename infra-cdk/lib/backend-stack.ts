import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha"
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore"
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"
import * as cr from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"
import { AgentCoreRole } from "./utils/agentcore-role"
import * as path from "path"
import * as fs from "fs"

export interface BackendStackProps extends cdk.NestedStackProps {
  config: AppConfig
  userPoolId: string
  userPoolClientId: string
  userPoolDomain: cognito.UserPoolDomain
  frontendUrl: string
  vpcTestServiceEndpointName?: string
}

export class BackendStack extends cdk.NestedStack {
  public readonly userPoolId: string
  public readonly userPoolClientId: string
  public readonly userPoolDomain: cognito.UserPoolDomain
  public feedbackApiUrl: string
  public runtimeArn: string
  public memoryArn: string
  private agentName: cdk.CfnParameter
  private userPool: cognito.IUserPool
  private machineClient: cognito.UserPoolClient
  private machineClientSecret: secretsmanager.Secret
  private runtimeCredentialProvider: cdk.CustomResource
  private agentRuntime: agentcore.Runtime
  private vpc?: ec2.IVpc
  private vpcEndpoint?: ec2.InterfaceVpcEndpoint
  private memoryId: string

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    // Store the Cognito values
    this.userPoolId = props.userPoolId
    this.userPoolClientId = props.userPoolClientId
    this.userPoolDomain = props.userPoolDomain

    // Import the Cognito resources from the other stack
    this.userPool = cognito.UserPool.fromUserPoolId(
      this,
      "ImportedUserPoolForBackend",
      props.userPoolId
    )
    // then create the user pool client
    cognito.UserPoolClient.fromUserPoolClientId(
      this,
      "ImportedUserPoolClient",
      props.userPoolClientId
    )

    // Create Machine-to-Machine authentication components
    this.createMachineAuthentication(props.config)

    // DEPLOYMENT ORDER EXPLANATION:
    // 1. Cognito User Pool & Client (created in separate CognitoStack)
    // 2. Machine Client & Resource Server (created above for M2M auth)
    // 3. AgentCore Runtime (created next - creates the Memory resource and sets this.memoryId)
    // 4. AgentCore Gateway (created after Runtime - broker_memory Lambda needs MEMORY_ID env var)

    // Create AgentCore Runtime resources first so this.memoryId is available for Gateway Lambdas
    this.createAgentCoreRuntime(props.config, props)

    // Create AgentCore Gateway (after Runtime so broker_memory Lambda gets MEMORY_ID)
    this.createAgentCoreGateway(props.config)

    // Store runtime ARN in SSM for frontend stack
    this.createRuntimeSSMParameters(props.config)

    // Store Cognito configuration in SSM for testing and frontend
    this.createCognitoSSMParameters(props.config)

    // Create Feedback DynamoDB table (example of application data storage)
    const feedbackTable = this.createFeedbackTable(props.config)

    // Create TokenMetrics DynamoDB table for conversation metrics tracking
    const tokenMetricsTable = this.createTokenMetricsTable(props.config)

    // Create API Gateway Feedback API resources (example of best-practice API Gateway + Lambda
    // pattern)
    const api = this.createFeedbackApi(props.config, props.frontendUrl, feedbackTable)

    // Create Metrics Lambda and add endpoints to the same API Gateway
    this.createMetricsApi(props.config, api, tokenMetricsTable)
  }

  /**
   * Creates or imports a VPC for the AgentCore Runtime.
   * 
   * If vpc_id is provided in config, imports the existing VPC.
   * Otherwise, creates a new VPC with the specified CIDR block.
   * 
   * The VPC is configured with:
   * - 2 availability zones for high availability
   * - Private subnets with NAT Gateway for outbound internet access
   * - Public subnets for NAT Gateway placement
   * - DNS hostnames and DNS support enabled for VPC endpoints
   * 
   * @param config - Application configuration containing VPC settings
   * @returns The VPC to use for the AgentCore Runtime
   */
  private createOrImportVpc(config: AppConfig): ec2.IVpc {
    const vpcConfig = config.backend.vpc

    if (!vpcConfig || !vpcConfig.vpc_id) {
      throw new Error("VPC configuration with vpc_id is required when network_mode is VPC")
    }

    return ec2.Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: vpcConfig.vpc_id,
    })
  }

  /**
   * Creates security groups for the AgentCore Runtime and VPC endpoint.
   * 
   * Runtime Security Group:
   * - Allows outbound HTTPS (443) to AWS services (SSM, Bedrock, etc.)
   * - Allows outbound HTTP (80) to VPC endpoint for test service
   * 
   * VPC Endpoint Security Group:
   * - Allows inbound HTTP (80) from Runtime security group
   * 
   * @param vpc - The VPC to create security groups in
   * @param config - Application configuration
   * @returns Object containing the runtime and endpoint security groups
   */
  private createSecurityGroups(
    vpc: ec2.IVpc,
    config: AppConfig
  ): { runtimeSg: ec2.SecurityGroup; endpointSg: ec2.SecurityGroup } {
    // Security group for AgentCore Runtime
    const runtimeSg = new ec2.SecurityGroup(this, "RuntimeSecurityGroup", {
      vpc: vpc,
      securityGroupName: `${config.stack_name_base}-runtime-sg`,
      description: "Security group for AgentCore Runtime",
      allowAllOutbound: false, // We'll add specific rules
    })

    // Allow outbound HTTPS to AWS services (SSM, Bedrock, etc.)
    runtimeSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS to AWS services"
    )

    // Security group for VPC endpoint
    const endpointSg = new ec2.SecurityGroup(this, "EndpointSecurityGroup", {
      vpc: vpc,
      securityGroupName: `${config.stack_name_base}-endpoint-sg`,
      description: "Security group for VPC endpoint to test service",
      allowAllOutbound: false,
    })

    // Allow inbound HTTP from Runtime to VPC endpoint
    endpointSg.addIngressRule(
      runtimeSg,
      ec2.Port.tcp(80),
      "Allow HTTP from AgentCore Runtime"
    )

    // Allow outbound HTTP from Runtime to VPC endpoint
    runtimeSg.addEgressRule(
      endpointSg,
      ec2.Port.tcp(80),
      "Allow HTTP to VPC endpoint"
    )

    // Tag security groups
    cdk.Tags.of(runtimeSg).add("Name", `${config.stack_name_base}-runtime-sg`)
    cdk.Tags.of(endpointSg).add("Name", `${config.stack_name_base}-endpoint-sg`)

    return { runtimeSg, endpointSg }
  }

  /**
   * Creates a VPC endpoint (interface endpoint) to connect to the test service.
   * 
   * The VPC endpoint enables private connectivity to the test service via AWS PrivateLink.
   * It is configured with:
   * - Deployment in private subnets
   * - Security group allowing traffic from Runtime
   * - Private DNS disabled (using endpoint DNS name directly)
   * 
   * @param vpc - The VPC to create the endpoint in
   * @param endpointServiceName - The VPC Endpoint Service name to connect to
   * @param securityGroup - The security group to attach to the endpoint
   * @param config - Application configuration
   * @returns The created VPC endpoint
   */
  private createVpcEndpoint(
    vpc: ec2.IVpc,
    endpointServiceName: string,
    securityGroup: ec2.SecurityGroup,
    config: AppConfig
  ): ec2.InterfaceVpcEndpoint {
    const vpcEndpoint = new ec2.InterfaceVpcEndpoint(this, "TestServiceVpcEndpoint", {
      vpc: vpc,
      service: new ec2.InterfaceVpcEndpointService(endpointServiceName),
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [securityGroup],
      privateDnsEnabled: false, // We'll use the endpoint DNS name directly
    })

    // Tag the VPC endpoint
    cdk.Tags.of(vpcEndpoint).add(
      "Name",
      `${config.stack_name_base}-test-service-endpoint`
    )

    // Store the VPC endpoint URL in SSM for the VPC connectivity tool
    // The tool will use this to make HTTP requests to the test service
    // The DNS name is in the format: vpce-xxxxx.vpce-svc-xxxxx.region.vpce.amazonaws.com
    // We construct the full HTTP URL for the tool to use
    const endpointUrl = `http://${vpcEndpoint.vpcEndpointDnsEntries[0]}`
    new ssm.StringParameter(this, "VpcTestEndpointUrlParam", {
      parameterName: `/${config.stack_name_base}/vpc_test_endpoint_url`,
      stringValue: endpointUrl,
      description: "VPC endpoint URL for connectivity testing (HTTP)",
    })

    return vpcEndpoint
  }

  private createAgentCoreRuntime(config: AppConfig, props: BackendStackProps): void {
    const pattern = config.backend?.pattern || "strands-single-agent"

    // Parameters
    this.agentName = new cdk.CfnParameter(this, "AgentName", {
      type: "String",
      default: "FASTAgent",
      description: "Name for the agent runtime",
    })

    const stack = cdk.Stack.of(this)
    const deploymentType = config.backend.deployment_type

    // Create the agent runtime artifact based on deployment type
    let agentRuntimeArtifact: agentcore.AgentRuntimeArtifact
    let zipPackagerResource: cdk.CustomResource | undefined
    let contentHash: string | undefined

    if (
      deploymentType === "zip" &&
      (pattern === "claude-agent-sdk-single-agent" || pattern === "claude-agent-sdk-multi-agent")
    ) {
      throw new Error(
        "claude-agent-sdk patterns require Docker deployment (deployment_type: docker) " +
          "because they need Node.js and the claude-code CLI installed at build time."
      )
    }

    if (deploymentType === "zip") {
      // ZIP DEPLOYMENT: Use Lambda to package and upload to S3 (no Docker required)
      const repoRoot = path.resolve(__dirname, "..", "..") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const patternDir = path.join(repoRoot, "patterns", pattern) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

      // Create S3 bucket for agent code
      const agentCodeBucket = new s3.Bucket(this, "AgentCodeBucket", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        versioned: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      })

      // Lambda to package agent code
      const packagerLambda = new lambda.Function(this, "ZipPackagerLambda", {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas", "zip-packager")), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        timeout: cdk.Duration.minutes(10),
        memorySize: 1024,
        ephemeralStorageSize: cdk.Size.gibibytes(2),
      })

      agentCodeBucket.grantReadWrite(packagerLambda)

      // Read agent code files and encode as base64
      const agentCode: Record<string, string> = {}

      // Read pattern .py files
      for (const file of fs.readdirSync(patternDir)) {
        if (file.endsWith(".py")) {
          const content = fs.readFileSync(path.join(patternDir, file)) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
          agentCode[file] = content.toString("base64")
        }
      }

      // Read pattern-local subdirectories first (e.g. tools/, utils/ inside the pattern dir)
      // These take priority over top-level shared modules to allow per-pattern overrides.
      for (const entry of fs.readdirSync(patternDir)) {
        const fullPath = path.join(patternDir, entry) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        if (fs.statSync(fullPath).isDirectory()) {
          this.readDirRecursive(fullPath, entry, agentCode)
        }
      }

      // Read shared top-level modules (gateway/, tools/), skipping any keys already set
      // by pattern-local directories above.
      for (const module of ["gateway", "tools"]) {
        const moduleDir = path.join(repoRoot, module) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        if (fs.existsSync(moduleDir)) {
          const shared: Record<string, string> = {}
          this.readDirRecursive(moduleDir, module, shared)
          for (const [key, value] of Object.entries(shared)) {
            if (!(key in agentCode)) {
              agentCode[key] = value
            }
          }
        }
      }

      // Read patterns/utils module (shared utilities for agents)
      const utilsDir = path.join(repoRoot, "patterns", "utils")
      if (fs.existsSync(utilsDir)) {
        this.readDirRecursive(utilsDir, "utils", agentCode)
      }

      // Read requirements
      const requirementsPath = path.join(patternDir, "requirements.txt") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const requirements = fs
        .readFileSync(requirementsPath, "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#"))

      // Create hash for change detection
      // We use this to trigger update when content changes
      contentHash = this.hashContent(JSON.stringify({ requirements, agentCode }))

      // Custom Resource to trigger packaging
      const provider = new cr.Provider(this, "ZipPackagerProvider", {
        onEventHandler: packagerLambda,
      })

      zipPackagerResource = new cdk.CustomResource(this, "ZipPackager", {
        serviceToken: provider.serviceToken,
        properties: {
          BucketName: agentCodeBucket.bucketName,
          ObjectKey: "deployment_package.zip",
          Requirements: requirements,
          AgentCode: agentCode,
          ContentHash: contentHash,
        },
      })

      // Store bucket name in SSM for updates
      new ssm.StringParameter(this, "AgentCodeBucketNameParam", {
        parameterName: `/${config.stack_name_base}/agent-code-bucket`,
        stringValue: agentCodeBucket.bucketName,
        description: "S3 bucket for agent code deployment packages",
      })

      agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromS3(
        {
          bucketName: agentCodeBucket.bucketName,
          objectKey: "deployment_package.zip",
        },
        agentcore.AgentCoreRuntime.PYTHON_3_12,
        ["opentelemetry-instrument", "basic_agent.py"]
      )
    } else {
      // DOCKER DEPLOYMENT: Use container-based deployment
      agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
        path.resolve(__dirname, "..", ".."), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        {
          platform: ecr_assets.Platform.LINUX_ARM64,
          file: `patterns/${pattern}/Dockerfile`,
        }
      )
    }

    // Configure network mode based on config.yaml settings.
    // PUBLIC: Runtime is accessible over the public internet (default).
    // VPC: Runtime is deployed into a user-provided VPC for private network isolation.
    //      The user must ensure their VPC has the necessary VPC endpoints for AWS services.
    //      See docs/DEPLOYMENT.md for the full list of required VPC endpoints.
    const networkConfiguration = this.buildNetworkConfiguration(config)

    // Configure JWT authorizer with Cognito
    const authorizerConfiguration = agentcore.RuntimeAuthorizerConfiguration.usingJWT(
      `https://cognito-idp.${stack.region}.amazonaws.com/${this.userPoolId}/.well-known/openid-configuration`,
      [this.userPoolClientId]
    )

    // Create AgentCore execution role
    const agentRole = new AgentCoreRole(this, "AgentCoreRole")

    // Create memory resource with short-term memory (conversation history) as default
    // To enable long-term strategies (summaries, preferences, facts), see docs/MEMORY_INTEGRATION.md
    const memory = new cdk.CfnResource(this, "AgentMemory", {
      type: "AWS::BedrockAgentCore::Memory",
      properties: {
        Name: cdk.Names.uniqueResourceName(this, { maxLength: 48 }),
        EventExpiryDuration: 30,
        Description: `Short-term memory for ${config.stack_name_base} agent`,
        MemoryStrategies: [
          {
            // Extracts and stores factual information shared by the user across sessions.
            // Stored under /facts/{actorId} — retrieved on each turn to personalise responses.
            SemanticMemoryStrategy: {
              Name: "FactExtractor",
              Namespaces: ["/facts/{actorId}"],
            },
          },
          {
            // Captures user preferences (risk tolerance, investment style, etc.) across sessions.
            // Used by broker_memory tools to personalise market analysis per broker.
            UserPreferenceMemoryStrategy: {
              Name: "BrokerPreferences",
              Namespaces: ["/preferences/{actorId}"],
            },
          },
        ],
        MemoryExecutionRoleArn: agentRole.roleArn,
        Tags: {
          Name: `${config.stack_name_base}_Memory`,
          ManagedBy: "CDK",
        },
      },
    })
    const memoryId = memory.getAtt("MemoryId").toString()
    const memoryArn = memory.getAtt("MemoryArn").toString()

    // Store the memory ARN and ID for access from other methods
    this.memoryArn = memoryArn
    this.memoryId = memoryId

    // Add memory-specific permissions to agent role
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "MemoryResourceAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords", // Only needed for long-term strategies
        ],
        resources: [memoryArn],
      })
    )

    // Add SSM permissions for AgentCore Gateway URL lookup
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SSMParameterAccess",
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      })
    )

    // Add Code Interpreter permissions
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CodeInterpreterAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
        ],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:aws:code-interpreter/*`],
      })
    )

    // Add Browser Tool permissions (AgentCore managed browser for web scraping)
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BrowserToolAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:GetBrowserSession",
          "bedrock-agentcore:StartBrowserSession",
          "bedrock-agentcore:StopBrowserSession",
          "bedrock-agentcore:CreateBrowserSession",
          "bedrock-agentcore:DeleteBrowserSession",
          "bedrock-agentcore:ConnectBrowserAutomationStream",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser-custom/*`,
          "arn:aws:bedrock-agentcore:*:aws:browser/*",
        ],
      })
    )

    // Add OAuth2 Credential Provider access for AgentCore Runtime
    // The @requires_access_token decorator performs a two-stage process:
    // 1. GetOauth2CredentialProvider - Looks up provider metadata (ARN, vendor config, grant types)
    // 2. GetResourceOauth2Token - Uses metadata to fetch the actual access token from Token Vault
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "OAuth2CredentialProviderAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:GetOauth2CredentialProvider",
          "bedrock-agentcore:GetResourceOauth2Token",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:oauth2-credential-provider/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/*`,
        ],
      })
    )

    // Add Secrets Manager access for OAuth2
    // AgentCore Runtime needs to read two secrets:
    // 1. Machine client secret (created by CDK)
    // 2. Token Vault OAuth2 secret (created by AgentCore Identity)
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SecretsManagerOAuth2Access",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${config.stack_name_base}/machine_client_secret*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/${config.stack_name_base}-runtime-gateway-auth*`,
        ],
      })
    )

    // Environment variables for the runtime
    const envVars: { [key: string]: string } = {
      AWS_REGION: stack.region,
      AWS_DEFAULT_REGION: stack.region,
      MEMORY_ID: memoryId,
      STACK_NAME: config.stack_name_base,
      GATEWAY_CREDENTIAL_PROVIDER_NAME: `${config.stack_name_base}-runtime-gateway-auth`, // Used by @requires_access_token decorator to look up the correct provider
      // Controls whether the agent activates long-term semantic memory retrieval.
      // The memory resource always includes the SemanticMemoryStrategy (no cost to define it),
      // but retrieval is only performed when this is "true". See config.yaml: use_long_term_memory.
      USE_LONG_TERM_MEMORY: config.backend.use_long_term_memory ? "true" : "false",
      // Retrieval tuning for long-term memory. Only used when USE_LONG_TERM_MEMORY is "true".
      // See config.yaml: ltm_top_k and ltm_relevance_score.
      LTM_TOP_K: String(config.backend.ltm_top_k),
      LTM_RELEVANCE_SCORE: String(config.backend.ltm_relevance_score),
    }

    // Add claude-agent-sdk specific environment variable
    if (pattern === "claude-agent-sdk-single-agent" || pattern === "claude-agent-sdk-multi-agent") {
      envVars["CLAUDE_CODE_USE_BEDROCK"] = "1"
    }
    
    // For ZIP deployment, add content hash to force runtime updates when code changes
    if (contentHash) {
      envVars.DEPLOYMENT_HASH = contentHash
    }

    // Create the runtime using L2 construct
    // requestHeaderConfiguration allows the agent to read the Authorization header
    // from RequestContext.request_headers, which is needed to securely extract the
    // user ID from the validated JWT token (sub claim) instead of trusting the payload body.
    // The runtimeName includes a content hash suffix so code changes force a replacement
    // rather than an in-place update (the AgentCore CFN handler fails on in-place updates).
    const runtimeNameSuffix = contentHash ? `_${contentHash.slice(0, 8)}` : ""
    this.agentRuntime = new agentcore.Runtime(this, "Runtime", {
      runtimeName: `${config.stack_name_base.replace(/-/g, "_")}_${this.agentName.valueAsString}${runtimeNameSuffix}`,
      agentRuntimeArtifact: agentRuntimeArtifact,
      executionRole: agentRole,
      networkConfiguration: networkConfiguration,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      environmentVariables: envVars,
      authorizerConfiguration: authorizerConfiguration,
      requestHeaderConfiguration: {
        allowlistedHeaders: ["Authorization"],
      },
      description: `${pattern} agent runtime for ${config.stack_name_base}`,
    })

    // AGUI protocol override — CloudFormation doesn't support AGUI enum yet
    // (only MCP | HTTP | A2A). Runtime deploys as HTTP, which also works properly.
    // if (pattern.startsWith("agui-")) {
    //   const cfnRuntime = this.agentRuntime.node.defaultChild as cdk.CfnResource
    //   cfnRuntime.addPropertyOverride("ProtocolConfiguration", "AGUI")
    // }

    // Make sure that ZIP is uploaded before Runtime is created
    if (zipPackagerResource) {
      this.agentRuntime.node.addDependency(zipPackagerResource)
    }

    // Store the runtime ARN
    this.runtimeArn = this.agentRuntime.agentRuntimeArn

    // Outputs
    new cdk.CfnOutput(this, "AgentRuntimeId", {
      description: "ID of the created agent runtime",
      value: this.agentRuntime.agentRuntimeId,
    })

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      description: "ARN of the created agent runtime",
      value: this.agentRuntime.agentRuntimeArn,
      exportName: `${config.stack_name_base}-AgentRuntimeArn`,
    })

    new cdk.CfnOutput(this, "AgentRoleArn", {
      description: "ARN of the agent execution role",
      value: agentRole.roleArn,
    })

    // Memory ARN output
    new cdk.CfnOutput(this, "MemoryArn", {
      description: "ARN of the agent memory resource",
      value: memoryArn,
    })

    // VPC outputs (if VPC is enabled)
    if (this.vpc) {
      new cdk.CfnOutput(this, "AgentCoreVpcId", {
        description: "VPC ID for AgentCore Runtime",
        value: this.vpc.vpcId,
        exportName: `${config.stack_name_base}-AgentCoreVpcId`,
      })
    }

    if (this.vpcEndpoint) {
      new cdk.CfnOutput(this, "VpcEndpointId", {
        description: "VPC Endpoint ID for test service connectivity",
        value: this.vpcEndpoint.vpcEndpointId,
        exportName: `${config.stack_name_base}-VpcEndpointId`,
      })
    }
  }

  private createRuntimeSSMParameters(config: AppConfig): void {
    // Store runtime ARN in SSM for frontend stack
    new ssm.StringParameter(this, "RuntimeArnParam", {
      parameterName: `/${config.stack_name_base}/runtime-arn`,
      stringValue: this.runtimeArn,
    })
  }

  private createCognitoSSMParameters(config: AppConfig): void {
    // Store Cognito configuration in SSM for testing and frontend access
    new ssm.StringParameter(this, "CognitoUserPoolIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-id`,
      stringValue: this.userPoolId,
      description: "Cognito User Pool ID",
    })

    new ssm.StringParameter(this, "CognitoUserPoolClientIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-client-id`,
      stringValue: this.userPoolClientId,
      description: "Cognito User Pool Client ID",
    })

    new ssm.StringParameter(this, "MachineClientIdParam", {
      parameterName: `/${config.stack_name_base}/machine_client_id`,
      stringValue: this.machineClient.userPoolClientId,
      description: "Machine Client ID for M2M authentication",
    })

    // Use the correct Cognito domain format from the passed domain
    new ssm.StringParameter(this, "CognitoDomainParam", {
      parameterName: `/${config.stack_name_base}/cognito_provider`,
      stringValue: `${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito domain URL for token endpoint",
    })
  }

  // Creates a DynamoDB table for storing user feedback.
  private createFeedbackTable(config: AppConfig): dynamodb.Table {
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `${config.stack_name_base}-feedback`,
      partitionKey: {
        name: "feedbackId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    })

    // Add GSI for querying by feedbackType with timestamp sorting
    feedbackTable.addGlobalSecondaryIndex({
      indexName: "feedbackType-timestamp-index",
      partitionKey: {
        name: "feedbackType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    return feedbackTable
  }

  /**
   * Creates a DynamoDB table for storing token metrics per conversation session.
   * 
   * The table tracks cumulative token usage (input, output, total) for each conversation
   * session. Metrics are automatically deleted after 7 days using DynamoDB TTL.
   * 
   * Table Schema:
   * - Partition Key: sessionId (String) - Unique conversation session identifier
   * - Attributes:
   *   - inputTokens (Number) - Cumulative input tokens for the session
   *   - outputTokens (Number) - Cumulative output tokens for the session
   *   - totalTokens (Number) - Cumulative total tokens (input + output)
   *   - lastUpdated (String) - ISO 8601 timestamp of last update
   *   - ttl (Number) - Unix timestamp for automatic deletion (7 days)
   * 
   * Access Patterns:
   * - Get metrics by sessionId (Query)
   * - Update metrics by sessionId (UpdateItem with ADD operation for atomic increments)
   * 
   * @param config - Application configuration containing stack name
   * @returns The created DynamoDB table
   */
  private createTokenMetricsTable(config: AppConfig): dynamodb.Table {
    const tokenMetricsTable = new dynamodb.Table(this, "TokenMetricsTable", {
      tableName: `${config.stack_name_base}-token-metrics`,
      partitionKey: {
        name: "sessionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "ttl", // Enable TTL for automatic deletion after 7 days
    })

    // Output the table name for reference
    new cdk.CfnOutput(this, "TokenMetricsTableName", {
      description: "DynamoDB table name for token metrics storage",
      value: tokenMetricsTable.tableName,
      exportName: `${config.stack_name_base}-TokenMetricsTableName`,
    })

    // Store table name in SSM for Lambda functions to access
    new ssm.StringParameter(this, "TokenMetricsTableNameParam", {
      parameterName: `/${config.stack_name_base}/token-metrics-table-name`,
      stringValue: tokenMetricsTable.tableName,
      description: "DynamoDB table name for token metrics",
    })

    return tokenMetricsTable
  }

  /**
   * Creates an API Gateway with Lambda integration for the feedback endpoint.
   * This is an EXAMPLE implementation demonstrating best practices for API Gateway + Lambda.
   *
   * API Contract - POST /feedback
   * Authorization: Bearer <cognito-access-token> (required)
   *
   * Request Body:
   *   sessionId: string (required, max 100 chars, alphanumeric with -_) - Conversation session ID
   *   message: string (required, max 5000 chars) - Agent's response being rated
   *   feedbackType: "positive" | "negative" (required) - User's rating
   *   comment: string (optional, max 5000 chars) - User's explanation for rating
   *
   * Success Response (200):
   *   { success: true, feedbackId: string }
   *
   * Error Responses:
   *   400: { error: string } - Validation failure (missing fields, invalid format)
   *   401: { error: "Unauthorized" } - Invalid/missing JWT token
   *   500: { error: "Internal server error" } - DynamoDB or processing error
   *
   * Implementation: infra-cdk/lambdas/feedback/index.py
   */
  private createFeedbackApi(
    config: AppConfig,
    frontendUrl: string,
    feedbackTable: dynamodb.Table
  ): apigateway.RestApi {
    // Create Lambda function for feedback using Python
    // ARM_64 required — matches Powertools ARM64 layer and avoids cross-platform
    const feedbackLambda = new PythonFunction(this, "FeedbackLambda", {
      functionName: `${config.stack_name_base}-feedback`,
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, "..", "lambdas", "feedback"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      handler: "handler",
      environment: {
        TABLE_NAME: feedbackTable.tableName,
        CORS_ALLOWED_ORIGINS: `${frontendUrl},http://localhost:3000`,
      },
      timeout: cdk.Duration.seconds(30),
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "PowertoolsLayer",
          `arn:aws:lambda:${
            cdk.Stack.of(this).region
          }:017000801446:layer:AWSLambdaPowertoolsPythonV3-python313-arm64:18`
        ),
      ],
      logGroup: new logs.LogGroup(this, "FeedbackLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-feedback`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Lambda permissions to write to DynamoDB
    feedbackTable.grantWriteData(feedbackLambda)

    /*
     * CORS TODO: Wildcard (*) used because Backend deploys before Frontend in nested stack order.
     * For Lambda proxy integrations, the Lambda's ALLOWED_ORIGINS env var is the primary CORS control.
     * API Gateway defaultCorsPreflightOptions below only handles OPTIONS preflight requests.
     * See detailed explanation and fix options in: infra-cdk/lambdas/feedback/index.py
     */
    const api = new apigateway.RestApi(this, "FeedbackApi", {
      restApiName: `${config.stack_name_base}-api`,
      description: "API for user feedback and future endpoints",
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendUrl, "http://localhost:3000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        cachingEnabled: true,
        cacheDataEncrypted: true,
        cacheClusterEnabled: true,
        cacheClusterSize: "0.5",
        cacheTtl: cdk.Duration.minutes(5),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, "FeedbackApiAccessLogGroup", {
            logGroupName: `/aws/apigateway/${config.stack_name_base}-api-access`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          })
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        tracingEnabled: true,
      },
    })

    // Add request validator for API security
    const requestValidator = new apigateway.RequestValidator(this, "FeedbackApiRequestValidator", {
      restApi: api,
      requestValidatorName: `${config.stack_name_base}-request-validator`,
      validateRequestBody: true,
      validateRequestParameters: true,
    })

    // Create Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "FeedbackApiAuthorizer", {
      cognitoUserPools: [this.userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: `${config.stack_name_base}-authorizer`,
    })

    // Create /feedback resource and POST method
    const feedbackResource = api.root.addResource("feedback")
    feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestValidator: requestValidator,
    })

    // Store the API URL for access from main stack
    this.feedbackApiUrl = api.url

    // Store API URL in SSM for frontend
    new ssm.StringParameter(this, "FeedbackApiUrlParam", {
      parameterName: `/${config.stack_name_base}/feedback-api-url`,
      stringValue: api.url,
      description: "Feedback API Gateway URL",
    })

    return api
  }

  /**
   * Creates Metrics Lambda and adds metrics endpoints to the existing API Gateway.
   * 
   * This method adds three new GET endpoints to the API Gateway for conversation metrics:
   * - GET /metrics?sessionId={id} - Returns token and memory metrics for a session
   * - GET /agents - Returns list of available agents from AgentCore Gateway
   * - GET /tools - Returns list of available tools from AgentCore Gateway
   * 
   * All endpoints require Cognito JWT authentication and have caching configured:
   * - /metrics: 5 second cache TTL (frequently changing data)
   * - /agents: 5 minute cache TTL (rarely changing data)
   * - /tools: 5 minute cache TTL (rarely changing data)
   * 
   * The Lambda function has permissions to:
   * - Read from TokenMetrics DynamoDB table
   * - Query AgentCore Memory for event counts
   * - Read SSM parameters for Gateway URL lookup
   * 
   * @param config - Application configuration containing stack name
   * @param api - Existing API Gateway instance to add endpoints to
   * @param tokenMetricsTable - DynamoDB table for token metrics storage
   */
  private createMetricsApi(
    config: AppConfig,
    api: apigateway.RestApi,
    tokenMetricsTable: dynamodb.Table
  ): void {
    // Create Lambda function for metrics using Python
    const metricsLambda = new PythonFunction(this, "MetricsLambda", {
      functionName: `${config.stack_name_base}-metrics`,
      runtime: lambda.Runtime.PYTHON_3_13,
      entry: path.join(__dirname, "..", "lambdas", "metrics"),
      handler: "handler",
      environment: {
        TOKEN_METRICS_TABLE_NAME: tokenMetricsTable.tableName,
        CORS_ALLOWED_ORIGINS: "*", // Will be restricted by API Gateway CORS config
        AGENTCORE_MEMORY_ID: this.memoryId,
        AGENTCORE_GATEWAY_URL: `/${config.stack_name_base}/gateway_url`, // SSM parameter path
        STACK_NAME: config.stack_name_base, // Required for Gateway authentication
      },
      timeout: cdk.Duration.seconds(30),
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "MetricsPowertoolsLayer",
          `arn:aws:lambda:${
            cdk.Stack.of(this).region
          }:017000801446:layer:AWSLambdaPowertoolsPythonV3-python313-arm64:18`
        ),
      ],
      logGroup: new logs.LogGroup(this, "MetricsLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-metrics`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Lambda permissions to read from DynamoDB
    tokenMetricsTable.grantReadData(metricsLambda)

    // Grant Lambda permissions to query AgentCore Memory
    metricsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreMemoryAccess",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock-agentcore:ListEvents"],
        resources: [this.memoryArn],
      })
    )

    // Grant Lambda permissions to read SSM parameters for Gateway URL and credentials
    metricsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SSMParameterReadAccess",
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      })
    )

    // Grant Lambda permissions to read Secrets Manager secrets for machine client credentials
    metricsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SecretsManagerReadAccess",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${config.stack_name_base}/machine_client_secret*`,
        ],
      })
    )

    // Get existing authorizer and request validator from the API
    // We reuse the same Cognito authorizer created for the feedback endpoint
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "MetricsApiAuthorizer", {
      cognitoUserPools: [this.userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: `${config.stack_name_base}-metrics-authorizer`,
    })

    const requestValidator = new apigateway.RequestValidator(this, "MetricsApiRequestValidator", {
      restApi: api,
      requestValidatorName: `${config.stack_name_base}-metrics-request-validator`,
      validateRequestBody: false,
      validateRequestParameters: true,
    })

    // Create /metrics resource with GET method
    // Cache TTL: 5 seconds (metrics change frequently)
    const metricsResource = api.root.addResource("metrics")
    metricsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(metricsLambda, {
        cacheKeyParameters: ["method.request.querystring.sessionId"],
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: requestValidator,
        requestParameters: {
          "method.request.querystring.sessionId": true, // Required query parameter
        },
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Cache-Control": true,
            },
          },
        ],
      }
    )

    // Create /agents resource with GET method
    // Cache TTL: 5 minutes (agents rarely change)
    const agentsResource = api.root.addResource("agents")
    agentsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(metricsLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Cache-Control": true,
            },
          },
        ],
      }
    )

    // Create /tools resource with GET method
    // Cache TTL: 5 minutes (tools rarely change)
    const toolsResource = api.root.addResource("tools")
    toolsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(metricsLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Cache-Control": true,
            },
          },
        ],
      }
    )

    // Output the metrics endpoints for reference
    new cdk.CfnOutput(this, "MetricsEndpoint", {
      description: "Metrics API endpoint URL",
      value: `${api.url}metrics`,
      exportName: `${config.stack_name_base}-MetricsEndpoint`,
    })

    new cdk.CfnOutput(this, "AgentsEndpoint", {
      description: "Agents API endpoint URL",
      value: `${api.url}agents`,
      exportName: `${config.stack_name_base}-AgentsEndpoint`,
    })

    new cdk.CfnOutput(this, "ToolsEndpoint", {
      description: "Tools API endpoint URL",
      value: `${api.url}tools`,
      exportName: `${config.stack_name_base}-ToolsEndpoint`,
    })
  }

  private createAgentCoreGateway(config: AppConfig): void {
    // Create sample tool Lambda
    const toolLambda = new lambda.Function(this, "SampleToolLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "sample_tool_lambda.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../gateway/tools/sample_tool")), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, "SampleToolLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-sample-tool`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Market data tool Lambda — needs Playwright + AgentCore Browser; use Docker for binary deps
    const marketDataLambda = new lambda.DockerImageFunction(this, "MarketDataToolLambda", {
      functionName: `${config.stack_name_base}-market-data-tool`,
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, "../../gateway/tools/market_data"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        { platform: ecr_assets.Platform.LINUX_ARM64 }
      ),
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      logGroup: new logs.LogGroup(this, "MarketDataToolLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-market-data-tool`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant market data Lambda: Bedrock for Haiku inference + Browser tool
    marketDataLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: "MarketDataBedrockAccess",
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
    }))
    marketDataLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: "MarketDataBrowserAccess",
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock-agentcore:GetBrowserSession",
        "bedrock-agentcore:StartBrowserSession",
        "bedrock-agentcore:StopBrowserSession",
        "bedrock-agentcore:CreateBrowserSession",
        "bedrock-agentcore:DeleteBrowserSession",
        "bedrock-agentcore:ConnectBrowserAutomationStream",
      ],
      resources: [
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser-custom/*`,
        "arn:aws:bedrock-agentcore:*:aws:browser/*",
      ],
    }))

    // Broker card tool Lambda — pure Python, zip deployment
    const brokerCardLambda = new PythonFunction(this, "BrokerCardToolLambda", {
      functionName: `${config.stack_name_base}-broker-card-tool`,
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, "../../gateway/tools/broker_card"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      handler: "lambda_function.handler",
      timeout: cdk.Duration.seconds(60),
      logGroup: new logs.LogGroup(this, "BrokerCardToolLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-broker-card-tool`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    brokerCardLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: "BrokerCardBedrockAccess",
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
    }))

    // Broker memory tool Lambda — needs AgentCore Memory SDK, zip deployment
    const brokerMemoryLambda = new PythonFunction(this, "BrokerMemoryToolLambda", {
      functionName: `${config.stack_name_base}-broker-memory-tool`,
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, "../../gateway/tools/broker_memory"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      handler: "lambda_function.handler",
      timeout: cdk.Duration.seconds(30),
      environment: {
        MEMORY_ID: this.memoryId,
      },
      logGroup: new logs.LogGroup(this, "BrokerMemoryToolLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-broker-memory-tool`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    brokerMemoryLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: "BrokerMemoryAccess",
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock-agentcore:CreateEvent",
        "bedrock-agentcore:GetEvent",
        "bedrock-agentcore:ListEvents",
        "bedrock-agentcore:RetrieveMemoryRecords",
      ],
      resources: [this.memoryArn],
    }))

    // Create comprehensive IAM role for gateway
    const gatewayRole = new iam.Role(this, "GatewayRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Role for AgentCore Gateway with comprehensive permissions",
    })

    // Bedrock permissions (region-agnostic)
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    )

    // SSM parameter access
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      })
    )

    // Cognito permissions
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cognito-idp:DescribeUserPoolClient", "cognito-idp:InitiateAuth"],
        resources: [this.userPool.userPoolArn],
      })
    )

    // CloudWatch Logs
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`,
        ],
      })
    )

    // Load tool specification from JSON file
    const toolSpecPath = path.join(__dirname, "../../gateway/tools/sample_tool/tool_spec.json") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const apiSpec = JSON.parse(require("fs").readFileSync(toolSpecPath, "utf8"))

    // Cognito OAuth2 configuration for gateway
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`
    const cognitoDiscoveryUrl = `${cognitoIssuer}/.well-known/openid-configuration`

    // Create OAuth2 Credential Provider for AgentCore Runtime to authenticate with AgentCore Gateway
    // Uses cr.Provider pattern with explicit Lambda to avoid logging secrets in CloudWatch
    const providerName = `${config.stack_name_base}-runtime-gateway-auth`

    // Lambda to create/delete OAuth2 provider
    const oauth2ProviderLambda = new lambda.Function(this, "OAuth2ProviderLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas", "oauth2-provider")), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      timeout: cdk.Duration.minutes(5),
      logGroup: new logs.LogGroup(this, "OAuth2ProviderLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-oauth2-provider`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Lambda permissions to read machine client secret
    this.machineClientSecret.grantRead(oauth2ProviderLambda)

    // Grant Lambda permissions for Bedrock AgentCore operations
    // OAuth2 Credential Provider operations - scoped to all providers in default Token Vault
    // Note: Need both vault-level and nested resource permissions because:
    // - CreateOauth2CredentialProvider checks permission on vault itself (token-vault/default)
    // - Also checks permission on the nested resource path (token-vault/default/oauth2credentialprovider/*)
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateOauth2CredentialProvider",
          "bedrock-agentcore:DeleteOauth2CredentialProvider",
          "bedrock-agentcore:GetOauth2CredentialProvider",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/oauth2credentialprovider/*`,
        ],
      })
    )

    // Token Vault operations - scoped to default vault
    // Note: Need both exact match (default) and wildcard (default/*) because:
    // - AWS checks permission on the vault container itself (token-vault/default)
    // - AWS also checks permission on resources inside (token-vault/default/*)
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateTokenVault",
          "bedrock-agentcore:GetTokenVault",
          "bedrock-agentcore:DeleteTokenVault",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/*`,
        ],
      })
    )

    // Grant Lambda permissions for Token Vault secret management
    // Scoped to OAuth2 secrets in AgentCore Identity default namespace
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:PutSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/*`,
        ],
      })
    )

    // Create Custom Resource Provider
    const oauth2Provider = new cr.Provider(this, "OAuth2ProviderProvider", {
      onEventHandler: oauth2ProviderLambda,
    })

    // Create Custom Resource
    const runtimeCredentialProvider = new cdk.CustomResource(this, "RuntimeCredentialProvider", {
      serviceToken: oauth2Provider.serviceToken,
      properties: {
        ProviderName: providerName,
        ClientSecretArn: this.machineClientSecret.secretArn,
        DiscoveryUrl: cognitoDiscoveryUrl,
        ClientId: this.machineClient.userPoolClientId,
      },
    })

    // Store for use in createAgentCoreRuntime()
    this.runtimeCredentialProvider = runtimeCredentialProvider

    // Create Gateway using L1 construct (CfnGateway)
    // This replaces the Custom Resource approach with native CloudFormation support
    const gateway = new bedrockagentcore.CfnGateway(this, "AgentCoreGateway", {
      name: `${config.stack_name_base}-gateway`,
      roleArn: gatewayRole.roleArn,
      protocolType: "MCP",
      protocolConfiguration: {
        mcp: {
          supportedVersions: ["2025-03-26"],
          // Optional: Enable semantic search for tools
          // searchType: "SEMANTIC",
        },
      },
      authorizerType: "CUSTOM_JWT",
      authorizerConfiguration: {
        customJwtAuthorizer: {
          allowedClients: [this.machineClient.userPoolClientId],
          discoveryUrl: cognitoDiscoveryUrl,
        },
      },
      description: "AgentCore Gateway with MCP protocol and JWT authentication",
    })

    // Grant gateway role invoke on all tool Lambdas
    toolLambda.grantInvoke(gatewayRole)
    marketDataLambda.grantInvoke(gatewayRole)
    brokerCardLambda.grantInvoke(gatewayRole)
    brokerMemoryLambda.grantInvoke(gatewayRole)

    // Load tool specs
    const marketDataSpec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../gateway/tools/market_data/tool_spec.json"), "utf8")) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const brokerCardSpec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../gateway/tools/broker_card/tool_spec.json"), "utf8")) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const brokerMemorySpec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../gateway/tools/broker_memory/tool_spec.json"), "utf8")) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

    const credConfig = [{ credentialProviderType: "GATEWAY_IAM_ROLE" }]

    // Sample tool target
    const gatewayTarget = new bedrockagentcore.CfnGatewayTarget(this, "GatewayTarget", {
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      name: "sample-tool-target",
      description: "Sample tool Lambda target",
      targetConfiguration: {
        mcp: { lambda: { lambdaArn: toolLambda.functionArn, toolSchema: { inlinePayload: apiSpec } } },
      },
      credentialProviderConfigurations: credConfig,
    })

    // Market data target (get_stock_data, search_news)
    const marketDataTarget = new bedrockagentcore.CfnGatewayTarget(this, "MarketDataTarget", {
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      name: "market-data-target",
      description: "Live stock prices and financial news via AgentCore Browser",
      targetConfiguration: {
        mcp: { lambda: { lambdaArn: marketDataLambda.functionArn, toolSchema: { inlinePayload: marketDataSpec } } },
      },
      credentialProviderConfigurations: credConfig,
    })

    // Broker card target (parse_broker_profile_from_message, generate_market_summary_for_broker, etc.)
    const brokerCardTarget = new bedrockagentcore.CfnGatewayTarget(this, "BrokerCardTarget", {
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      name: "broker-card-target",
      description: "Broker profile parsing and tailored market summary generation",
      targetConfiguration: {
        mcp: { lambda: { lambdaArn: brokerCardLambda.functionArn, toolSchema: { inlinePayload: brokerCardSpec } } },
      },
      credentialProviderConfigurations: credConfig,
    })

    // Broker memory target (identify_broker, get/update broker profile, conversation history)
    const brokerMemoryTarget = new bedrockagentcore.CfnGatewayTarget(this, "BrokerMemoryTarget", {
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      name: "broker-memory-target",
      description: "Persistent broker financial profiles via AgentCore Memory",
      targetConfiguration: {
        mcp: { lambda: { lambdaArn: brokerMemoryLambda.functionArn, toolSchema: { inlinePayload: brokerMemorySpec } } },
      },
      credentialProviderConfigurations: credConfig,
    })

    // Ensure proper creation order
    for (const target of [gatewayTarget, marketDataTarget, brokerCardTarget, brokerMemoryTarget]) {
      target.addDependency(gateway)
    }
    gateway.node.addDependency(this.machineClient)
    gateway.node.addDependency(gatewayRole)

    // Store AgentCore Gateway URL in SSM for AgentCore Runtime access
    new ssm.StringParameter(this, "GatewayUrlParam", {
      parameterName: `/${config.stack_name_base}/gateway_url`,
      stringValue: gateway.attrGatewayUrl,
      description: "AgentCore Gateway URL",
    })

    // Output gateway information
    new cdk.CfnOutput(this, "GatewayId", {
      value: gateway.attrGatewayIdentifier,
      description: "AgentCore Gateway ID",
    })

    new cdk.CfnOutput(this, "GatewayUrl", {
      value: gateway.attrGatewayUrl,
      description: "AgentCore Gateway URL",
    })

    new cdk.CfnOutput(this, "GatewayArn", {
      value: gateway.attrGatewayArn,
      description: "AgentCore Gateway ARN",
    })
  }

  private createMachineAuthentication(config: AppConfig): void {
    // Create Resource Server for Machine-to-Machine (M2M) authentication
    // This defines the API scopes that machine clients can request access to
    const resourceServer = new cognito.UserPoolResourceServer(this, "ResourceServer", {
      userPool: this.userPool,
      identifier: `${config.stack_name_base}-gateway`,
      userPoolResourceServerName: `${config.stack_name_base}-gateway-resource-server`,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: "read",
          scopeDescription: "Read access to gateway",
        }),
        new cognito.ResourceServerScope({
          scopeName: "write",
          scopeDescription: "Write access to gateway",
        }),
      ],
    })

    // Create Machine Client for AgentCore Gateway authentication
    //
    // WHAT IS A MACHINE CLIENT?
    // A machine client is a Cognito User Pool Client configured for server-to-server authentication
    // using the OAuth2 Client Credentials flow. Unlike user-facing clients, it doesn't require
    // human interaction or user credentials.
    //
    // HOW IS IT DIFFERENT FROM THE REGULAR USER POOL CLIENT?
    // - Regular client: Uses Authorization Code flow for human users (frontend login)
    // - Machine client: Uses Client Credentials flow for service-to-service authentication
    // - Regular client: No client secret (public client for frontend security)
    // - Machine client: Has client secret (confidential client for backend security)
    // - Regular client: Scopes are openid, email, profile (user identity)
    // - Machine client: Scopes are custom resource server scopes (API permissions)
    //
    // WHY IS IT NEEDED?
    // The AgentCore Gateway needs to authenticate with Cognito to validate tokens and make
    // API calls on behalf of the system. The machine client provides the credentials for
    // this service-to-service authentication without requiring user interaction.
    this.machineClient = new cognito.UserPoolClient(this, "MachineClient", {
      userPool: this.userPool,
      userPoolClientName: `${config.stack_name_base}-machine-client`,
      generateSecret: true, // Required for client credentials flow
      oAuth: {
        flows: {
          clientCredentials: true, // Enable OAuth2 Client Credentials flow
        },
        scopes: [
          // Grant access to the resource server scopes defined above
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "read",
              scopeDescription: "Read access to gateway",
            })
          ),
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "write",
              scopeDescription: "Write access to gateway",
            })
          ),
        ],
      },
    })

    // Machine client must be created after resource server
    this.machineClient.node.addDependency(resourceServer)

    // Store machine client secret in Secrets Manager for testing and external access.
    // This secret is used by test scripts and potentially other external tools.
    this.machineClientSecret = new secretsmanager.Secret(this, "MachineClientSecret", {
      secretName: `/${config.stack_name_base}/machine_client_secret`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        this.machineClient.userPoolClientSecret.unsafeUnwrap()
      ),
      description: "Machine Client Secret for M2M authentication",
    })
  }

  /**
   * Builds the RuntimeNetworkConfiguration based on the config.yaml settings.
   * When network_mode is "VPC", imports the user's existing VPC, subnets, and
   * optionally security groups, then returns a VPC-based network configuration.
   * When network_mode is "PUBLIC" (default), returns a public network configuration.
   *
   * @param config - The application configuration from config.yaml.
   * @returns A RuntimeNetworkConfiguration for the AgentCore Runtime.
   */
  private buildNetworkConfiguration(config: AppConfig): agentcore.RuntimeNetworkConfiguration {
    if (config.backend.network_mode === "VPC") {
      const vpcConfig = config.backend.vpc
      // vpc config is validated in ConfigManager, but guard here for type safety
      if (!vpcConfig) {
        throw new Error("backend.vpc configuration is required when network_mode is 'VPC'.")
      }

      // Import the user's existing VPC by ID.
      // This performs a context lookup at synth time to resolve VPC attributes.
      const vpc = ec2.Vpc.fromLookup(this, "ImportedVpc", {
        vpcId: vpcConfig.vpc_id,
      })

      // Import the user-specified subnets by their IDs.
      // These subnets must exist within the VPC specified above.
      const subnets: ec2.ISubnet[] = vpcConfig.subnet_ids.map((subnetId: string, index: number) =>
        ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId)
      )

      // Build the VPC config props for the AgentCore L2 construct.
      // Security groups are optional — if not provided, the construct creates a default one.
      const securityGroups =
        vpcConfig.security_group_ids && vpcConfig.security_group_ids.length > 0
          ? vpcConfig.security_group_ids.map((sgId: string, index: number) =>
              ec2.SecurityGroup.fromSecurityGroupId(this, `ImportedSG${index}`, sgId)
            )
          : undefined

      const vpcConfigProps: agentcore.VpcConfigProps = {
        vpc: vpc,
        vpcSubnets: {
          subnets: subnets,
        },
        securityGroups: securityGroups,
      }

      return agentcore.RuntimeNetworkConfiguration.usingVpc(this, vpcConfigProps)
    }

    // Default: public network mode
    return agentcore.RuntimeNetworkConfiguration.usingPublicNetwork()
  }

  /**
   * Recursively read directory contents and encode as base64.
   *
   * @param dirPath - Directory to read.
   * @param prefix - Prefix for file paths in output.
   * @param output - Output object to populate.
   */
  private readDirRecursive(dirPath: string, prefix: string, output: Record<string, string>): void {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const relativePath = path.join(prefix, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

      if (entry.isDirectory()) {
        // Skip __pycache__ directories
        if (entry.name !== "__pycache__") {
          this.readDirRecursive(fullPath, relativePath, output)
        }
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath)
        output[relativePath] = content.toString("base64")
      }
    }
  }

  /**
   * Create a hash of content for change detection.
   *
   * @param content - Content to hash.
   * @returns Hash string.
   */
  private hashContent(content: string): string {
    const crypto = require("crypto")
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
  }
}

# VPC Connectivity Testing

This document describes the VPC connectivity testing feature in FAST, which enables testing of network connectivity from the AgentCore Runtime to private VPC resources via AWS PrivateLink.

## Overview

The VPC connectivity testing feature is a proof-of-concept that demonstrates the AgentCore Runtime can successfully reach private VPC resources through AWS PrivateLink. This capability is essential for agents that need to access internal services, databases, or APIs that should not be exposed to the public internet.

### What This Feature Provides

- **On-Agent Tool**: A tool that runs within the AgentCore Runtime container to test HTTP connectivity
- **Test Service**: A simple HTTP service deployed in a private VPC that responds with "hello world" messages
- **PrivateLink Integration**: Secure connectivity between the runtime and test service without public internet exposure
- **Agent Integration**: Natural language interface to test connectivity through conversation with the agent

### Use Cases

- Verify that agents can reach private VPC resources
- Test PrivateLink connectivity before deploying production services
- Troubleshoot network connectivity issues
- Demonstrate secure agent-to-VPC communication patterns

## Architecture

The feature consists of three main components connected via AWS PrivateLink, mimicking Snowflake's PrivateLink connectivity pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AgentCore Runtime VPC                         │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           AgentCore Runtime Container                     │  │
│  │                                                            │  │
│  │  ┌──────────────────┐      ┌─────────────────────────┐  │  │
│  │  │  Strands Agent   │─────▶│ VPC Connectivity Tool   │  │  │
│  │  └──────────────────┘      └──────────┬──────────────┘  │  │
│  │                                        │                  │  │
│  └────────────────────────────────────────┼──────────────────┘  │
│                                           │                      │
│                                           │ HTTPS Request        │
│                                           ▼                      │
│                              ┌─────────────────────────┐        │
│                              │   VPC Endpoint          │        │
│                              │   (Interface Endpoint)  │        │
│                              └──────────┬──────────────┘        │
└─────────────────────────────────────────┼───────────────────────┘
                                          │
                                          │ PrivateLink
                                          │
┌─────────────────────────────────────────┼───────────────────────┐
│                    Test Service VPC     │                        │
│                                         ▼                        │
│                          ┌──────────────────────────┐           │
│                          │  Network Load Balancer   │           │
│                          │  (Layer 4 - TCP/TLS)     │           │
│                          └──────────┬───────────────┘           │
│                                     │                            │
│                                     ▼                            │
│                          ┌──────────────────────────┐           │
│                          │  Test Service Lambda     │           │
│                          │  (HTTPS via Function URL)│           │
│                          └──────────────────────────┘           │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Component Details

1. **VPC Connectivity Tool** (`tools/vpc_connectivity/vpc_connectivity_tool.py`)
   - Runs within the AgentCore Runtime container
   - Retrieves test endpoint from SSM Parameter Store
   - Makes HTTPS GET requests to test connectivity (mimics Snowflake API calls)
   - Returns structured results with timing and error information

2. **Test Service Lambda** (`infra-cdk/lambdas/vpc-test-service/index.py`)
   - Simple HTTPS service that returns JSON responses
   - Deployed with Lambda Function URL for HTTPS access
   - No VPC attachment needed (serverless)
   - Logs all requests for debugging

3. **Infrastructure** (CDK stacks)
   - Test Service VPC with private subnets across 2 AZs
   - Network Load Balancer (NLB) targeting the Lambda function
   - VPC Endpoint Service backed by the NLB (PrivateLink requirement)
   - VPC Endpoint in Runtime VPC connecting to the service
   - Security groups and IAM permissions

### Why This Architecture?

This architecture was specifically designed to mimic **Snowflake's PrivateLink pattern**:

- **NLB Requirement**: AWS PrivateLink only supports Network Load Balancers (NLB) or Gateway Load Balancers (GWLB), not Application Load Balancers (ALB)
- **Layer 4 Load Balancing**: NLB operates at Layer 4 (TCP/TLS), matching how Snowflake exposes their service
- **HTTPS Protocol**: Uses HTTPS like real Snowflake connections (e.g., `https://account.privatelink.snowflakecomputing.com`)
- **Production Pattern**: Demonstrates the exact connectivity pattern customers use to access Snowflake and other SaaS services via PrivateLink

## Prerequisites

Before deploying the VPC connectivity testing feature, ensure you have:

- **AWS Account**: With permissions to create VPCs, Lambda functions, NLBs, and VPC endpoints
- **CDK CLI**: Installed and configured (`npm install -g aws-cdk`)
- **Docker**: Required for building Lambda functions and agent runtime
- **FAST Deployed**: The base FAST infrastructure should already be deployed

### Required AWS Permissions

Your AWS credentials need permissions to create:
- VPCs, subnets, and route tables
- VPC endpoints and VPC endpoint services
- Network Load Balancers
- Lambda functions
- IAM roles and policies
- SSM parameters
- CloudWatch log groups

## Deployment

### Step 1: Update Configuration

Edit `infra-cdk/config.yaml` to enable VPC connectivity:

```yaml
backend:
  pattern: strands-single-agent
  deployment_type: docker
  
  # VPC Configuration for AgentCore Runtime
  vpc:
    # Enable VPC connectivity
    enabled: true
    
    # Optional: Specify CIDR block for new VPC
    cidr: null  # Uses default if not specified
    
    # Optional: Use existing VPC
    vpc_id: null
    
    # Optional: Use existing subnets
    subnet_ids: []
    
    # Optional: Attach additional security groups
    security_group_ids: []
```

**Configuration Options:**

- `enabled: true` - **Required** to enable VPC connectivity
- `cidr` - Optional CIDR block for new VPC (e.g., "10.0.0.0/16")
- `vpc_id` - Optional existing VPC ID to use instead of creating new VPC
- `subnet_ids` - Optional list of existing subnet IDs (must be private subnets)
- `security_group_ids` - Optional list of additional security group IDs to attach

**Note**: If you don't specify `vpc_id`, a new VPC will be created automatically with appropriate configuration for PrivateLink connectivity.

### Step 2: Deploy Infrastructure

Deploy the complete stack including VPC connectivity components:

```bash
cd infra-cdk
cdk deploy --all
```

This will deploy:
- Test Service VPC and Lambda function
- Network Load Balancer and VPC Endpoint Service
- AgentCore Runtime VPC configuration
- VPC Endpoint connecting the two VPCs
- All necessary IAM roles and security groups

**Deployment Time**: Expect 10-15 minutes for the complete deployment.

### Step 3: Verify Deployment

After deployment completes, verify the infrastructure:

1. **Check CloudFormation Outputs**:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name <your-stack-name> \
     --query 'Stacks[0].Outputs'
   ```

   Look for outputs including:
   - `EndpointServiceName` - The VPC Endpoint Service name
   - `TestServiceVpcId` - The Test Service VPC ID
   - `TestServiceNlbArn` - The Network Load Balancer ARN
   - `TestServiceFunctionUrl` - The Lambda Function URL

2. **Verify SSM Parameter**:
   ```bash
   aws ssm get-parameter \
     --name "/<stack-name>/vpc_test_endpoint_url" \
     --query 'Parameter.Value'
   ```

   This should return the endpoint URL that the tool will use.

3. **Check VPC Endpoint Status**:
   ```bash
   aws ec2 describe-vpc-endpoints \
     --filters "Name=tag:Name,Values=*test-service*" \
     --query 'VpcEndpoints[0].State'
   ```

   The state should be `available`.

## Testing the Feature

### Using the Agent Interface

The simplest way to test VPC connectivity is through natural conversation with the agent:

1. **Access the FAST Frontend**: Open your deployed FAST application in a web browser

2. **Start a Conversation**: Create a new chat session

3. **Ask the Agent to Test Connectivity**:
   ```
   Test VPC connectivity
   ```

   Or more specifically:
   ```
   Can you test connectivity to the VPC test service?
   ```

4. **Review the Results**: The agent will invoke the VPC connectivity tool and return results

### Example Agent Conversation

**User**: Test VPC connectivity

**Agent**: I'll test the VPC connectivity for you.

*[Agent invokes test_vpc_connectivity tool]*

The VPC connectivity test was successful! Here are the results:

- **Status**: Success ✓
- **HTTP Status Code**: 200
- **Response Time**: 145.23 ms
- **Service Message**: "Hello from VPC Test Service!"
- **Service Name**: vpc-connectivity-test
- **Timestamp**: 2024-01-15T10:30:45.123Z

The agent runtime can successfully reach private VPC resources through PrivateLink.

### Understanding Test Results

The tool returns a JSON response with the following fields:

**On Success**:
```json
{
  "success": true,
  "status_code": 200,
  "response_body": "{\"message\": \"Hello from VPC Test Service!\", \"pattern\": \"snowflake-privatelink-mimic\", ...}",
  "response_time_ms": 145.23,
  "timestamp": "2024-01-15T10:30:45.123Z",
  "endpoint": "https://vpce-abc123.execute-api.us-east-1.vpce.amazonaws.com"
}
```

**On Failure**:
```json
{
  "success": false,
  "error": "Connection timeout after 10 seconds",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "endpoint": "https://vpce-abc123.execute-api.us-east-1.vpce.amazonaws.com"
}
```

### Direct Tool Testing (Advanced)

For debugging or development, you can test the tool directly from Python:

```python
from tools.vpc_connectivity.vpc_connectivity_tool import VPCConnectivityTool
import os

# Set required environment variable
os.environ['STACK_NAME'] = 'your-stack-name'

# Initialize tool
tool = VPCConnectivityTool(region='us-east-1')

# Run test
result = tool.test_vpc_connectivity()
print(result)
```

## Monitoring and Troubleshooting

### CloudWatch Logs

Monitor the feature using CloudWatch Logs:

1. **AgentCore Runtime Logs**:
   ```
   /aws/bedrock-agentcore/runtime/<runtime-id>
   ```
   - Shows tool invocations and results
   - Contains VPC connectivity tool debug logs

2. **Test Service Lambda Logs**:
   ```
   /aws/lambda/<stack-name>-vpc-test-service
   ```
   - Shows incoming requests from the runtime
   - Contains service response details

3. **VPC Flow Logs** (if enabled):
   - Monitor traffic through VPC endpoints
   - Verify packets are flowing correctly

### Common Issues and Solutions

#### Issue: "Test service endpoint not configured"

**Cause**: SSM parameter is missing or inaccessible

**Solution**:
1. Verify the SSM parameter exists:
   ```bash
   aws ssm get-parameter --name "/<stack-name>/vpc_test_endpoint_url"
   ```

2. Check IAM permissions for the runtime role:
   ```bash
   aws iam get-role-policy --role-name <runtime-role> --policy-name SSMReadPolicy
   ```

3. Ensure `STACK_NAME` environment variable is set correctly in the runtime

#### Issue: "Connection timeout after 10 seconds"

**Cause**: Network connectivity issue between runtime and test service

**Solution**:
1. Verify VPC endpoint is in `available` state:
   ```bash
   aws ec2 describe-vpc-endpoints --vpc-endpoint-ids <endpoint-id>
   ```

2. Check security groups allow outbound traffic from runtime:
   ```bash
   aws ec2 describe-security-groups --group-ids <runtime-sg-id>
   ```

3. Verify NLB target health:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <target-group-arn>
   ```

4. Check VPC endpoint service accepts connections:
   ```bash
   aws ec2 describe-vpc-endpoint-service-configurations \
     --service-ids <service-id>
   ```

#### Issue: "Connection refused" or SSL/TLS errors

**Cause**: Test service is not running, NLB is not routing correctly, or SSL certificate issues

**Solution**:
1. Check Lambda function is active:
   ```bash
   aws lambda get-function --function-name <stack-name>-vpc-test-service
   ```

2. Verify Lambda Function URL is configured:
   ```bash
   aws lambda get-function-url-config --function-name <stack-name>-vpc-test-service
   ```

3. Verify NLB listener configuration:
   ```bash
   aws elbv2 describe-listeners --load-balancer-arn <nlb-arn>
   ```

4. Check target group has healthy targets:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <tg-arn>
   ```

5. For SSL errors, verify the endpoint URL uses HTTPS and certificate validation is working

#### Issue: "HTTP error: 500"

**Cause**: Test service Lambda is encountering errors

**Solution**:
1. Check Lambda CloudWatch logs for errors:
   ```bash
   aws logs tail /aws/lambda/<stack-name>-vpc-test-service --follow
   ```

2. Verify Lambda has correct permissions and configuration

3. Test Lambda directly:
   ```bash
   aws lambda invoke --function-name <stack-name>-vpc-test-service \
     --payload '{}' response.json
   ```

### Monitoring Metrics

Key metrics to monitor:

1. **Lambda Invocations**: Track test service invocation count
2. **Lambda Errors**: Alert on Lambda function errors
3. **NLB Target Health**: Monitor unhealthy target count
4. **VPC Endpoint Bytes**: Track data transfer through endpoint
5. **Tool Response Time**: Monitor connectivity test latency

### Debugging Tips

1. **Enable Debug Logging**: Set log level to DEBUG in the runtime environment

2. **Test Components Independently**:
   - Test Lambda function directly
   - Test NLB health checks
   - Test VPC endpoint connectivity

3. **Check Network Path**:
   - Verify route tables
   - Check security group rules
   - Confirm DNS resolution

4. **Review IAM Permissions**:
   - Runtime role can read SSM parameters
   - Lambda execution role can write CloudWatch logs
   - VPC endpoint service allows connections

## Security Considerations

### Network Isolation

- Test service has **no internet access** - deployed in private subnets with no NAT Gateway
- Only accessible via **PrivateLink** - no public endpoints
- Security groups restrict traffic to **AgentCore Runtime only**

### IAM Permissions

The feature follows the principle of least privilege:

- **Runtime Role**: Read-only access to specific SSM parameters
- **Lambda Role**: Write access to CloudWatch Logs only
- **Gateway Role**: Invoke permissions for Lambda targets only

### Data Protection

- All traffic encrypted in transit using **TLS**
- CloudWatch logs encrypted at rest
- No sensitive data in test service responses
- Generic error messages prevent information disclosure

### Production Recommendations

For production deployments:

1. **Restrict VPC Endpoint Service Access**:
   ```typescript
   allowedPrincipals: [runtimeRole.roleArn]
   ```

2. **Enable Connection Approval**:
   ```typescript
   acceptanceRequired: true
   ```

3. **Use Private DNS**:
   - Configure private hosted zones
   - Use custom domain names

4. **Enable VPC Flow Logs**:
   - Monitor all network traffic
   - Detect anomalies

5. **Implement Network ACLs**:
   - Additional layer of network security
   - Restrict traffic by IP ranges

## Extending the Feature

### Adding Custom VPC Services

To test connectivity to your own VPC services:

1. **Expose Your Service via PrivateLink**:
   - Create VPC Endpoint Service for your service
   - Configure NLB or ALB as needed

2. **Update SSM Parameter**:
   ```bash
   aws ssm put-parameter \
     --name "/<stack-name>/custom_service_endpoint" \
     --value "http://your-endpoint-url" \
     --overwrite
   ```

3. **Modify the Tool** (optional):
   - Add parameter to specify which endpoint to test
   - Support multiple test targets

### Testing Different Protocols

The current implementation tests HTTPS connectivity (mimicking Snowflake). To test other protocols:

1. **TCP Connectivity**: Use Python `socket` library for raw TCP tests
2. **Database Connections**: Use database-specific clients (psycopg2, pymysql, etc.)
3. **Custom Protocols**: Implement protocol-specific clients
4. **HTTP (non-TLS)**: Modify the NLB listener to port 80 and update the tool

### Integration with Other Patterns

The VPC connectivity tool can be integrated with other agent patterns:

- **LangGraph**: Add tool to LangGraph agent's tool list
- **Custom Agents**: Import and use `VPCConnectivityTool` class directly
- **Gateway Lambda**: Expose as a Gateway Lambda target for cross-agent access

## Cost Considerations

The VPC connectivity testing feature incurs the following AWS costs:

- **VPC Endpoints**: ~$0.01 per hour + data transfer charges
- **Network Load Balancer**: ~$0.0225 per hour + LCU charges
- **Lambda Invocations**: Minimal (only when testing)
- **VPC**: No additional cost for VPCs themselves
- **CloudWatch Logs**: Based on log volume

**Estimated Monthly Cost**: $20-30 for the test infrastructure (varies by region and usage)

**Cost Optimization**:
- Delete test infrastructure when not needed
- Use CloudFormation to easily tear down and recreate
- Share VPC infrastructure across multiple services

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - How to deploy FAST infrastructure
- [Agent Configuration](AGENT_CONFIGURATION.md) - Configuring agent behavior
- [Gateway Implementation](GATEWAY.md) - AgentCore Gateway with Lambda targets
- [AWS PrivateLink Documentation](https://docs.aws.amazon.com/vpc/latest/privatelink/) - Official AWS documentation
- [VPC Endpoint Services](https://docs.aws.amazon.com/vpc/latest/privatelink/endpoint-service.html) - Creating endpoint services

## Support and Feedback

For issues, questions, or feedback about the VPC connectivity testing feature:

1. Check CloudWatch logs for detailed error information
2. Review this documentation for troubleshooting steps
3. Consult the design document at `.kiro/specs/vpc-connectivity-test-tool/design.md`
4. Review the requirements at `.kiro/specs/vpc-connectivity-test-tool/requirements.md`

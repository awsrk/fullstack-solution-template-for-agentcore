---
inclusion: fileMatch
fileMatchPattern: "infra-cdk/**"
---

# Infrastructure Development Guide

## Overview

Infrastructure is AWS CDK (TypeScript) in `infra-cdk/`. Read `infra-cdk/README.md` before making changes.

## Stack Architecture

CDK deploys multiple stacks in this order:

1. **CognitoStack** — User Pool, User Pool Client, hosted UI domain
2. **BackendStack** — Machine client, AgentCore Gateway, AgentCore Runtime, Lambda tools, DynamoDB, API Gateway
3. **AmplifyHostingStack** — Amplify app for frontend hosting

The main orchestrator is `infra-cdk/lib/fast-cdk-stack.ts`. Individual stacks are in `infra-cdk/lib/`.

## Configuration

All deployment configuration lives in `infra-cdk/config.yaml`:

```yaml
stack_name_base: your-stack-name   # Max 35 chars — AgentCore runtime naming constraint
admin_user_email: null              # Optional: auto-creates Cognito user
backend:
  pattern: strands-single-agent     # Which agent pattern to deploy
  deployment_type: zip              # docker (default) or zip
  vpc:
    enabled: false                  # Enable for PrivateLink/VPC connectivity
```

Always check this file before modifying infrastructure — it drives most CDK behavior.

## Adding a Gateway Tool

Read `docs/GATEWAY.md` fully before adding tools. The pattern:

1. Create a Lambda handler in `infra-cdk/lambdas/` following the AgentCore Gateway event format:

```python
def handler(event, context):
    # Tool name comes from context, NOT the event body
    original_tool_name = context.client_context.custom['bedrockAgentCoreToolName']
    delimiter = "___"
    tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter):]

    # Arguments are in the event body
    arguments = event

    return {"content": [{"type": "text", "text": "result"}]}
```

2. Define the tool schema (JSON Schema) and add the Lambda + target to the Gateway in `infra-cdk/lib/backend-stack.ts`

3. Use these JSON Schema types for tool inputs: `"integer"`, `"number"`, `"string"`, `"boolean"`, `"array"`, `"object"` — not Python type names

## SSM Parameters

Gateway configuration is stored in SSM and read by agents at runtime:

- `/{stack_name}/gateway_url`
- `/{stack_name}/machine_client_id`
- `/{stack_name}/machine_client_secret`
- `/{stack_name}/cognito_provider`

## VPC Configuration

VPC support for PrivateLink connectivity is configured in `config.yaml` under `backend.vpc`. Read `docs/VPC_CONNECTIVITY_TESTING.md` before enabling. When `vpc.enabled: true`, the runtime deploys into a VPC with PrivateLink endpoints.

## Docker Build Context

The Docker build context is the repository root (not the pattern directory). This allows agent containers to access the shared `gateway/` package. The `.dockerignore` at the repo root excludes `node_modules/`, `.git/`, `cdk.out/`, etc. to keep build context small (~10MB).

## Useful CDK Commands

Run from `infra-cdk/`:

```bash
npm run build          # Compile TypeScript
npx cdk diff           # Preview changes before deploying
npx cdk deploy --all   # Deploy all stacks
npx cdk destroy --all  # Tear down all resources
npm test               # Run Jest unit tests
```

## Deploying Frontend After Backend Changes

After any CDK deploy that changes stack outputs (Cognito IDs, Amplify URL, etc.), redeploy the frontend to regenerate `aws-exports.json`:

```bash
python scripts/deploy-frontend.py
```

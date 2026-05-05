---
inclusion: always
---

# FAST Project Overview

This repository is the **Fullstack AgentCore Solution Template (FAST)** — a starter project for deploying a secured, web-accessible React frontend connected to an AWS Bedrock AgentCore backend.

## What This Project Is

FAST is a template/framework, not a finished product. Its purpose is to be forked and customized. The baseline ships with a working multi-turn chat agent. Developers extend it for their specific use case.

## Core Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui, hosted on AWS Amplify
- **Backend**: Python agent running in AgentCore Runtime (supports Strands and LangGraph patterns)
- **Auth**: AWS Cognito (user login, M2M token exchange, JWT validation)
- **Tools**: AgentCore Gateway with Lambda targets (MCP protocol)
- **Memory**: AgentCore Memory (short-term and long-term strategies)
- **Infra**: AWS CDK (TypeScript) in `infra-cdk/`

## Key Directories

```
patterns/               # Agent implementations (strands-single-agent, langgraph-single-agent)
tools/                  # Reusable framework-agnostic tools (code_interpreter, vpc_connectivity)
gateway/                # Gateway utilities and Lambda tool implementations
infra-cdk/              # CDK stacks, Lambda functions, config.yaml
frontend/               # React app
docs/                   # Authoritative documentation — always read before implementing
tests/                  # Python unit and integration tests
scripts/                # Deployment scripts
```

## Configuration Entry Point

`infra-cdk/config.yaml` controls the stack name, agent pattern, deployment type, and VPC settings. Always check this file when working on infrastructure.

## Documentation Is the Source of Truth

The `docs/` folder contains expert-authored guides. Always read the relevant doc before implementing anything in that domain:

- `docs/DEPLOYMENT.md` — how to deploy
- `docs/AGENT_CONFIGURATION.md` — how to add/change agent patterns
- `docs/GATEWAY.md` — how to add Gateway tools
- `docs/MEMORY_INTEGRATION.md` — how to integrate AgentCore Memory
- `docs/STREAMING.md` — how streaming works end-to-end
- `docs/VPC_CONNECTIVITY_TESTING.md` — VPC/PrivateLink testing
- `docs/LOCAL_DEVELOPMENT.md` — local dev with Docker Compose

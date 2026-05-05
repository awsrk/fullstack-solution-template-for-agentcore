---
inclusion: fileMatch
fileMatchPattern: "patterns/**"
---

# Backend Agent Development Guide

## Overview

Agent patterns live in `patterns/`. Each pattern is a self-contained Python agent that runs inside AgentCore Runtime. FAST ships two patterns:

- `patterns/strands-single-agent/` — Strands SDK agent (default)
- `patterns/langgraph-single-agent/` — LangGraph agent

Read `docs/AGENT_CONFIGURATION.md` before creating or modifying agent patterns.

## Entrypoint Contract

Every agent must use `BedrockAgentCoreApp` and expose an `@app.entrypoint` async generator:

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext

app = BedrockAgentCoreApp()

@app.entrypoint
async def agent_stream(payload: dict, context: RequestContext):
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")
    # Always extract user_id from JWT context, never from payload
    user_id = extract_user_id_from_context(context)
    ...
    yield response

if __name__ == "__main__":
    app.run()
```

**Security rule**: Always extract `user_id` from `context` (validated JWT), never from `payload` (user-controlled).

## Required Environment Variables

Agents depend on these at runtime — raise `ValueError` if missing, never fall back silently:

- `MEMORY_ID` — AgentCore Memory resource ID
- `STACK_NAME` — used to look up SSM parameters (gateway URL, credentials)
- `AWS_DEFAULT_REGION` — AWS region

## Gateway Integration

Agents connect to Gateway tools via MCP. Read `docs/GATEWAY.md` before working with Gateway.

The pattern for Strands:

```python
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

gateway_client = MCPClient(
    lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
    prefix="gateway",
)
```

Gateway URL and credentials come from SSM — use `gateway/utils/ssm.py` and `gateway/utils/auth.py`.

## Memory Integration

Read `docs/MEMORY_INTEGRATION.md` before implementing memory.

For Strands, use `AgentCoreMemorySessionManager`:

```python
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

config = AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=user_id)
session_manager = AgentCoreMemorySessionManager(agentcore_memory_config=config, region_name=region)
```

## Shared Utilities

The `gateway/` directory is installed as a Python package (`from gateway.utils.*`). Use it for:

- `gateway/utils/auth.py` — `get_gateway_access_token()`, `extract_user_id_from_context()`
- `gateway/utils/ssm.py` — `get_ssm_parameter()`

The `tools/` directory contains reusable framework-agnostic tools:

- `tools/code_interpreter/` — AgentCore Code Interpreter integration
- `tools/vpc_connectivity/` — VPC PrivateLink connectivity testing

## Deployment Types

Set in `infra-cdk/config.yaml`:

- `docker` (default) — builds container image, pushes to ECR
- `zip` — packages code as Lambda ZIP (faster iteration, pure-Python deps only)

For `zip` deployment, no Dockerfile is needed. The packager bundles `patterns/<pattern>/`, `gateway/`, and `tools/` automatically.

## Adding a New Pattern

1. Create `patterns/my-pattern/` with your agent code
2. Follow the entrypoint contract above
3. Add `requirements.txt` with dependencies
4. Add `Dockerfile` if using `deployment_type: docker`
5. Set `pattern: my-pattern` in `infra-cdk/config.yaml`
6. If new AWS resources are needed, update `infra-cdk/lib/backend-stack.ts`

## Streaming

Read `docs/STREAMING.md` to understand how backend events map to frontend rendering. The Strands pattern yields raw events:

```python
async for event in agent.stream_async(user_query):
    yield json.loads(json.dumps(dict(event), default=str))
```

The `default=str` is required — Strands events contain non-JSON-serializable Python objects.

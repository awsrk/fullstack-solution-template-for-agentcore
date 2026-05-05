---
inclusion: fileMatch
fileMatchPattern: "gateway/**"
---

# Gateway Tools Development Guide

## Overview

AgentCore Gateway uses Lambda targets to expose tools to agents via MCP. Read `docs/GATEWAY.md` fully before adding or modifying tools.

## Directory Structure

```
gateway/
├── tools/          # Lambda tool implementations
└── utils/          # Shared utilities (auth, SSM)
    ├── auth.py     # get_gateway_access_token(), extract_user_id_from_context()
    └── ssm.py      # get_ssm_parameter()
```

The `gateway/` package is installed into agent containers via `pip install -e .` — import as `from gateway.utils.auth import ...`.

## Lambda Tool Implementation Pattern

Every Gateway Lambda must follow this exact pattern for parsing the tool name:

```python
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: dict, context) -> dict:
    """
    Handle AgentCore Gateway tool invocation.

    The tool name is passed via Lambda context, NOT the event body.
    Arguments are passed directly in the event body.
    """
    # Tool name is in context, not event — this is an AgentCore Gateway requirement
    original_tool_name = context.client_context.custom['bedrockAgentCoreToolName']
    logger.info(f"Tool invocation: {original_tool_name}, event: {json.dumps(event)}")

    delimiter = "___"
    if delimiter in original_tool_name:
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter):]
    else:
        tool_name = original_tool_name

    if tool_name == "my_tool":
        result = my_tool_logic(event)
        return {"content": [{"type": "text", "text": result}]}
    else:
        raise ValueError(f"Unknown tool: {tool_name}")
```

## Tool Schema Definition

Tools are defined in CDK (`infra-cdk/lib/backend-stack.ts`) using JSON Schema. Use these type names exactly:

| Python type | JSON Schema type |
|-------------|-----------------|
| `int`       | `"integer"`     |
| `float`     | `"number"`      |
| `str`       | `"string"`      |
| `bool`      | `"boolean"`     |
| `list`      | `"array"`       |
| `dict`      | `"object"`      |

## Multiple Tools Per Lambda

A single Lambda can handle multiple tools — route on the extracted `tool_name`:

```python
if tool_name == "tool_one":
    ...
elif tool_name == "tool_two":
    ...
else:
    raise ValueError(f"Unknown tool: {tool_name}")
```

## Testing Gateway Tools

Test the full Gateway integration with:

```bash
python3 scripts/test-gateway.py
```

This authenticates via machine client credentials from SSM, lists available tools, and calls them.

To test a Lambda function directly (without Gateway), invoke it via AWS CLI or write a unit test that mocks the `context.client_context.custom` dict.

## Debugging

If the Gateway returns "An internal error occurred", enable debug mode in CDK:

```typescript
const gateway = new bedrockagentcore.CfnGateway(this, "AgentCoreGateway", {
  exceptionLevel: "DEBUG",  // Add this line
  // ...
});
```

Then check CloudWatch logs at `/aws/bedrock-agentcore/gateway/*`.

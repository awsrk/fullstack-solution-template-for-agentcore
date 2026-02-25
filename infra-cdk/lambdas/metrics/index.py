# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Metrics API Lambda Handler"""

import os
from typing import Any, Dict, List

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.logging.correlation_paths import API_GATEWAY_REST
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# Environment variables
TOKEN_METRICS_TABLE_NAME = os.environ.get("TOKEN_METRICS_TABLE_NAME", "")
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
AGENTCORE_MEMORY_ID = os.environ.get("AGENTCORE_MEMORY_ID", "")
AGENTCORE_GATEWAY_URL = os.environ.get("AGENTCORE_GATEWAY_URL", "")

# Parse CORS origins - can be comma-separated list
cors_origins = [
    origin.strip() for origin in CORS_ALLOWED_ORIGINS.split(",") if origin.strip()
]
primary_origin = cors_origins[0] if cors_origins else "*"
extra_origins = cors_origins[1:] if len(cors_origins) > 1 else None

# Configure CORS
cors_config = CORSConfig(
    allow_origin=primary_origin,
    extra_origins=extra_origins,
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)

# Initialize AWS clients
dynamodb = boto3.client("dynamodb")
agentcore_memory = boto3.client("bedrock-agent-runtime")

tracer = Tracer()
logger = Logger()
app = APIGatewayRestResolver(cors=cors_config)


class TokenMetrics(BaseModel):
    """
    Token usage metrics model.

    Attributes:
        input: Number of input tokens
        output: Number of output tokens
        total: Total number of tokens (input + output)
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    input: int = Field(default=0, ge=0, description="Number of input tokens")
    output: int = Field(default=0, ge=0, description="Number of output tokens")
    total: int = Field(default=0, ge=0, description="Total number of tokens")


class MemoryMetrics(BaseModel):
    """
    Memory usage metrics model.

    Attributes:
        event_count: Number of events stored in AgentCore Memory
        error: Whether there was an error retrieving memory metrics
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    event_count: int = Field(default=0, ge=0, description="Number of events in memory")
    error: bool = Field(default=False, description="Error flag for memory retrieval")


class MetricsResponse(BaseModel):
    """
    Complete metrics response model.

    Attributes:
        tokens: Token usage metrics
        memory: Memory usage metrics
        last_updated: ISO 8601 timestamp of last update
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    tokens: TokenMetrics
    memory: MemoryMetrics
    last_updated: str = Field(..., description="ISO 8601 timestamp")


class Agent(BaseModel):
    """
    Agent information model.

    Attributes:
        name: Agent name
        description: Agent description
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    name: str = Field(..., description="Agent name")
    description: str = Field(..., description="Agent description")


class Tool(BaseModel):
    """
    Tool information model.

    Attributes:
        name: Tool name
        description: Tool description
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    name: str = Field(..., description="Tool name")
    description: str = Field(..., description="Tool description")


@app.get("/metrics")
def get_metrics() -> Dict[str, Any]:
    """
    Handle GET /metrics endpoint.

    This endpoint retrieves conversation metrics including token usage and
    memory event counts. It handles errors gracefully by returning partial
    data when possible (e.g., if Memory query fails, still return token metrics).

    Query Parameters:
        sessionId: Conversation session identifier (required)

    Returns:
        MetricsResponse with token and memory metrics, or error response

    Error Handling:
        - Returns 400 if sessionId is missing or invalid
        - Returns 401 if authentication fails
        - Returns 500 for unexpected errors
        - Returns partial data (200) when individual metric sources fail
    """
    try:
        # Get sessionId from query parameters
        session_id = app.current_event.get_query_string_value(
            name="sessionId", default_value=None
        )

        if not session_id:
            return {"error": "sessionId query parameter is required"}, 400

        # Validate sessionId format (basic validation)
        if not session_id.strip():
            return {"error": "sessionId cannot be empty"}, 400

        # Extract user ID from Cognito claims
        request_context = app.current_event.request_context
        authorizer = request_context.authorizer
        claims = authorizer.get("claims", {}) if authorizer else {}

        if not claims:
            return {"error": "Unauthorized"}, 401

        user_id = claims.get("sub")
        if not user_id:
            logger.warning("No 'sub' claim found in JWT token")
            return {"error": "Invalid authentication token"}, 401

        # Get session metrics with graceful error handling
        # This function returns partial data if individual sources fail
        metrics = get_session_metrics(session_id=session_id, user_id=user_id)

        return metrics.model_dump(by_alias=True)

    except ValueError as e:
        logger.warning(f"Validation error: {str(e)}")
        return {"error": str(e)}, 400

    except Exception as e:
        logger.error(f"Unexpected error retrieving metrics: {str(e)}")
        return {"error": "Internal server error"}, 500


@app.get("/agents")
def get_agents() -> Dict[str, Any]:
    """
    Handle GET /agents endpoint.

    Returns:
        List of available agents
    """
    try:
        # Extract user ID from Cognito claims for authentication
        request_context = app.current_event.request_context
        authorizer = request_context.authorizer
        claims = authorizer.get("claims", {}) if authorizer else {}

        if not claims:
            return {"error": "Unauthorized"}, 401

        # Query AgentCore Gateway for agents
        agents = query_gateway_resources(resource_type="agents")

        return {"agents": [agent.model_dump(by_alias=True) for agent in agents]}

    except Exception as e:
        logger.error(f"Error retrieving agents: {str(e)}")
        return {"agents": [], "error": "Gateway unavailable"}


@app.get("/tools")
def get_tools() -> Dict[str, Any]:
    """
    Handle GET /tools endpoint.

    Returns:
        List of available tools
    """
    try:
        # Extract user ID from Cognito claims for authentication
        request_context = app.current_event.request_context
        authorizer = request_context.authorizer
        claims = authorizer.get("claims", {}) if authorizer else {}

        if not claims:
            return {"error": "Unauthorized"}, 401

        # Query AgentCore Gateway for tools
        tools = query_gateway_resources(resource_type="tools")

        return {"tools": [tool.model_dump(by_alias=True) for tool in tools]}

    except Exception as e:
        logger.error(f"Error retrieving tools: {str(e)}")
        return {"tools": [], "error": "Gateway unavailable"}


def get_session_metrics(session_id: str, user_id: str) -> MetricsResponse:
    """
    Aggregate metrics for a conversation session.

    This function retrieves metrics from multiple sources and handles failures
    gracefully by returning partial data when possible. If token metrics cannot
    be retrieved, it returns zeros. If memory metrics fail, it returns zero
    with an error flag.

    Args:
        session_id: Conversation session identifier
        user_id: User identifier from JWT token

    Returns:
        MetricsResponse containing token metrics and memory count

    Note:
        This function does not raise exceptions. It returns partial data
        with error flags when individual metric sources fail.
    """
    # Get token metrics from DynamoDB with graceful error handling
    try:
        token_metrics = get_token_metrics(session_id=session_id)
    except Exception as e:
        logger.error(f"Failed to retrieve token metrics, returning zeros: {str(e)}")
        token_metrics = TokenMetrics(input=0, output=0, total=0)

    # Get memory event count from AgentCore Memory with graceful error handling
    try:
        memory_metrics = query_memory_events(
            memory_id=AGENTCORE_MEMORY_ID, session_id=session_id, actor_id=user_id
        )
    except Exception as e:
        logger.error(
            f"Failed to retrieve memory metrics, returning error state: {str(e)}"
        )
        memory_metrics = MemoryMetrics(event_count=0, error=True)

    # Get current timestamp in ISO 8601 format
    from datetime import datetime, timezone

    last_updated = datetime.now(timezone.utc).isoformat()

    return MetricsResponse(
        tokens=token_metrics, memory=memory_metrics, last_updated=last_updated
    )


def get_token_metrics(session_id: str) -> TokenMetrics:
    """
    Retrieve cumulative token metrics from DynamoDB.

    Args:
        session_id: Conversation session identifier

    Returns:
        TokenMetrics with input, output, and total token counts

    Raises:
        ClientError: If DynamoDB query fails
    """
    try:
        response = dynamodb.get_item(
            TableName=TOKEN_METRICS_TABLE_NAME, Key={"sessionId": {"S": session_id}}
        )

        if "Item" not in response:
            # No metrics yet for this session
            return TokenMetrics(input=0, output=0, total=0)

        item = response["Item"]
        input_tokens = int(item.get("inputTokens", {}).get("N", "0"))
        output_tokens = int(item.get("outputTokens", {}).get("N", "0"))
        total_tokens = int(item.get("totalTokens", {}).get("N", "0"))

        return TokenMetrics(
            input=input_tokens, output=output_tokens, total=total_tokens
        )

    except ClientError as e:
        logger.error(f"Error retrieving token metrics: {str(e)}")
        raise


def track_token_usage(session_id: str, input_tokens: int, output_tokens: int) -> None:
    """
    Store token usage metrics in DynamoDB using atomic ADD operations.

    This function updates the cumulative token counts for a conversation session.
    It uses DynamoDB's atomic ADD operation to safely increment counters even
    with concurrent updates. A TTL (time-to-live) is set to automatically
    delete metrics after 7 days.

    Args:
        session_id: Conversation session identifier
        input_tokens: Number of input tokens to add to the cumulative count
        output_tokens: Number of output tokens to add to the cumulative count

    Raises:
        ClientError: If DynamoDB update operation fails

    Note:
        The total token count is calculated as input_tokens + output_tokens
        and stored atomically along with the individual counts.
    """
    try:
        # Calculate TTL: 7 days from now in Unix timestamp
        from datetime import datetime, timedelta, timezone

        ttl_timestamp = int(
            (datetime.now(timezone.utc) + timedelta(days=7)).timestamp()
        )

        # Get current timestamp in ISO 8601 format
        last_updated = datetime.now(timezone.utc).isoformat()

        # Calculate total tokens
        total_tokens = input_tokens + output_tokens

        # Use atomic ADD operation to increment token counts
        # This ensures safe concurrent updates without race conditions
        dynamodb.update_item(
            TableName=TOKEN_METRICS_TABLE_NAME,
            Key={"sessionId": {"S": session_id}},
            UpdateExpression=(
                "ADD inputTokens :input, outputTokens :output, totalTokens :total "
                "SET lastUpdated = :updated, #ttl = :ttl"
            ),
            ExpressionAttributeNames={
                "#ttl": "ttl"  # ttl is a reserved word in DynamoDB
            },
            ExpressionAttributeValues={
                ":input": {"N": str(input_tokens)},
                ":output": {"N": str(output_tokens)},
                ":total": {"N": str(total_tokens)},
                ":updated": {"S": last_updated},
                ":ttl": {"N": str(ttl_timestamp)},
            },
        )

        logger.info(
            f"Successfully tracked token usage for session {session_id}: "
            f"input={input_tokens}, output={output_tokens}, total={total_tokens}"
        )

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"]["Message"]
        logger.error(
            f"DynamoDB ClientError while tracking token usage for session {session_id}: "
            f"Code={error_code}, Message={error_message}"
        )
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error while tracking token usage for session {session_id}: {str(e)}"
        )
        raise


def query_memory_events(
    memory_id: str, session_id: str, actor_id: str
) -> MemoryMetrics:
    """
    Query AgentCore Memory for event count.

    This function calls the AgentCore Memory ListEvents API to retrieve
    the count of events stored for a specific conversation session and actor.
    It handles pagination to count all events if there are more than the
    maximum results per page.

    Args:
        memory_id: AgentCore Memory resource ID
        session_id: Conversation session identifier
        actor_id: User identifier

    Returns:
        MemoryMetrics with event count and error flag

    Note:
        Returns error=True and event_count=0 if query fails
    """
    try:
        logger.info(
            f"Querying memory events for memory_id={memory_id}, "
            f"session_id={session_id}, actor_id={actor_id}"
        )

        # Query AgentCore Memory using ListEvents API
        # Use maxResults to limit the response size for efficiency
        response = agentcore_memory.list_events(
            memoryId=memory_id,
            actorId=actor_id,
            sessionId=session_id,
            maxResults=100,  # Get up to 100 events per page
        )

        # Extract events from response
        events = response.get("events", [])
        event_count = len(events)

        # Handle pagination if there are more events
        # Note: For most conversations, 100 events should be sufficient
        # If there are more, we'll need to paginate through them
        next_token = response.get("nextToken")
        while next_token:
            logger.debug("Paginating memory events, next_token present")
            response = agentcore_memory.list_events(
                memoryId=memory_id,
                actorId=actor_id,
                sessionId=session_id,
                maxResults=100,
                nextToken=next_token,
            )
            events = response.get("events", [])
            event_count += len(events)
            next_token = response.get("nextToken")

        logger.info(
            f"Successfully retrieved {event_count} memory events for session {session_id}"
        )

        return MemoryMetrics(event_count=event_count, error=False)

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.error(
            f"ClientError querying memory events: Code={error_code}, Message={error_message}"
        )
        return MemoryMetrics(event_count=0, error=True)
    except Exception as e:
        logger.error(f"Unexpected error querying memory events: {str(e)}")
        return MemoryMetrics(event_count=0, error=True)


def query_gateway_resources(resource_type: str) -> List[Any]:
    """
    Query AgentCore Gateway for agents or tools via MCP protocol.

    This function queries the AgentCore Gateway using JSON-RPC 2.0 protocol
    over HTTP. The Gateway exposes tools via the MCP (Model Context Protocol)
    tools/list endpoint.

    Note: AgentCore Gateway does not expose an agents/list endpoint via MCP.
    Agents are runtime instances that consume tools, not resources exposed by
    the Gateway. For the agents endpoint, this function returns an empty list.

    Args:
        resource_type: "agents" or "tools"

    Returns:
        List of Agent or Tool objects

    Raises:
        ValueError: If resource_type is invalid
        Exception: If gateway query fails (for tools only)
    """
    logger.info(f"Querying gateway for {resource_type} at {AGENTCORE_GATEWAY_URL}")

    if resource_type == "agents":
        # AgentCore Gateway does not expose agents via MCP protocol.
        # Agents are runtime instances that use the Gateway's tools.
        # Return empty list as agents are not a Gateway resource.
        logger.info(
            "Agents are not exposed by AgentCore Gateway MCP protocol. "
            "Returning empty list."
        )
        return []

    elif resource_type == "tools":
        # Query Gateway for tools using MCP protocol (JSON-RPC 2.0)
        return _query_gateway_tools()

    else:
        raise ValueError(f"Invalid resource_type: {resource_type}")


def _query_gateway_tools() -> List[Tool]:
    """
    Query AgentCore Gateway for available tools using MCP protocol.

    This function makes an HTTP POST request to the Gateway using JSON-RPC 2.0
    format with the tools/list method. It requires authentication via OAuth2
    access token obtained from Cognito.

    Returns:
        List of Tool objects with name and description

    Raises:
        Exception: If gateway query fails or returns an error

    Note:
        The Gateway URL is read from SSM Parameter Store using the path
        specified in the AGENTCORE_GATEWAY_URL environment variable.
        Authentication credentials are also retrieved from SSM and Secrets Manager.
    """
    import requests

    if not AGENTCORE_GATEWAY_URL:
        logger.error("AGENTCORE_GATEWAY_URL environment variable is not set")
        raise ValueError("Gateway URL is not configured")

    try:
        # Get the actual Gateway URL from SSM Parameter Store
        # The environment variable contains the SSM parameter path, not the URL itself
        gateway_url = _get_ssm_parameter(parameter_name=AGENTCORE_GATEWAY_URL)
        logger.info(f"Retrieved Gateway URL from SSM: {gateway_url}")

        # Get OAuth2 access token for Gateway authentication
        access_token = _get_gateway_access_token()

        # Prepare JSON-RPC 2.0 request for tools/list
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        }

        payload = {
            "jsonrpc": "2.0",
            "id": "list-tools-request",
            "method": "tools/list",
        }

        logger.info(f"Sending tools/list request to Gateway: {gateway_url}")

        # Make HTTP POST request to Gateway
        response = requests.post(
            gateway_url,
            headers=headers,
            json=payload,
            timeout=10,  # 10 second timeout for Gateway requests
        )

        # Check HTTP response status
        if response.status_code != 200:
            logger.error(
                f"Gateway returned non-200 status: {response.status_code} - {response.text}"
            )
            raise Exception(
                f"Gateway request failed with status {response.status_code}"
            )

        # Parse JSON-RPC response
        response_data = response.json()

        # Check for JSON-RPC error
        if "error" in response_data:
            error = response_data["error"]
            logger.error(f"Gateway returned JSON-RPC error: {error}")
            raise Exception(f"Gateway error: {error.get('message', 'Unknown error')}")

        # Extract tools from result
        result = response_data.get("result", {})
        tools_data = result.get("tools", [])

        logger.info(f"Successfully retrieved {len(tools_data)} tools from Gateway")

        # Parse tools into Tool objects
        tools = []
        for tool_data in tools_data:
            try:
                tool = Tool(
                    name=tool_data.get("name", ""),
                    description=tool_data.get("description", ""),
                )
                tools.append(tool)
            except Exception as e:
                logger.warning(f"Failed to parse tool data: {tool_data}, error: {e}")
                # Continue processing other tools even if one fails
                continue

        return tools

    except requests.exceptions.Timeout:
        logger.error("Gateway request timed out")
        raise Exception("Gateway request timed out")
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Failed to connect to Gateway: {e}")
        raise Exception("Failed to connect to Gateway")
    except requests.exceptions.RequestException as e:
        logger.error(f"Gateway request failed: {e}")
        raise Exception(f"Gateway request failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error querying Gateway tools: {e}")
        raise


def _get_gateway_access_token() -> str:
    """
    Get OAuth2 access token for AgentCore Gateway authentication.

    This function retrieves the machine client credentials from SSM Parameter
    Store and Secrets Manager, then uses the OAuth2 client credentials flow
    to obtain an access token from Cognito.

    Returns:
        OAuth2 access token string

    Raises:
        Exception: If token retrieval fails

    Note:
        Requires STACK_NAME environment variable to be set. The function
        retrieves credentials from:
        - SSM: /{stack_name}/machine_client_id
        - SSM: /{stack_name}/cognito_provider
        - Secrets Manager: /{stack_name}/machine_client_secret
    """
    import base64

    import requests

    try:
        # Get stack name from environment variable
        stack_name = os.environ.get("STACK_NAME", "")
        if not stack_name:
            logger.error("STACK_NAME environment variable is not set")
            raise ValueError("Stack name is not configured")

        logger.info(f"Getting access token for stack: {stack_name}")

        # Get Cognito configuration from SSM and Secrets Manager
        cognito_domain = _get_ssm_parameter(
            parameter_name=f"/{stack_name}/cognito_provider"
        )
        client_id = _get_ssm_parameter(
            parameter_name=f"/{stack_name}/machine_client_id"
        )
        client_secret = _get_secret(secret_name=f"/{stack_name}/machine_client_secret")

        logger.info(f"Cognito domain: {cognito_domain}")
        logger.info(f"Client ID: {client_id[:10]}...")

        # Prepare OAuth2 token request
        token_url = f"https://{cognito_domain}/oauth2/token"

        # Create Basic Auth header (base64-encoded client_id:client_secret)
        credentials = f"{client_id}:{client_secret}"
        b64_credentials = base64.b64encode(credentials.encode()).decode()

        headers = {
            "Authorization": f"Basic {b64_credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        data = {
            "grant_type": "client_credentials",
            "scope": f"{stack_name}-gateway/read {stack_name}-gateway/write",
        }

        logger.info(f"Requesting token from: {token_url}")
        logger.info(f"Scopes: {data['scope']}")

        # Request access token from Cognito
        response = requests.post(url=token_url, headers=headers, data=data, timeout=10)

        if response.status_code != 200:
            logger.error(f"Token request failed: {response.status_code}")
            logger.error(f"Response: {response.text}")
            raise Exception(
                f"Failed to get access token: {response.status_code} - {response.text}"
            )

        token_data = response.json()
        access_token = token_data.get("access_token")

        if not access_token:
            logger.error(f"No access_token in response: {token_data}")
            raise Exception("No access_token in Cognito response")

        logger.info(f"Successfully got access token: {access_token[:20]}...")
        return access_token

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to request access token: {e}")
        raise Exception(f"Token request failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error getting access token: {e}")
        raise


def _get_ssm_parameter(parameter_name: str) -> str:
    """
    Fetch a parameter value from AWS SSM Parameter Store.

    SSM Parameter Store is AWS's service for storing configuration values
    securely. This function retrieves values like Gateway URLs and other
    stack-specific configuration that are set during CDK deployment.

    Args:
        parameter_name: The full SSM parameter name/path
            (e.g. '/my-stack/gateway_url')

    Returns:
        The parameter value as a string

    Raises:
        ValueError: If the parameter is not found or cannot be retrieved
    """
    ssm = boto3.client("ssm")
    try:
        response = ssm.get_parameter(Name=parameter_name)
        return response["Parameter"]["Value"]
    except ssm.exceptions.ParameterNotFound:
        logger.error(f"SSM parameter not found: {parameter_name}")
        raise ValueError(f"SSM parameter not found: {parameter_name}")
    except Exception as e:
        logger.error(f"Failed to retrieve SSM parameter {parameter_name}: {e}")
        raise ValueError(f"Failed to retrieve SSM parameter {parameter_name}: {e}")


def _get_secret(secret_name: str) -> str:
    """
    Fetch a secret value from AWS Secrets Manager.

    Secrets Manager is designed for storing sensitive information like passwords,
    API keys, and other secrets with automatic rotation capabilities.

    Args:
        secret_name: The name or ARN of the secret to retrieve

    Returns:
        The secret value as a string

    Raises:
        ValueError: If the secret is not found or cannot be accessed
        RuntimeError: If there's an AWS service error
    """
    secrets_client = boto3.client("secretsmanager")

    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        return response["SecretString"]
    except secrets_client.exceptions.ResourceNotFoundException:
        logger.error(f"Secret not found: {secret_name}")
        raise ValueError(f"Secret not found: {secret_name}")
    except secrets_client.exceptions.InvalidParameterException:
        logger.error(f"Invalid secret parameter: {secret_name}")
        raise ValueError(f"Invalid secret parameter: {secret_name}")
    except secrets_client.exceptions.InvalidRequestException:
        logger.error(f"Invalid request for secret: {secret_name}")
        raise ValueError(f"Invalid request for secret: {secret_name}")
    except secrets_client.exceptions.DecryptionFailureException:
        logger.error(f"Failed to decrypt secret: {secret_name}")
        raise RuntimeError(f"Failed to decrypt secret: {secret_name}")
    except secrets_client.exceptions.InternalServiceErrorException:
        logger.error(f"AWS Secrets Manager service error for secret: {secret_name}")
        raise RuntimeError(
            f"AWS Secrets Manager service error for secret: {secret_name}"
        )
    except Exception as e:
        logger.error(f"Unexpected error retrieving secret {secret_name}: {str(e)}")
        raise RuntimeError(
            f"Unexpected error retrieving secret {secret_name}: {str(e)}"
        )


@logger.inject_lambda_context(correlation_id_path=API_GATEWAY_REST)
@tracer.capture_lambda_handler
def handler(event: dict, context: LambdaContext) -> dict:
    """
    Lambda handler for metrics API.

    Routes:
        GET /metrics?sessionId={id} - Get current metrics for session
        GET /agents - List available agents
        GET /tools - List available tools

    Args:
        event: API Gateway event with request details
        context: Lambda context

    Returns:
        API Gateway response with metrics data or error
    """
    return app.resolve(event, context)

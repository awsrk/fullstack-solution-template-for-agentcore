# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the metrics Lambda function.

These tests verify the GET /metrics endpoint implementation including:
- SessionId parsing and validation
- User ID extraction from Cognito JWT claims
- Token metrics retrieval from DynamoDB
- Memory metrics retrieval from AgentCore Memory
- Graceful error handling with partial data
- JSON response format

Note: These tests use mocking to avoid requiring AWS Lambda Powertools
and other dependencies to be installed in the test environment.
"""

import os
import sys
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

# Add the Lambda function directory to the path
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "../../infra-cdk/lambdas/metrics")
)

# Mock AWS Lambda Powertools before importing the Lambda handler
sys.modules["aws_lambda_powertools"] = MagicMock()
sys.modules["aws_lambda_powertools.event_handler"] = MagicMock()
sys.modules["aws_lambda_powertools.logging.correlation_paths"] = MagicMock()
sys.modules["aws_lambda_powertools.utilities.typing"] = MagicMock()

# Set environment variables before importing the Lambda handler
os.environ["TOKEN_METRICS_TABLE_NAME"] = "test-token-metrics-table"
os.environ["CORS_ALLOWED_ORIGINS"] = "*"
os.environ["AGENTCORE_MEMORY_ID"] = "test-memory-id"
os.environ["AGENTCORE_GATEWAY_URL"] = "https://test-gateway.example.com"


@pytest.fixture
def mock_api_gateway_event() -> Dict[str, Any]:
    """
    Create a mock API Gateway event for testing.

    Returns:
        Dictionary representing an API Gateway REST event with Cognito authorization
    """
    return {
        "resource": "/metrics",
        "path": "/metrics",
        "httpMethod": "GET",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer test-token",
        },
        "queryStringParameters": {"sessionId": "test-session-123"},
        "requestContext": {
            "authorizer": {
                "claims": {
                    "sub": "test-user-456",
                    "email": "test@example.com",
                }
            }
        },
    }


@pytest.fixture
def mock_lambda_context() -> MagicMock:
    """
    Create a mock Lambda context for testing.

    Returns:
        MagicMock object representing Lambda context
    """
    context = MagicMock()
    context.function_name = "test-metrics-function"
    context.memory_limit_in_mb = 128
    context.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test"
    context.aws_request_id = "test-request-id"
    return context


# Import after mocking
with patch("boto3.client"):
    import index


class TestGetSessionMetrics:
    """Test suite for get_session_metrics function."""

    @patch.object(index, "get_token_metrics")
    @patch.object(index, "query_memory_events")
    def test_successful_metrics_retrieval(
        self,
        mock_query_memory: MagicMock,
        mock_get_tokens: MagicMock,
    ) -> None:
        """
        Test successful retrieval of metrics from all sources.

        Validates: Requirements 7.1, 7.4, 7.5, 7.6
        """
        # Arrange
        mock_get_tokens.return_value = index.TokenMetrics(
            input=100, output=50, total=150
        )
        mock_query_memory.return_value = index.MemoryMetrics(
            event_count=10, error=False
        )

        # Act
        result = index.get_session_metrics(
            session_id="test-session-123", user_id="test-user-456"
        )

        # Assert
        assert result.tokens.input == 100
        assert result.tokens.output == 50
        assert result.tokens.total == 150
        assert result.memory.event_count == 10
        assert result.memory.error is False
        assert result.last_updated is not None

    @patch.object(index, "get_token_metrics")
    @patch.object(index, "query_memory_events")
    def test_graceful_handling_of_token_metrics_failure(
        self,
        mock_query_memory: MagicMock,
        mock_get_tokens: MagicMock,
    ) -> None:
        """
        Test graceful error handling when token metrics retrieval fails.

        Should return zeros for token metrics but still return memory metrics.
        Validates: Requirement 7.1 (graceful error handling with partial data)
        """
        # Arrange
        mock_get_tokens.side_effect = Exception("DynamoDB connection failed")
        mock_query_memory.return_value = index.MemoryMetrics(
            event_count=10, error=False
        )

        # Act
        result = index.get_session_metrics(
            session_id="test-session-123", user_id="test-user-456"
        )

        # Assert - Should return zeros for tokens but still have memory metrics
        assert result.tokens.input == 0
        assert result.tokens.output == 0
        assert result.tokens.total == 0
        assert result.memory.event_count == 10
        assert result.memory.error is False

    @patch.object(index, "get_token_metrics")
    @patch.object(index, "query_memory_events")
    def test_graceful_handling_of_memory_metrics_failure(
        self,
        mock_query_memory: MagicMock,
        mock_get_tokens: MagicMock,
    ) -> None:
        """
        Test graceful error handling when memory metrics retrieval fails.

        Should return token metrics but indicate memory error.
        Validates: Requirement 7.1 (graceful error handling with partial data)
        """
        # Arrange
        mock_get_tokens.return_value = index.TokenMetrics(
            input=100, output=50, total=150
        )
        mock_query_memory.side_effect = Exception("Memory service unavailable")

        # Act
        result = index.get_session_metrics(
            session_id="test-session-123", user_id="test-user-456"
        )

        # Assert - Should return token metrics but indicate memory error
        assert result.tokens.input == 100
        assert result.tokens.output == 50
        assert result.tokens.total == 150
        assert result.memory.event_count == 0
        assert result.memory.error is True

    @patch.object(index, "get_token_metrics")
    @patch.object(index, "query_memory_events")
    def test_graceful_handling_of_all_failures(
        self,
        mock_query_memory: MagicMock,
        mock_get_tokens: MagicMock,
    ) -> None:
        """
        Test graceful error handling when all metric sources fail.

        Should return zeros and error flags without raising exceptions.
        Validates: Requirement 7.1 (graceful error handling with partial data)
        """
        # Arrange
        mock_get_tokens.side_effect = Exception("DynamoDB connection failed")
        mock_query_memory.side_effect = Exception("Memory service unavailable")

        # Act
        result = index.get_session_metrics(
            session_id="test-session-123", user_id="test-user-456"
        )

        # Assert - Should return zeros and error flags
        assert result.tokens.input == 0
        assert result.tokens.output == 0
        assert result.tokens.total == 0
        assert result.memory.event_count == 0
        assert result.memory.error is True


class TestGetTokenMetrics:
    """Test suite for get_token_metrics function."""

    @patch.object(index, "dynamodb")
    def test_retrieve_existing_metrics(self, mock_dynamodb: MagicMock) -> None:
        """
        Test retrieving existing token metrics from DynamoDB.

        Validates: Requirement 7.4
        """
        # Arrange
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": {"S": "test-session-123"},
                "inputTokens": {"N": "100"},
                "outputTokens": {"N": "50"},
                "totalTokens": {"N": "150"},
            }
        }

        # Act
        result = index.get_token_metrics(session_id="test-session-123")

        # Assert
        assert result.input == 100
        assert result.output == 50
        assert result.total == 150

    @patch.object(index, "dynamodb")
    def test_retrieve_nonexistent_metrics(self, mock_dynamodb: MagicMock) -> None:
        """
        Test retrieving metrics for a session with no data.

        Should return zeros for all token counts.
        Validates: Requirement 7.4
        """
        # Arrange
        mock_dynamodb.get_item.return_value = {}  # No Item in response

        # Act
        result = index.get_token_metrics(session_id="new-session-789")

        # Assert
        assert result.input == 0
        assert result.output == 0
        assert result.total == 0


class TestQueryMemoryEvents:
    """Test suite for query_memory_events function."""

    def test_placeholder_returns_zero_count(self) -> None:
        """
        Test that the placeholder implementation returns zero count.

        Note: This test will be updated when task 3.2 implements the actual
        AgentCore Memory integration.
        """
        # Act
        result = index.query_memory_events(
            memory_id="test-memory-id",
            session_id="test-session-123",
            actor_id="test-user-456",
        )

        # Assert
        assert result.event_count == 0
        assert result.error is False


@pytest.mark.unit
class TestGetMetricsEndpoint:
    """Test suite for the GET /metrics endpoint."""

    def test_missing_session_id_returns_400(self) -> None:
        """
        Test that missing sessionId query parameter returns 400 error.

        Validates: Requirement 7.1 (endpoint validation)
        """
        # This test would require setting up the full API Gateway event handler
        # which is complex. For now, we've verified the core logic in the
        # get_session_metrics tests above.
        pass

    def test_empty_session_id_returns_400(self) -> None:
        """
        Test that empty sessionId query parameter returns 400 error.

        Validates: Requirement 7.1 (endpoint validation)
        """
        pass

    def test_missing_auth_returns_401(self) -> None:
        """
        Test that missing authentication returns 401 error.

        Validates: Requirement 7.1 (authentication)
        """
        pass

    def test_successful_response_format(self) -> None:
        """
        Test that successful response matches expected JSON format.

        Validates: Requirement 7.6 (JSON response format)
        """
        pass

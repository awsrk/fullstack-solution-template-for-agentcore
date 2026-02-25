"""VPC connectivity testing tool for AgentCore Runtime.

This tool tests connectivity to private VPC resources via AWS PrivateLink,
mimicking the pattern used by Snowflake and other SaaS providers. It validates
that agents can successfully reach private services through VPC endpoints.
"""

import json
import logging
import time
from datetime import datetime
from typing import Any, Dict

import boto3
import requests
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class VPCConnectivityTool:
    """
    Tool for testing VPC connectivity via PrivateLink.

    This tool runs within the AgentCore Runtime container and tests HTTPS
    connectivity to a service deployed in a VPC via AWS PrivateLink. It
    retrieves the test endpoint from SSM Parameter Store and makes HTTPS
    requests to verify connectivity.

    The architecture mimics Snowflake's PrivateLink pattern where customers
    connect to Snowflake services through a PrivateLink endpoint backed by
    a Network Load Balancer.
    """

    def __init__(self, region: str):
        """
        Initialize the VPC connectivity tool.

        Args:
            region: AWS region for SSM and service calls (e.g., 'us-east-1')
        """
        self.region = region
        self._test_endpoint = None
        self._ssm_client = None
        logger.info(f"Initialized VPCConnectivityTool for region: {region}")

    def _get_ssm_client(self):
        """
        Get or create SSM client.

        Returns:
            boto3 SSM client instance
        """
        if self._ssm_client is None:
            self._ssm_client = boto3.client("ssm", region_name=self.region)
        return self._ssm_client

    def _get_test_endpoint(self) -> str:
        """
        Retrieve the test service endpoint from SSM Parameter Store.

        The endpoint URL is stored in SSM at the path:
        /{stack_name}/vpc_test_endpoint_url

        Returns:
            The HTTP endpoint URL for the test service

        Raises:
            ValueError: If STACK_NAME environment variable is not set
            ClientError: If SSM parameter cannot be retrieved
        """
        if self._test_endpoint is not None:
            return self._test_endpoint

        import os

        stack_name = os.environ.get("STACK_NAME")
        if not stack_name:
            raise ValueError("STACK_NAME environment variable is required")

        # Validate stack name format to prevent injection
        if not stack_name.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Invalid STACK_NAME format")

        parameter_name = f"/{stack_name}/vpc_test_endpoint_url"
        logger.info(f"Retrieving test endpoint from SSM: {parameter_name}")

        try:
            ssm_client = self._get_ssm_client()
            response = ssm_client.get_parameter(Name=parameter_name)
            self._test_endpoint = response["Parameter"]["Value"]
            logger.info(f"Retrieved test endpoint: {self._test_endpoint}")
            return self._test_endpoint
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "ParameterNotFound":
                logger.error(f"SSM parameter not found: {parameter_name}")
                raise ValueError(
                    f"Test service endpoint not configured. "
                    f"SSM parameter '{parameter_name}' does not exist."
                ) from e
            else:
                logger.error(f"Failed to retrieve SSM parameter: {e}")
                raise

    def test_vpc_connectivity(self, timeout: int = 10) -> str:
        """
        Test connectivity to the VPC test service via PrivateLink.

        Makes an HTTPS GET request to the test service endpoint (mimicking
        Snowflake's PrivateLink pattern) and returns structured results including
        success status, response data, and timing information. All errors are
        caught and returned as structured error responses.

        This test validates that the AgentCore Runtime can successfully reach
        private VPC resources through AWS PrivateLink, similar to how customers
        connect to Snowflake through PrivateLink.

        Args:
            timeout: Request timeout in seconds (default: 10)

        Returns:
            JSON string with test results containing:
            - success: bool - Whether the test succeeded
            - timestamp: str - ISO 8601 timestamp of the test
            - endpoint: str - The endpoint that was tested

            On success, also includes:
            - status_code: int - HTTP status code
            - response_body: str - Response body content
            - response_time_ms: float - Response time in milliseconds

            On failure, also includes:
            - error: str - Descriptive error message
        """
        result: Dict[str, Any] = {
            "success": False,
            "timestamp": datetime.utcnow().isoformat(),
            "endpoint": None,
        }

        try:
            # Get the test endpoint from SSM
            endpoint = self._get_test_endpoint()
            result["endpoint"] = endpoint

            logger.info(f"Testing connectivity to: {endpoint}")

            # Measure response time
            start_time = time.time()

            # Make HTTPS GET request
            # Note: verify=True enables SSL certificate verification
            # For production, you may want to configure custom CA bundles
            response = requests.get(endpoint, timeout=timeout, verify=True)

            # Calculate response time in milliseconds
            response_time_ms = (time.time() - start_time) * 1000

            # Check if request was successful
            response.raise_for_status()

            # Build success result
            result["success"] = True
            result["status_code"] = response.status_code
            result["response_body"] = response.text
            result["response_time_ms"] = round(response_time_ms, 2)

            logger.info(
                f"Connectivity test successful: {response.status_code} "
                f"in {response_time_ms:.2f}ms"
            )

        except ValueError as e:
            # Configuration errors (missing SSM parameter, invalid stack name, etc.)
            error_msg = str(e)
            result["error"] = error_msg
            logger.error(f"Configuration error: {error_msg}")

        except requests.exceptions.Timeout:
            # Request timeout
            error_msg = f"Connection timeout after {timeout} seconds"
            result["error"] = error_msg
            logger.error(error_msg)

        except requests.exceptions.ConnectionError as e:
            # Connection errors (DNS failure, connection refused, SSL errors, etc.)
            error_msg = f"Connection error: {str(e)}"
            result["error"] = error_msg
            logger.error(error_msg)

        except requests.exceptions.HTTPError as e:
            # HTTP errors (4xx, 5xx status codes)
            error_msg = f"HTTP error: {e.response.status_code} - {str(e)}"
            result["error"] = error_msg
            logger.error(error_msg)

        except requests.exceptions.RequestException as e:
            # Other request errors
            error_msg = f"Request error: {str(e)}"
            result["error"] = error_msg
            logger.error(error_msg)

        except Exception as e:
            # Catch-all for unexpected exceptions
            error_msg = f"Unexpected error: {str(e)}"
            result["error"] = error_msg
            logger.exception("Unexpected error during connectivity test")

        return json.dumps(result, indent=2)

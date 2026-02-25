# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""VPC Test Service Lambda Handler

This Lambda function serves as a simple HTTPS service for testing VPC connectivity
via AWS PrivateLink. It mimics Snowflake's PrivateLink pattern by responding to
HTTPS requests through a Network Load Balancer.

The function responds to requests with a JSON payload containing service
identification information and timestamps.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda function handler for VPC connectivity test service.

    This handler processes HTTPS requests from a Network Load Balancer (NLB)
    via Lambda Function URL and returns a simple JSON response to verify
    connectivity. It mimics Snowflake's PrivateLink pattern.

    The function logs all incoming requests for debugging purposes and includes
    error handling for unexpected exceptions.

    Args:
        event: Lambda Function URL event containing HTTP request details including
               headers, path, query parameters, and request metadata
        context: Lambda context object containing runtime information including
                request_id, function_name, and memory_limit_in_mb

    Returns:
        Lambda Function URL response dictionary with the following structure:
        - statusCode: HTTP status code (200 for success, 500 for errors)
        - headers: Response headers including Content-Type
        - body: JSON string containing service information

    Raises:
        No exceptions are raised; all errors are caught and returned as 500 responses
    """
    try:
        # Log incoming request for debugging
        logger.info(
            "Received connectivity test request",
            extra={
                "request_id": context.request_id,
                "path": event.get("rawPath", "/"),
                "http_method": event.get("requestContext", {})
                .get("http", {})
                .get("method", "GET"),
                "source_ip": event.get("requestContext", {})
                .get("http", {})
                .get("sourceIp", "unknown"),
            },
        )

        # Generate response with service identification information
        response_body = {
            "message": "Hello from VPC Test Service!",
            "service": "vpc-connectivity-test",
            "pattern": "snowflake-privatelink-mimic",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": context.request_id,
        }

        # Return successful Lambda Function URL response
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
            },
            "body": json.dumps(response_body),
        }

    except Exception as e:
        # Log exception with full traceback
        logger.exception(
            "Error processing connectivity test request",
            extra={
                "request_id": context.request_id,
                "error_type": type(e).__name__,
                "error_message": str(e),
            },
        )

        # Return error response
        error_body = {
            "message": "Internal server error",
            "service": "vpc-connectivity-test",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": context.request_id,
        }

        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
            },
            "body": json.dumps(error_body),
        }

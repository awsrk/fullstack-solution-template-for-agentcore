#!/usr/bin/env python3
"""
Test script for the Metrics API endpoints.

This script:
1. Gets an OAuth2 access token from Cognito
2. Tests the three metrics endpoints: /metrics, /agents, /tools
"""

import base64
import json
import sys

import boto3
import requests


# Get stack name from config
def get_stack_name():
    """Read stack name from CDK config."""
    import yaml

    with open("infra-cdk/config.yaml") as f:
        config = yaml.safe_load(f)
    return config["stack_name_base"]


def get_access_token(stack_name):
    """Get OAuth2 access token from Cognito."""
    ssm = boto3.client("ssm")
    secrets = boto3.client("secretsmanager")

    # Get Cognito configuration
    cognito_domain = ssm.get_parameter(Name=f"/{stack_name}/cognito_provider")[
        "Parameter"
    ]["Value"]
    client_id = ssm.get_parameter(Name=f"/{stack_name}/machine_client_id")["Parameter"][
        "Value"
    ]
    client_secret = secrets.get_secret_value(
        SecretId=f"/{stack_name}/machine_client_secret"
    )["SecretString"]

    # Request token
    token_url = f"https://{cognito_domain}/oauth2/token"
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

    response = requests.post(token_url, headers=headers, data=data)
    response.raise_for_status()

    return response.json()["access_token"]


def get_api_url(stack_name):
    """Get API Gateway URL from CloudFormation outputs."""
    cfn = boto3.client("cloudformation")
    response = cfn.describe_stacks(StackName=stack_name)

    for output in response["Stacks"][0]["Outputs"]:
        if output["OutputKey"] == "FeedbackApiUrl":
            return output["OutputValue"]

    raise ValueError("FeedbackApiUrl not found in stack outputs")


def test_metrics_endpoint(api_url, token):
    """Test GET /metrics endpoint."""
    print("\n=== Testing GET /metrics ===")
    url = f"{api_url}metrics?sessionId=test-session-123"
    headers = {"Authorization": f"Bearer {token}"}

    response = requests.get(url, headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    return response.status_code == 200


def test_agents_endpoint(api_url, token):
    """Test GET /agents endpoint."""
    print("\n=== Testing GET /agents ===")
    url = f"{api_url}agents"
    headers = {"Authorization": f"Bearer {token}"}

    response = requests.get(url, headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    return response.status_code == 200


def test_tools_endpoint(api_url, token):
    """Test GET /tools endpoint."""
    print("\n=== Testing GET /tools ===")
    url = f"{api_url}tools"
    headers = {"Authorization": f"Bearer {token}"}

    response = requests.get(url, headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    return response.status_code == 200


def main():
    """Main test function."""
    try:
        # Get configuration
        stack_name = get_stack_name()
        print(f"Stack name: {stack_name}")

        # Get access token
        print("\nGetting access token...")
        token = get_access_token(stack_name)
        print(f"Token: {token[:20]}...")

        # Get API URL
        api_url = get_api_url(stack_name)
        print(f"API URL: {api_url}")

        # Test endpoints
        results = {
            "metrics": test_metrics_endpoint(api_url, token),
            "agents": test_agents_endpoint(api_url, token),
            "tools": test_tools_endpoint(api_url, token),
        }

        # Summary
        print("\n=== Test Summary ===")
        for endpoint, passed in results.items():
            status = "✅ PASSED" if passed else "❌ FAILED"
            print(f"{endpoint}: {status}")

        # Exit code
        if all(results.values()):
            print("\n✅ All tests passed!")
            sys.exit(0)
        else:
            print("\n❌ Some tests failed")
            sys.exit(1)

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

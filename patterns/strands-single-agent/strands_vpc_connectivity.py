"""Strands-specific wrapper for VPC Connectivity Tool."""

from strands import tool

from tools.vpc_connectivity.vpc_connectivity_tool import VPCConnectivityTool


def create_vpc_connectivity_tool(region: str):
    """
    Create a Strands-compatible VPC connectivity testing tool.

    Args:
        region: AWS region for VPC connectivity testing

    Returns:
        A Strands tool function for testing VPC connectivity
    """
    core_tool = VPCConnectivityTool(region=region)

    @tool
    def test_vpc_connectivity() -> str:
        """
        Test connectivity to a VPC resource via PrivateLink.

        This tool makes an HTTPS request to a test service deployed in a VPC
        and returns the results. Use this to verify that the agent runtime
        can successfully reach private VPC resources through PrivateLink.

        The test mimics Snowflake's PrivateLink connectivity pattern where
        services are accessed through a VPC endpoint backed by a Network Load Balancer.

        Returns:
            JSON string with test results including success status, response data,
            and timing information.
        """
        return core_tool.test_vpc_connectivity()

    return test_vpc_connectivity

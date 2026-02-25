#!/bin/bash
# Deployment script for FAST backend

# Get AWS account and region from AWS CLI
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$(aws configure get region)

echo "Deploying to account: $CDK_DEFAULT_ACCOUNT in region: $CDK_DEFAULT_REGION"

# Deploy with CDK
cd infra-cdk
cdk deploy --all --require-approval never

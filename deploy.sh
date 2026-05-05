#!/bin/bash
# Full-stack deployment: CDK backend then frontend to Amplify.
# Usage: ./deploy.sh [--backend-only | --frontend-only]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true

for arg in "$@"; do
  case $arg in
    --backend-only)  DEPLOY_FRONTEND=false ;;
    --frontend-only) DEPLOY_BACKEND=false ;;
  esac
done

export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$(aws configure get region || echo "us-east-1")

echo "Account: $CDK_DEFAULT_ACCOUNT  Region: $CDK_DEFAULT_REGION"

if $DEPLOY_BACKEND; then
  echo ""
  echo "=== Deploying CDK backend ==="
  cd "$SCRIPT_DIR/infra-cdk"
  npx cdk deploy --all --require-approval never
  cd "$SCRIPT_DIR"
fi

if $DEPLOY_FRONTEND; then
  echo ""
  echo "=== Deploying frontend ==="
  python3 "$SCRIPT_DIR/scripts/deploy-frontend.py"
fi

echo ""
echo "Deployment complete."

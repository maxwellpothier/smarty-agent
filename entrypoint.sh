#!/bin/bash
set -e

echo "=== Smarty Agent Entrypoint ==="

# Validate required environment variables
if [ -z "$GH_TOKEN" ]; then
    echo "ERROR: GH_TOKEN environment variable is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY environment variable is required"
    exit 1
fi

if [ -z "$GH_REPO" ]; then
    echo "ERROR: GH_REPO environment variable is required"
    exit 1
fi

# Extract repo name from GH_REPO (e.g., smarty/smarty-typescript-sdk-react-example -> smarty-typescript-sdk-react-example)
REPO_NAME=$(echo "$GH_REPO" | cut -d'/' -f2)
REPO_PATH="/workspace/$REPO_NAME"

# Configure git
echo "Configuring git..."
git config --global user.email "smarty-agent@example.com"
git config --global user.name "Smarty Agent"
git config --global init.defaultBranch master

# Authenticate GitHub CLI (GH_TOKEN env var is used automatically)
echo "Verifying GitHub CLI authentication..."
gh auth status

# Clone repository if not present
if [ ! -d "$REPO_PATH" ]; then
    echo "Cloning repository $GH_REPO..."
    cd /workspace
    git clone "https://${GH_TOKEN}@github.com/${GH_REPO}.git"
else
    echo "Repository already exists at $REPO_PATH"
fi

# Configure git to use token for push operations
cd "$REPO_PATH"
git remote set-url origin "https://${GH_TOKEN}@github.com/${GH_REPO}.git"

# Export repo path for the server
export REPO_PATH="$REPO_PATH"

# Start the server
echo "Starting server on port ${PORT:-3000}..."
cd /app
exec node server.js

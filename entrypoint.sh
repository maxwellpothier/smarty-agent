#!/bin/bash
set -e

echo "=== Smarty Agent Entrypoint ==="

# Validate required environment variables
if [ -z "$BB_USERNAME" ]; then
    echo "ERROR: BB_USERNAME environment variable is required"
    exit 1
fi

if [ -z "$BB_EMAIL" ]; then
    echo "ERROR: BB_EMAIL environment variable is required"
    exit 1
fi

if [ -z "$BB_API_TOKEN" ]; then
    echo "ERROR: BB_API_TOKEN environment variable is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY environment variable is required"
    exit 1
fi

if [ -z "$BB_WORKSPACE" ]; then
    echo "ERROR: BB_WORKSPACE environment variable is required"
    exit 1
fi

if [ -z "$BB_REPO" ]; then
    echo "ERROR: BB_REPO environment variable is required"
    exit 1
fi

REPO_PATH="/workspace/$BB_REPO"

# Configure git
echo "Configuring git..."
git config --global user.email "claude-agent@example.com"
git config --global user.name "Claude Agent"
git config --global init.defaultBranch master

# Clone repository if not present
if [ ! -d "$REPO_PATH" ]; then
    echo "Cloning repository ${BB_WORKSPACE}/${BB_REPO}..."
    cd /workspace
    git clone "https://${BB_USERNAME}:${BB_API_TOKEN}@bitbucket.org/${BB_WORKSPACE}/${BB_REPO}.git"
else
    echo "Repository already exists at $REPO_PATH"
fi

# Configure git to use credentials for push operations
cd "$REPO_PATH"
git remote set-url origin "https://${BB_USERNAME}:${BB_API_TOKEN}@bitbucket.org/${BB_WORKSPACE}/${BB_REPO}.git"

# Export repo path for the server
export REPO_PATH="$REPO_PATH"

# Start the server
echo "Starting server on port ${PORT:-3000}..."
cd /app
exec node server.js

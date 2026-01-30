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
git config --global user.email "${BB_EMAIL}"
git config --global user.name "Claude Agent"
git config --global init.defaultBranch master

# Export repo path for the server
export REPO_PATH="$REPO_PATH"

# Clone repository in background if not present
if [ ! -f "$REPO_PATH/.clone-complete" ]; then
    echo "Cloning repository ${BB_WORKSPACE}/${BB_REPO} in background..."
    rm -rf "$REPO_PATH" 2>/dev/null || true
    (
        cd /workspace
        git clone --depth 1 "https://${BB_USERNAME}:${BB_API_TOKEN}@bitbucket.org/${BB_WORKSPACE}/${BB_REPO}.git"
        cd "$REPO_PATH"
        git remote set-url origin "https://${BB_USERNAME}:${BB_API_TOKEN}@bitbucket.org/${BB_WORKSPACE}/${BB_REPO}.git"
        touch .clone-complete
        echo "Repository clone complete!"
    ) &
else
    echo "Repository already exists at $REPO_PATH"
    cd "$REPO_PATH"
    git remote set-url origin "https://${BB_USERNAME}:${BB_API_TOKEN}@bitbucket.org/${BB_WORKSPACE}/${BB_REPO}.git"
fi

# Start the server
echo "Starting server on port ${PORT:-3000}..."
cd /app
exec node server.js

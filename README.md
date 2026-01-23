# Smarty Agent

A Docker-based service that receives HTTP POST requests and uses Claude Code to make code changes and create Bitbucket PRs.

## Prerequisites

- Docker
- Anthropic API key
- Bitbucket API token with `repository:write` and `pullrequest:write` scopes

## Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and fill in your credentials:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
BB_USERNAME=your-username
BB_EMAIL=your-email@example.com
BB_API_TOKEN=your-api-token-here
BB_WORKSPACE=your-workspace
BB_REPO=your-repo
PORT=3000
```

## Build

```bash
docker build -t smarty-agent .
```

## Run

```bash
docker run -d \
  --name smarty-agent \
  --env-file .env \
  -p 3000:3000 \
  smarty-agent
```

Or with inline environment variables:

```bash
docker run -d \
  --name smarty-agent \
  -e ANTHROPIC_API_KEY="your-key" \
  -e BB_USERNAME="your-username" \
  -e BB_EMAIL="your-email@example.com" \
  -e BB_API_TOKEN="your-api-token" \
  -e BB_WORKSPACE="your-workspace" \
  -e BB_REPO="your-repo" \
  -p 3000:3000 \
  smarty-agent
```

## API Endpoints

### POST /

Submit a code change request. Claude Code will make the changes and create a PR.

**Request:**

```json
{
  "request": "Add a loading spinner to the address lookup button"
}
```

**Response:**

```json
{
  "pr": "https://bitbucket.org/your-workspace/your-repo/pull-requests/123",
  "branch": "claude/add-a-loading-spinner-to-the-address-1705123456789"
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok"
}
```

## Test

Check health:

```bash
curl http://localhost:3000/health
```

Submit a code change request:

```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"request": "Add a comment at the top of App.tsx explaining what the component does"}'
```

## View Logs

```bash
docker logs -f smarty-agent
```

## Stop

```bash
docker stop smarty-agent
docker rm smarty-agent
```

## How It Works

1. On startup, the container clones the target repository from Bitbucket
2. When a POST request is received:
   - Fetches the latest `master` branch
   - Creates a new branch named `claude/<slugified-request>-<timestamp>`
   - Runs Claude Code (Sonnet model) with restricted permissions (Edit, Write, git add, git commit only)
   - Safety check: verifies the current branch starts with `claude/` before pushing
   - Pushes the branch and creates a PR via Bitbucket API
3. Returns the PR URL and branch name

## Security Notes

- Claude Code is restricted to only use `Edit`, `Write`, and `git add/commit` tools
- The service only pushes branches that start with `claude/` prefix
- Bitbucket API token should have minimal required scopes (repository and PR access only)

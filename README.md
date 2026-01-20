# Smarty Agent

A Docker-based service that receives HTTP POST requests and uses Claude Code to make code changes and create GitHub PRs.

## Prerequisites

- Docker
- Anthropic API key
- GitHub personal access token with `repo` and `workflow` permissions

## Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and fill in your credentials:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
GH_TOKEN=ghp_your-github-token-here
GH_REPO=maxwellpothier/smarty-typescript-sdk-react-example
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
  -e GH_TOKEN="your-token" \
  -e GH_REPO="smarty/smarty-typescript-sdk-react-example" \
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
  "pr": "https://github.com/maxwellpothier/smarty-typescript-sdk-react-example/pull/123",
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

1. On startup, the container clones the target repository using the GitHub CLI
2. When a POST request is received:
   - Fetches the latest `master` branch
   - Creates a new branch named `claude/<slugified-request>-<timestamp>`
   - Runs Claude Code (Sonnet model) with restricted permissions (Edit, Write, git add, git commit only)
   - Safety check: verifies the current branch starts with `claude/` before pushing
   - Pushes the branch and creates a PR via `gh pr create`
3. Returns the PR URL and branch name

## Security Notes

- Claude Code is restricted to only use `Edit`, `Write`, and `git add/commit` tools
- The service only pushes branches that start with `claude/` prefix
- GitHub token should have minimal required permissions (repo access only)

const http = require("http");
const { spawn, execSync } = require("child_process");
const path = require("path");

const PORT = process.env.PORT || 3000;
const REPO_PATH = process.env.REPO_PATH;

if (!REPO_PATH) {
  console.error("ERROR: REPO_PATH environment variable is required");
  process.exit(1);
}

/**
 * Slugify a request string for use as a branch name
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

/**
 * Execute a command synchronously in the repo directory
 */
function execInRepo(command) {
  return execSync(command, {
    cwd: REPO_PATH,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Get the current branch name
 */
function getCurrentBranch() {
  return execInRepo("git rev-parse --abbrev-ref HEAD");
}

/**
 * Run Claude Code with restricted permissions
 */
async function runClaudeCode(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--model",
      "sonnet",
      "--dangerously-skip-permissions",
      "--allowedTools",
      "Edit",
      "Write",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "-p",
      prompt,
    ];

    const proc = spawn("claude", args, {
      cwd: REPO_PATH,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Handle POST / - Process a code change request
 */
async function handleChangeRequest(req, res) {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const { request } = JSON.parse(body);

      if (!request || typeof request !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Missing or invalid "request" field' }));
        return;
      }

      console.log(`\n=== Processing request: ${request} ===\n`);

      // Fetch latest and checkout master
      console.log("Fetching latest from origin...");
      execInRepo("git fetch origin");
      execInRepo("git checkout master");
      execInRepo("git reset --hard origin/master");

      // Create new branch
      const slug = slugify(request);
      const branchName = `claude/${slug}-${Date.now()}`;
      console.log(`Creating branch: ${branchName}`);
      execInRepo(`git checkout -b "${branchName}"`);

      // Run Claude Code
      console.log("Running Claude Code...");
      const claudePrompt = `You are helping to make code changes to this repository.

Request: ${request}

Please make the necessary code changes to fulfill this request. After making changes:
1. Use git add to stage your changes
2. Use git commit with a descriptive message

Focus only on making the requested changes. Do not make unrelated modifications.`;

      await runClaudeCode(claudePrompt);

      // Safety check: verify we're on a claude/* branch before pushing
      const currentBranch = getCurrentBranch();
      if (!currentBranch.startsWith("claude/")) {
        throw new Error(
          `Safety check failed: current branch "${currentBranch}" is not a claude/* branch`
        );
      }

      // Check if there are commits to push
      const commitCount = execInRepo(
        `git rev-list --count master..${currentBranch}`
      );
      if (parseInt(commitCount, 10) === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "No changes were committed by Claude Code",
          })
        );
        return;
      }

      // Push branch
      console.log(`Pushing branch ${currentBranch}...`);
      execInRepo(`git push -u origin "${currentBranch}"`);

      // Create PR
      console.log("Creating pull request...");
      const prTitle = request.substring(0, 100);
      const prBody = `## Description\n\n${request}\n\n---\n*This PR was automatically created by Smarty Agent using Claude Code.*`;

      const prUrl = execInRepo(
        `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --base master`
      );

      console.log(`\n=== PR created: ${prUrl} ===\n`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          pr: prUrl,
          branch: currentBranch,
        })
      );
    } catch (error) {
      console.error("Error processing request:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error.message,
        })
      );
    }
  });
}

/**
 * Handle GET /health
 */
function handleHealth(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}

/**
 * Set CORS headers on response
 */
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Main request handler
 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  setCorsHeaders(res);

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    handleHealth(req, res);
  } else if (req.method === "POST" && url.pathname === "/") {
    handleChangeRequest(req, res);
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`Smarty Agent server listening on port ${PORT}`);
  console.log(`Repository path: ${REPO_PATH}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /       - Submit a code change request`);
  console.log(`  GET /health  - Health check`);
});

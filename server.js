const http = require("http");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const REPO_PATH = process.env.REPO_PATH;
const API_KEY = process.env.API_KEY;
const BB_USERNAME = process.env.BB_USERNAME;
const BB_EMAIL = process.env.BB_EMAIL;
const BB_API_TOKEN = process.env.BB_API_TOKEN;
const BB_WORKSPACE = process.env.BB_WORKSPACE;
const BB_REPO = process.env.BB_REPO;

if (!REPO_PATH) {
  console.error("ERROR: REPO_PATH environment variable is required");
  process.exit(1);
}

if (!API_KEY) {
  console.error("ERROR: API_KEY environment variable is required");
  process.exit(1);
}

const ALLOWED_ORIGINS = [
  "http://localhost:3220",
  "https://localhost:3220",
  "https://www.smarty.com",
];

// Rate limiting: track requests per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MAX_REQUESTS = 5; // max requests per day

/**
 * Check if the repository is ready (clone complete)
 */
function isRepoReady() {
  return fs.existsSync(path.join(REPO_PATH, ".clone-complete"));
}

/**
 * Slugify text for use as a branch name
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate a short branch name from a request using Claude
 */
async function generateBranchName(request) {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", [
      "--print",
      "--model", "haiku",
      "-p",
      `Generate a short git branch name (2-4 words, lowercase, hyphen-separated) that captures the essence of this request. Output ONLY the branch name, nothing else.

Request: ${request}

Examples of good branch names:
- "fix-login-bug"
- "add-user-avatar"
- "update-pricing-page"
- "refactor-auth-flow"`
    ], {
      cwd: REPO_PATH,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const branchName = slugify(stdout.trim()).substring(0, 40);
        resolve(branchName || slugify(request).substring(0, 30));
      } else {
        // Fallback to simple slugify if LLM fails
        resolve(slugify(request).substring(0, 30));
      }
    });

    proc.on("error", () => {
      resolve(slugify(request).substring(0, 30));
    });
  });
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
 * Save base64 images to temp files and return their paths
 */
function saveImages(images) {
  const tempDir = path.join(REPO_PATH, ".claude-temp-images");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const savedPaths = [];
  images.forEach((img, index) => {
    const ext = img.name ? path.extname(img.name) : ".png";
    const filename = img.name || `image-${index}${ext}`;
    const filepath = path.join(tempDir, filename);
    const buffer = Buffer.from(img.data, "base64");
    fs.writeFileSync(filepath, buffer);
    savedPaths.push(filepath);
  });

  return savedPaths;
}

/**
 * Clean up temp images directory
 */
function cleanupImages() {
  const tempDir = path.join(REPO_PATH, ".claude-temp-images");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Run Claude Code with restricted permissions
 */
async function runClaudeCode(prompt, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--model",
      "sonnet",
      "--dangerously-skip-permissions",
      "--allowedTools",
      "Edit",
      "Write",
      "Read",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "-p",
      prompt,
    ];

    // Add image paths as additional arguments
    imagePaths.forEach((imgPath) => {
      args.push(imgPath);
    });

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
 * Create a pull request via Bitbucket API
 */
async function createBitbucketPR(sourceBranch, title, description) {
  const url = `https://api.bitbucket.org/2.0/repositories/${BB_WORKSPACE}/${BB_REPO}/pullrequests`;
  const auth = Buffer.from(`${BB_EMAIL}:${BB_API_TOKEN}`).toString("base64");

  const body = JSON.stringify({
    title: title,
    description: description,
    source: {
      branch: {
        name: sourceBranch,
      },
    },
    destination: {
      branch: {
        name: "master",
      },
    },
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bitbucket API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.links.html.href;
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
    let imagePaths = [];
    try {
      // Check if repo is ready
      if (!isRepoReady()) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Repository is still cloning. Please try again in a moment." }));
        return;
      }

      const { request, images } = JSON.parse(body);

      if (!request || typeof request !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Missing or invalid "request" field' }));
        return;
      }

      console.log(`\n=== Processing request: ${request} ===\n`);

      // Save images if provided
      if (images && Array.isArray(images) && images.length > 0) {
        console.log(`Saving ${images.length} image(s)...`);
        imagePaths = saveImages(images);
        console.log(`Images saved to: ${imagePaths.join(", ")}`);
      }

      // Fetch latest and checkout master
      console.log("Fetching latest from origin...");
      execInRepo("git fetch origin");
      execInRepo("git checkout master");
      execInRepo("git reset --hard origin/master");

      // Create new branch
      const slug = await generateBranchName(request);
      const branchName = `claude/${slug}-${Date.now()}`;
      console.log(`Creating branch: ${branchName}`);
      execInRepo(`git checkout -b "${branchName}"`);

      // Build prompt with image references
      let claudePrompt = `You are helping to make code changes to this repository.

Request: ${request}`;

      if (imagePaths.length > 0) {
        claudePrompt += `\n\nThe following reference image(s) have been provided to help you understand the request:\n`;
        imagePaths.forEach((imgPath, index) => {
          claudePrompt += `- Image ${index + 1}: ${imgPath}\n`;
        });
        claudePrompt += `\nPlease examine these images to understand what changes are needed.`;
      }

      claudePrompt += `

Please make the necessary code changes to fulfill this request. After making changes:
1. Use git add to stage your changes
2. Use git commit with a descriptive message

Focus only on making the requested changes. Do not make unrelated modifications.`;

      // Run Claude Code
      console.log("Running Claude Code...");
      await runClaudeCode(claudePrompt, imagePaths);

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

      // Create PR via Bitbucket API
      console.log("Creating pull request...");
      const prTitle = request.substring(0, 100);
      const prDescription = `## Description\n\n${request}\n\n---\n*This PR was automatically created by Smarty Agent using Claude Code.*`;

      const prUrl = await createBitbucketPR(currentBranch, prTitle, prDescription);

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
    } finally {
      // Clean up temp images
      if (imagePaths.length > 0) {
        console.log("Cleaning up temp images...");
        cleanupImages();
      }
    }
  });
}

/**
 * Handle GET /health
 */
function handleHealth(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", repo_ready: isRepoReady() }));
}

/**
 * Set CORS headers on response based on origin
 */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Check if request has valid API key
 */
function isAuthenticated(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7);
  return token === API_KEY;
}

/**
 * Check rate limit for IP, returns true if allowed
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Main request handler
 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;

  setCorsHeaders(req, res);

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health endpoint doesn't require auth
  if (req.method === "GET" && url.pathname === "/health") {
    handleHealth(req, res);
    return;
  }

  // All other endpoints require authentication
  if (!isAuthenticated(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Rate limiting
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests. Please try again later." }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/") {
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

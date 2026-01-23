FROM node:20-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install jq for JSON parsing in API responses
RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (required for --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash agent

# Create app directory
WORKDIR /app

# Copy application files
COPY server.js .
COPY entrypoint.sh .

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Create workspace directory and set ownership
RUN mkdir -p /workspace && chown -R agent:agent /workspace /app

# Switch to non-root user
USER agent

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]

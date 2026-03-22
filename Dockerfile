# ============================================================================
# HIVEMIND Dockerfile
# Multi-stage build for a minimal production image
# ============================================================================

# ── Stage 1: Build ─────────────────────────────────────────────────────────────

FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Production ───────────────────────────────────────────────────────

FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 hivemind && \
    adduser -u 1001 -G hivemind -s /bin/sh -D hivemind

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy example config for reference
COPY hivemind.example.yaml ./

# Create data and log directories
RUN mkdir -p /app/data /app/logs /app/skills && \
    chown -R hivemind:hivemind /app

# Switch to non-root user
USER hivemind

# Expose default ports
# 3000 = Dashboard
# 9090 = Webhook connector
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "dist/cli/index.js", "up", "--config", "hivemind.yaml"]

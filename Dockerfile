# ──────────────────────────────────────────────────────────────────────────────
# BAATMEEDAR — The Gatekeeper of Truth
# Multi-stage Dockerfile
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Install OpenSSL (required by Prisma to generate & run query engine)
RUN apk add --no-cache openssl openssl-dev

# Copy package manifests only — leverages Docker layer caching
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma client targeting the linux-musl-openssl-3.0.x binary
# (matches the Alpine + OpenSSL 3 environment in the runtime stage)
RUN npx prisma generate


# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Install OpenSSL at runtime (Prisma query engine links against it)
RUN apk add --no-cache openssl

# Security: create non-root user
RUN addgroup -S baatmeedar && adduser -S baatmeedar -G baatmeedar

# Copy production node_modules and generated Prisma client from deps stage.
# --chown ensures the non-root user can read AND execute the engine binaries.
COPY --from=deps --chown=baatmeedar:baatmeedar /app/node_modules ./node_modules
COPY --from=deps --chown=baatmeedar:baatmeedar /app/prisma ./prisma/

# Copy application source
COPY --chown=baatmeedar:baatmeedar src ./src
COPY --chown=baatmeedar:baatmeedar public ./public
COPY --chown=baatmeedar:baatmeedar package.json ./

# Set environment — these become the defaults; Render/env overrides take precedence
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info

# Expose API port
EXPOSE 3000

# Health check — polls the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Switch to non-root user
USER baatmeedar

# Apply pending DB migrations then start the server.
# Explicitly pass NODE_ENV=production so pino never attempts pino-pretty transport.
CMD ["sh", "-c", "NODE_ENV=production npx prisma migrate deploy && NODE_ENV=production node src/server.js"]

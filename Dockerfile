# ──────────────────────────────────────────────────────────────────────────────
# BAATMEEDAR — The Gatekeeper of Truth
# Multi-stage Dockerfile
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy package manifests only — leverages Docker layer caching
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma client (required before runtime)
RUN npx prisma generate


# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Security: run as non-root
RUN addgroup -S baatmeedar && adduser -S baatmeedar -G baatmeedar

# Copy production node_modules and generated Prisma client from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma/

# Copy application source
COPY src ./src
COPY public ./public
COPY package.json ./

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose API port
EXPOSE 3000

# Health check — polls the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Switch to non-root user
USER baatmeedar

# Apply pending DB migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]

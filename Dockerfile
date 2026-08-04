# ─── Stage 1: Dependencies ────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

# ─── Stage 2: Build ──────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm prisma generate && \
    mkdir -p node_modules/.prisma && \
    cp -rL $(find node_modules/.pnpm -path '*/.prisma/client' -type d 2>/dev/null | head -1)/.. node_modules/.prisma/ 2>/dev/null || true
RUN pnpm build

# Dedicated migration image. It contains the pinned Prisma CLI and migration
# history, but is never used to serve application traffic.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
CMD ["pnpm", "exec", "prisma", "migrate", "deploy", "--schema", "/app/prisma/schema.prisma"]

# ─── Stage 3: Runtime ────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Audio normalization for NVIDIA NIM and Groq uploads; runtime remains non-root.
RUN apk add --no-cache ffmpeg && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /var/lib/qore/recordings && \
    chown -R nextjs:nodejs /var/lib/qore

# Copy only what's needed for standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma client for runtime
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]

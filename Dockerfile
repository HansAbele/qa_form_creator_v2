# ─── Stage 1: Dependencies ────────────────────────────
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS deps
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

# ─── Stage 2: Build ──────────────────────────────────
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS builder
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

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
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

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

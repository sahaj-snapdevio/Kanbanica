# ── Kanbanica web app (Next.js) ───────────────────────────────────────────────
# Multi-stage build producing a lean standalone server (see next.config.mjs
# `output: "standalone"`). The background worker uses Dockerfile.worker instead.

FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the
# public URL must be provided here. Changing the domain later requires a rebuild.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Placeholders so build-time env validation (lib/env.ts) passes. These are NOT
# used at runtime — real values are injected when the container starts.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV APP_SECRET="build-time-placeholder-value-000000000000"
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build


FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 krova \
  && useradd --system --uid 1001 --gid krova krova

# Standalone output: server + minimal node_modules, plus static assets & public/.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Local-storage uploads live here; mount a volume to persist across redeploys.
RUN mkdir -p /app/uploads && chown -R krova:krova /app/uploads

USER krova
EXPOSE 3000

CMD ["node", "server.js"]

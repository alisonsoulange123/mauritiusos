# ═══════════════════════════════════════════════════════════════════════════
#  ANOMALIA WEB — Next.js
# ═══════════════════════════════════════════════════════════════════════════
#
#     docker build -f apps/web/Dockerfile -t anomalia-web .
#
# Run from the repository root; see apps/api/Dockerfile for why.

FROM node:22-bookworm-slim AS base
# corepack installs pnpm into PNPM_HOME, which is not on PATH by default — a
# global install then fails with ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS pruner
# Sources BEFORE turbo, and the order matters: corepack reads `packageManager`
# from the nearest package.json, so running pnpm in an empty directory
# downloads whatever is newest — 12.x, against a lockfile written by 9.12.3.
# Copying first pins the toolchain to the one the repository declares.
COPY . .
RUN pnpm add -g turbo@^2
RUN turbo prune @anomalia/web --docker

FROM base AS builder
# pnpm prompts before purging node_modules for a --prod reinstall and takes the
# default after a timeout. A build that depends on a prompt is a build that
# behaves differently in CI; this makes the answer explicit.
ENV CI=true
COPY --from=pruner /app/out/json/ ./
# `turbo prune` emits package manifests, the lockfile and in-scope sources — not
# root-level configuration that no package.json references. Every TypeScript
# build extends `tsconfig.base.json`, and `.npmrc` carries this workspace's pnpm
# settings, so both come across explicitly or the build fails with TS5083.
COPY tsconfig.base.json .npmrc ./
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they
# are build arguments rather than runtime environment. That is a property of
# Next.js worth stating plainly: changing the API URL means rebuilding the
# image, and an image built for staging cannot be promoted to production
# unchanged.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_DEFAULT_TENANT=mauritius
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_DEFAULT_TENANT=$NEXT_PUBLIC_DEFAULT_TENANT

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo build --filter=@anomalia/web

FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

USER node

# The standalone trace: the server, plus only the dependencies it imports.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
# Static assets and the public directory are deliberately NOT traced into it —
# they are served, not imported — so they are copied separately. Miss these and
# the app boots, renders, and loads no CSS.
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

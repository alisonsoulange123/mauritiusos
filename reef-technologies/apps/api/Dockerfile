# ═══════════════════════════════════════════════════════════════════════════
#  Reef Technologies API — NestJS
# ═══════════════════════════════════════════════════════════════════════════
#
# Built from the repository root, not from this directory:
#
#     docker build -f apps/api/Dockerfile -t reef-technologies-api .
#
# because a workspace package cannot be built without the lockfile and the
# packages it depends on, and Docker cannot reach above its build context.
#
# Debian slim rather than Alpine: `argon2` is a native module and publishes
# prebuilt binaries for glibc. On musl it falls back to compiling, which means
# carrying python3, make and g++ in a builder stage to save a few megabytes on
# a base image — a bad trade, and one that breaks on the next argon2 release.

FROM node:22-bookworm-slim AS base
# corepack installs pnpm into PNPM_HOME, which is not on PATH by default — a
# global install then fails with ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── Prune ──────────────────────────────────────────────────────────────────
# Reduces the monorepo to this app and its workspace dependencies. The point is
# cache behaviour: without it, editing the web app invalidates the API's
# dependency layer and every image rebuilds from `pnpm install`.
FROM base AS pruner
# Sources BEFORE turbo, and the order matters: corepack reads `packageManager`
# from the nearest package.json, so running pnpm in an empty directory
# downloads whatever is newest — 12.x, against a lockfile written by 9.12.3.
# Copying first pins the toolchain to the one the repository declares.
COPY . .
RUN pnpm add -g turbo@^2
RUN turbo prune @reef-technologies/api --docker

# ── Install and build ──────────────────────────────────────────────────────
FROM base AS builder
# pnpm prompts before purging node_modules for a --prod reinstall and takes the
# default after a timeout. A build that depends on a prompt is a build that
# behaves differently in CI; this makes the answer explicit.
ENV CI=true

# Manifests first, on their own layer. `out/json` holds only package.json files
# and the lockfile, so this layer — the slow one — is reused until a dependency
# actually changes.
COPY --from=pruner /app/out/json/ ./
# `turbo prune` emits package manifests, the lockfile and in-scope sources — not
# root-level configuration that no package.json references. Every TypeScript
# build extends `tsconfig.base.json`, and `.npmrc` carries this workspace's pnpm
# settings, so both come across explicitly or the build fails with TS5083.
COPY tsconfig.base.json .npmrc ./
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ ./
RUN pnpm turbo build --filter=@reef-technologies/api

# ── Migrator ───────────────────────────────────────────────────────────────
# A separate target, and the reason is not tidiness: `drizzle-kit` is a
# development dependency, so the runtime image — which strips those — cannot run
# migrations, and an image that could would be carrying a schema-altering tool
# into production for no reason.
#
#     docker build -f apps/api/Dockerfile --target migrator -t reef-technologies-migrate .
#
# Run it as a job before the API rolls, connected as the schema OWNER. The API
# connects as a different, unprivileged role: row-level security is bypassed by
# table owners, so an API running as the owner would have no tenant isolation.
FROM builder AS migrator
USER node
# pnpm puts a package's bins under its OWN node_modules, so drizzle-kit lives at
# apps/api/node_modules/.bin — not at the workspace root. An absolute path with
# the working directory set alongside the config is deliberate: the node image's
# entrypoint prepends `node` to anything it cannot find on PATH, so a wrong path
# fails as an inscrutable MODULE_NOT_FOUND rather than as "no such file".
WORKDIR /app/apps/api
CMD ["/app/apps/api/node_modules/.bin/drizzle-kit", "migrate"]

# ── Production dependencies ────────────────────────────────────────────────
# Strips development dependencies in place. Workspace packages keep the `dist`
# directories just built, because those are real files in the tree rather than
# anything the package manager owns.
FROM builder AS production-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ── Runtime ────────────────────────────────────────────────────────────────
FROM base AS runner

ENV NODE_ENV=production
# Node's default heap is sized from the host's memory, which inside a container
# is the host's, not the limit. Left alone, the process learns its real ceiling
# by being OOM-killed.
ENV NODE_OPTIONS="--max-old-space-size=512"

# `node` exists in the base image; using it beats creating another user, and
# means nothing in the image is owned by the account that runs it.
USER node

COPY --from=production-deps --chown=node:node /app ./

EXPOSE 4000

# Hits the app's own readiness endpoint, which checks the database and Redis —
# so an orchestrator learns that the API cannot serve, not merely that a
# process is alive.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/'+(process.env.API_PREFIX||'api/v1')+'/_platform/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process is PID 1 and receives SIGTERM directly. Under a
# shell it would not, and every deploy would end in a 30-second kill instead of
# a graceful shutdown — which for this app means dropped Redis connections and
# an event consumer that never releases its pending entries.
CMD ["node", "apps/api/dist/main.js"]

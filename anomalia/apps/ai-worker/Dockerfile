# ═══════════════════════════════════════════════════════════════════════════
#  ANOMALIA AI WORKER — FastAPI
# ═══════════════════════════════════════════════════════════════════════════
#
#     docker build -f apps/ai-worker/Dockerfile -t anomalia-ai-worker .
#
# Built from the repository root like the others, because the worker validates
# event names against `packages/contracts/generated/contracts.schema.json` —
# the artifact TypeScript exports from the Zod catalog. Copying only this
# directory would produce a worker that accepts any event name at all, and the
# contract check would silently become a no-op.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# ── Dependencies ───────────────────────────────────────────────────────────
# The manifest alone first, so the dependency layer survives every change to
# the source that does not add a package.
FROM base AS builder
COPY apps/ai-worker/pyproject.toml ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install .

# ── Runtime ────────────────────────────────────────────────────────────────
FROM base AS runner

ENV PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# A dedicated unprivileged account: the python images ship no non-root user,
# and a service reachable from another service should not run as root.
RUN useradd --create-home --shell /usr/sbin/nologin --uid 10001 worker

COPY --from=builder /opt/venv /opt/venv
COPY --chown=worker:worker apps/ai-worker/src ./src
# The generated contract, which `load_event_names` reads at startup. Its
# absence is survivable — the bus logs a warning and accepts everything — which
# is exactly why it is copied explicitly rather than left to chance.
COPY --chown=worker:worker packages/contracts/generated ./packages/contracts/generated

ENV PYTHONPATH=/app/src

USER worker
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['PORT']}/health\", timeout=4).status == 200 else 1)"

# One worker process. Scaling happens by running more containers, not more
# processes inside one: the event consumer takes entries from a shared group, so
# two processes in a container would compete for the same messages while an
# orchestrator counted them as a single replica.
CMD ["sh", "-c", "uvicorn anomalia_ai.main:app --host 0.0.0.0 --port ${PORT}"]

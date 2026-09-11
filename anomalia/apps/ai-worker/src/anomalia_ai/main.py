"""FastAPI entrypoint.

Serves two surfaces at once: synchronous HTTP for a chat turn a user is waiting
on, and an event-stream consumer for slow work (embedding, plan generation).
Both are the same process for now; the split into separate deployments is a
scaling decision, not a rewrite, because the two paths share no state.
"""

from __future__ import annotations

import os
import socket
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import structlog
from fastapi import FastAPI

from anomalia_ai.agents.registry import AGENT_REGISTRY
from anomalia_ai.api.routes import router
from anomalia_ai.config import get_settings
from anomalia_ai.core.events import EventBus

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    bus = EventBus(
        url=settings.redis_url,
        stream_prefix=settings.event_stream_prefix,
        consumer_group=settings.event_consumer_group,
        consumer_name=f"ai-worker@{socket.gethostname()}:{os.getpid()}",
    )

    # Subscriptions are derived from the registry, so adding an agent that
    # reacts to an event needs no change here.
    for definition in AGENT_REGISTRY.definitions:
        for event_name in definition.subscribes:
            agent = AGENT_REGISTRY.get(definition.key)

            async def handler(envelope: dict[str, object], _agent=agent) -> None:  # noqa: ANN001
                await _agent.run(dict(envelope.get("payload", {})))  # type: ignore[arg-type]

            bus.subscribe(event_name, handler)

    await bus.start()
    app.state.event_bus = bus
    logger.info("ai worker ready", agents=[d.key for d in AGENT_REGISTRY.definitions])

    yield

    await bus.stop()


app = FastAPI(
    title="ANOMALIA AI Worker",
    version="0.1.0",
    lifespan=lifespan,
    # Internal service: no docs in production.
    docs_url=None if get_settings().environment == "production" else "/docs",
)

app.include_router(router)


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "agents": len(AGENT_REGISTRY.definitions)}

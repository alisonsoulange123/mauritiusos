"""FastAPI entrypoint.

Serves two surfaces at once: synchronous HTTP for a chat turn a user is waiting
on, and an event-stream consumer for slow work (embedding, plan generation).
Both are the same process for now; the split into separate deployments is a
scaling decision, not a rewrite, because the two paths share no state.
"""

from __future__ import annotations

import os
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI

from reef_technologies_ai.agents.embedding_agent import EmbeddingAgent
from reef_technologies_ai.agents.registry import AGENT_REGISTRY
from reef_technologies_ai.agents.retrieval_agent import RetrievalAgent
from reef_technologies_ai.api.routes import router
from reef_technologies_ai.config import get_settings
from reef_technologies_ai.core.db import Database
from reef_technologies_ai.core.events import EventBus, EventHandler
from reef_technologies_ai.core.registry import Agent
from reef_technologies_ai.providers.factory import get_chat_provider, get_embedding_provider

logger = structlog.get_logger(__name__)


def _handler_for(agent: Agent) -> EventHandler:
    """Binds one agent to the bus.

    A factory rather than a closure written inside the loop: a closure there
    captures the loop variable by reference, so every subscription would end up
    invoking whichever agent the loop happened to finish on. Binding through a
    parameter makes each handler hold its own.
    """

    async def handler(envelope: dict[str, Any]) -> None:
        payload = envelope.get("payload")
        # Envelopes come off a stream written by another service. A malformed
        # payload is a bad message, not a crash — the bus would otherwise treat
        # the TypeError as a handler failure and redeliver it forever.
        fields = dict(payload) if isinstance(payload, dict) else {}

        # The tenant lives on the ENVELOPE, not in the payload, because it is
        # true of the message rather than of the thing that happened. Every
        # agent that touches the database needs it, so it is merged in here
        # instead of each agent reaching for an envelope it was never given.
        fields["tenantId"] = envelope.get("tenantId")
        fields["traceId"] = envelope.get("traceId")

        await agent.run(fields)

    return handler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    database = Database(settings.database_url)
    await database.connect()

    # Agents are constructed by the registry with no arguments, so the handle is
    # attached to the classes. Set on the class rather than the instance because
    # the registry builds instances lazily, and an agent first resolved by an
    # inbound event would otherwise find a `None` where its database should be.
    EmbeddingAgent.database = database
    RetrievalAgent.database = database

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
            bus.subscribe(event_name, _handler_for(AGENT_REGISTRY.get(definition.key)))

    await bus.start()
    app.state.event_bus = bus
    app.state.database = database

    embeddings = get_embedding_provider()
    chat_provider = get_chat_provider()
    logger.info(
        "ai worker ready",
        agents=[d.key for d in AGENT_REGISTRY.definitions],
        embeddings=embeddings.name,
        chat=chat_provider.name,
    )

    yield

    await bus.stop()
    await database.close()


app = FastAPI(
    title="Reef Technologies AI Worker",
    version="0.1.0",
    lifespan=lifespan,
    # Internal service: no docs in production.
    docs_url=None if get_settings().environment == "production" else "/docs",
)

app.include_router(router)


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "agents": len(AGENT_REGISTRY.definitions)}

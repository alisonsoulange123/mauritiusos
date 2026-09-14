"""Embeds knowledge items when they are published.

Event-driven on purpose: embedding is slow and costs money, so it must not sit
inside the request that publishes an article. The Node API publishes
`knowledge.item.published` and returns immediately; this agent picks it up and
writes vectors to `knowledge_embeddings`.

Chunking matters more than the model choice here. A 4000-word guide embedded as
one vector retrieves poorly for a specific question; overlapping ~1000-character
chunks keep each vector about one idea, and the overlap stops a rule being split
across a boundary where neither half matches.
"""

from __future__ import annotations

from typing import Any

import structlog

from reef_technologies_ai.core.db import Database
from reef_technologies_ai.providers.factory import get_embedding_provider

logger = structlog.get_logger(__name__)

_CHUNK_SIZE = 1000
_CHUNK_OVERLAP = 150


class EmbeddingAgent:
    key = "embedding"

    #: Injected at startup. Class-level because the registry constructs agents
    #: with no arguments, and an agent that needs I/O should not be the reason
    #: the registry grows a dependency-injection container.
    database: Database | None = None

    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        knowledge_id = str(payload.get("knowledgeId") or payload.get("knowledge_id") or "")
        tenant_id = str(payload.get("tenantId") or "")

        if not knowledge_id or not tenant_id:
            # Nothing to look up. Returning rather than raising: a malformed
            # event is not retryable, and raising would park it in the pending
            # list to be redelivered forever.
            logger.error("published event missing ids", payload_keys=sorted(payload))
            return {"count": 0, "skipped": "missing-ids"}

        if self.database is None:
            raise RuntimeError("EmbeddingAgent has no database; the event will be redelivered")

        item = await self.database.fetch_knowledge_item(tenant_id, knowledge_id)
        if item is None:
            # Published and then deleted before this was processed. The event is
            # stale, not broken.
            logger.warning("knowledge item vanished before embedding", knowledge_id=knowledge_id)
            return {"count": 0, "skipped": "not-found"}

        chunks = self.chunk(str(item["content"]))
        if not chunks:
            return {"count": 0, "skipped": "empty"}

        provider = get_embedding_provider()
        # Title prepended to every chunk: a chunk from the middle of a guide
        # has no idea what it is about, and a question naming the subject would
        # otherwise miss the very passage that answers it.
        vectors = await provider.embed([f"{item['title']}\n\n{chunk}" for chunk in chunks])

        written = await self.database.replace_embeddings(
            tenant_id=tenant_id,
            knowledge_id=knowledge_id,
            chunks=chunks,
            vectors=vectors,
            model=provider.name,
        )

        logger.info(
            "embedded",
            knowledge_id=knowledge_id,
            chunks=written,
            provider=provider.name,
            title=item["title"],
        )
        return {"count": written, "provider": provider.name}

    @staticmethod
    def chunk(text: str, size: int = _CHUNK_SIZE, overlap: int = _CHUNK_OVERLAP) -> list[str]:
        if not text:
            return []
        if len(text) <= size:
            return [text]

        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + size
            window = text[start:end]

            # Prefer a sentence boundary near the end of the window so a chunk
            # does not begin mid-clause and lose its subject.
            if end < len(text):
                boundary = max(window.rfind(". "), window.rfind("\n"))
                if boundary > size // 2:
                    window = window[: boundary + 1]
                    end = start + boundary + 1

            chunks.append(window.strip())
            start = max(end - overlap, start + 1)

        return [chunk for chunk in chunks if chunk]

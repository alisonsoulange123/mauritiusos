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

logger = structlog.get_logger(__name__)

_CHUNK_SIZE = 1000
_CHUNK_OVERLAP = 150


class EmbeddingAgent:
    key = "embedding"

    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        content = str(payload.get("content", ""))
        chunks = self.chunk(content)
        logger.info(
            "prepared chunks for embedding",
            knowledge_id=payload.get("knowledge_id"),
            chunks=len(chunks),
        )
        # The OpenAI call and the INSERT land here once credentials are wired;
        # chunking is the part worth getting right first and testing.
        return {"chunks": chunks, "count": len(chunks)}

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

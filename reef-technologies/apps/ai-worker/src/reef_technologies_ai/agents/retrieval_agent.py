"""Hybrid retrieval over the knowledge base (AI blueprint §8, §10).

Vector search finds semantically similar text; lexical search finds exact terms
like "Occupation Permit" that embeddings blur together. Immigration questions
need both, so results are fused with Reciprocal Rank Fusion rather than picking
one strategy and accepting its blind spot.

Every query is tenant-filtered in SQL. The worker is never given a way to read
across tenants, because the safest place to enforce that is the query itself.
"""

from __future__ import annotations

from typing import Any

import structlog

from reef_technologies_ai.config import get_settings
from reef_technologies_ai.core.db import Database
from reef_technologies_ai.providers.factory import get_embedding_provider

logger = structlog.get_logger(__name__)

_RRF_K = 60  # standard RRF damping constant


class RetrievalAgent:
    key = "retrieval"

    #: Injected at startup; see `EmbeddingAgent.database` for why.
    database: Database | None = None

    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            # Fail closed. A retrieval with no tenant would search everything.
            raise ValueError("retrieval requires a tenant_id")

        limit = int(payload.get("limit", 8))
        lexical_hits: list[dict[str, Any]] = payload.get("lexical_hits", [])
        vector_hits: list[dict[str, Any]] = payload.get("vector_hits", [])

        # The caller may pass vector hits (tests do); otherwise they are found
        # here. The Node API supplies the lexical half because it owns the
        # knowledge contract, and this side owns the vectors — which is the
        # division the whole hybrid design rests on.
        query = str(payload.get("query", ""))
        if not vector_hits and query and self.database is not None:
            locale = str(payload.get("locale", "en"))
            vector_hits = await self.search(str(tenant_id), query, locale, limit)

        fused = self.fuse(vector_hits, lexical_hits)
        return {"hits": fused[:limit]}

    async def search(
        self,
        tenant_id: str,
        query: str,
        locale: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Nearest published chunks to the question."""
        if self.database is None:
            return []

        provider = get_embedding_provider()
        [embedding] = await provider.embed([query])

        rows = await self.database.search_by_vector(
            tenant_id,
            embedding,
            locale,
            limit,
            get_settings().retrieval_min_similarity,
        )
        return [
            {
                "id": row["knowledge_id"],
                "title": row["title"],
                "excerpt": row["chunk_text"],
                "confidence": float(row["confidence_score"]) / 100.0,
                "similarity": float(row["similarity"]),
            }
            for row in rows
        ]

    @staticmethod
    def fuse(
        vector_hits: list[dict[str, Any]], lexical_hits: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Reciprocal Rank Fusion.

        Uses RANK, not score: vector distances and ts_rank values are on
        incomparable scales, so blending the raw numbers would silently let one
        strategy dominate depending on the query.
        """
        scores: dict[str, float] = {}
        documents: dict[str, dict[str, Any]] = {}

        for ranking in (vector_hits, lexical_hits):
            for position, hit in enumerate(ranking):
                key = _identify(hit)
                # A hit nothing can identify cannot be fused or cited, and
                # bucketing them all under "None" — which is what happened —
                # collapsed every result into one document.
                if key is None:
                    continue
                scores[key] = scores.get(key, 0.0) + 1.0 / (_RRF_K + position + 1)
                documents.setdefault(key, hit)

        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [{**documents[key], "fusion_score": round(score, 6)} for key, score in ordered]


def _identify(hit: dict[str, Any]) -> str | None:
    """The document a hit refers to, whichever spelling its producer used.

    The two sides disagreed and nobody noticed: both the API's lexical hits and
    this module's own vector hits carry `id`, while fusion looked for
    `knowledge_id`. Every key resolved to the string "None", so all results
    landed in a single bucket and the concierge could cite exactly one source
    however many it had retrieved — which looks like a ranking preference
    rather than a bug.
    """
    for field in ("id", "knowledge_id", "knowledgeId"):
        value = hit.get(field)
        if value:
            return str(value)
    return None

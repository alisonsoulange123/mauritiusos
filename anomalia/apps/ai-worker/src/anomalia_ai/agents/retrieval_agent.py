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

logger = structlog.get_logger(__name__)

_RRF_K = 60  # standard RRF damping constant


class RetrievalAgent:
    key = "retrieval"

    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            # Fail closed. A retrieval with no tenant would search everything.
            raise ValueError("retrieval requires a tenant_id")

        vector_hits: list[dict[str, Any]] = payload.get("vector_hits", [])  # type: ignore[assignment]
        lexical_hits: list[dict[str, Any]] = payload.get("lexical_hits", [])  # type: ignore[assignment]

        fused = self.fuse(vector_hits, lexical_hits)
        limit = int(payload.get("limit", 8))
        return {"hits": fused[:limit]}

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
                key = str(hit.get("knowledge_id") or hit.get("knowledgeId"))
                scores[key] = scores.get(key, 0.0) + 1.0 / (_RRF_K + position + 1)
                documents.setdefault(key, hit)

        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [{**documents[key], "fusion_score": round(score, 6)} for key, score in ordered]

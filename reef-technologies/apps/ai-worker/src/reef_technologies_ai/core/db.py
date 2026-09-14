"""The worker's database access.

Reads and writes exactly two things: it reads `knowledge_items` to embed them,
and it reads and writes `knowledge_embeddings`. Nothing else. The worker holds
no user credentials and has no business in any other table — the Node API owns
those, and reaching across would put the same rows under two owners.

Every statement is tenant-scoped in SQL rather than in Python, because the
safest place to enforce isolation is the query itself.
"""

from __future__ import annotations

from typing import Any

import asyncpg
import structlog

logger = structlog.get_logger(__name__)


class Database:
    """A lazily-opened asyncpg pool."""

    def __init__(self, url: str) -> None:
        # asyncpg does not accept the `postgresql+driver://` form, and the URL
        # is shared verbatim with the Node side, so normalise rather than
        # requiring a second variable that can drift.
        self._url = url.replace("postgresql+asyncpg://", "postgresql://")
        self._pool: asyncpg.Pool[Any] | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self._url, min_size=1, max_size=5)
        logger.info("database pool opened")

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @property
    def pool(self) -> asyncpg.Pool[Any]:
        if self._pool is None:
            raise RuntimeError("database pool is not open")
        return self._pool

    async def fetch_knowledge_item(
        self,
        tenant_id: str,
        knowledge_id: str,
    ) -> dict[str, Any] | None:
        """The text to embed.

        The published event carries ids, not content — deliberately, since an
        event is a notification rather than a payload — so the worker reads the
        row it was told about.
        """
        row = await self.pool.fetchrow(
            """
            SELECT id::text, title, content, locale, status
            FROM knowledge_items
            WHERE tenant_id = $1::uuid AND id = $2::uuid
            """,
            tenant_id,
            knowledge_id,
        )
        return dict(row) if row else None

    async def replace_embeddings(
        self,
        tenant_id: str,
        knowledge_id: str,
        chunks: list[str],
        vectors: list[list[float]],
        model: str,
    ) -> int:
        """Writes an item's vectors, replacing whatever was there.

        Delete-then-insert in one transaction, not an upsert keyed on chunk
        index: a revised article can be SHORTER than the one it replaces, and an
        upsert would leave the surplus chunks of the old text behind, still
        indexed, still retrievable, still citing a paragraph that no longer
        exists. Replacement is the only operation that cannot leave a ghost.
        """
        async with self.pool.acquire() as connection, connection.transaction():
            await connection.execute(
                """
                DELETE FROM knowledge_embeddings
                WHERE tenant_id = $1::uuid AND knowledge_id = $2::uuid
                """,
                tenant_id,
                knowledge_id,
            )
            await connection.executemany(
                """
                INSERT INTO knowledge_embeddings
                    (tenant_id, knowledge_id, chunk_index, chunk_text, embedding, model)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5::vector, $6)
                """,
                [
                    (tenant_id, knowledge_id, index, chunk, to_vector(vector), model)
                    for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
                ],
            )
        return len(chunks)

    async def search_by_vector(
        self,
        tenant_id: str,
        embedding: list[float],
        locale: str,
        limit: int,
        min_similarity: float,
    ) -> list[dict[str, Any]]:
        """Nearest chunks, restricted to what is publishable.

        The status and freshness filters repeat the ones the Node contract
        applies to lexical search, and they have to: a vector index does not
        know an article was withdrawn this morning, so without them retrieval
        would happily surface a chunk of something the platform has stopped
        standing behind.

        `min_similarity` is the other guardrail, and the less obvious one.
        Nearest-neighbour search always returns a nearest neighbour, so a
        question on a topic the knowledge base has never covered comes back
        with whatever is least unlike it — and the answer then quotes an
        unrelated source as though it were on point. Returning nothing is the
        correct answer to a question nothing here can answer.
        """
        rows = await self.pool.fetch(
            """
            SELECT
                e.knowledge_id::text AS knowledge_id,
                e.chunk_text,
                k.title,
                k.confidence_score,
                1 - (e.embedding <=> $2::vector) AS similarity
            FROM knowledge_embeddings e
            JOIN knowledge_items k
              ON k.id = e.knowledge_id AND k.tenant_id = e.tenant_id
            WHERE e.tenant_id = $1::uuid
              AND k.status = 'published'
              AND k.locale = $3
              AND (k.verified_at IS NULL OR k.verified_at > now() - interval '180 days')
              AND 1 - (e.embedding <=> $2::vector) >= $5
            ORDER BY e.embedding <=> $2::vector
            LIMIT $4
            """,
            tenant_id,
            to_vector(embedding),
            locale,
            limit,
            min_similarity,
        )
        return [dict(row) for row in rows]


def to_vector(values: list[float]) -> str:
    """pgvector's text input format. asyncpg has no native codec for it."""
    return "[" + ",".join(f"{value:.7f}" for value in values) + "]"

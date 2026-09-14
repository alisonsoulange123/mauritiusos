"""Configuration, validated at import time.

Mirrors the TypeScript side deliberately: a pydantic-settings model plays the
same role as the Zod schema in `@reef-technologies/config`. Both fail loudly at startup
rather than surfacing a missing variable as a 500 an hour into a deploy.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    port: int = 8000

    # ── Infrastructure shared with the Node API ──────────────────────────
    database_url: str
    redis_url: str

    # Must match EVENT_STREAM_PREFIX on the API, or the two sides publish to
    # streams neither is reading.
    event_stream_prefix: str = "reef_technologies:events"
    # A DIFFERENT group from the API's, so both receive every event rather
    # than competing for each one.
    event_consumer_group: str = "reef-technologies-ai-worker"

    # ── Models ───────────────────────────────────────────────────────────
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    # Long-form reasoning: the relocation plan and concierge answers.
    reasoning_model: str = "claude-opus-5"
    # Cheap, fast path: intent classification and routing.
    fast_model: str = "claude-haiku-4-5-20251001"

    openai_api_key: str | None = None
    anthropic_api_key: str | None = None

    # ── Guardrails (AI blueprint 16-17) ──────────────────────────────────
    human_review_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    #: Cosine similarity below which a vector hit is not a hit at all.
    #:
    #: Nearest-neighbour search always returns a nearest neighbour. Without a
    #: floor, a question about something the knowledge base has never covered
    #: retrieves whatever is least unlike it and the answer quotes an unrelated
    #: source with total confidence — which is the failure "never invent
    #: immigration information" exists to prevent, arriving through retrieval
    #: instead of through generation.
    #:
    #: The right value depends on the embedding model, so it is configuration
    #: rather than a constant: lexical-overlap vectors and a real embedding
    #: model do not put "unrelated" in the same place.
    retrieval_min_similarity: float = Field(default=0.25, ge=0.0, le=1.0)
    max_context_items: int = Field(default=8, ge=1, le=30)
    request_timeout_seconds: int = 45

    @field_validator("database_url")
    @classmethod
    def _postgres_url(cls, value: str) -> str:
        if not value.startswith(("postgres://", "postgresql://")):
            raise ValueError("database_url must be a postgres:// URL")
        return value

    @property
    def requires_llm_credentials(self) -> bool:
        return self.environment in {"staging", "production"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached so configuration is parsed once per process."""
    settings = Settings()  # type: ignore[call-arg]
    if settings.requires_llm_credentials and not (
        settings.openai_api_key and settings.anthropic_api_key
    ):
        raise RuntimeError(
            "openai_api_key and anthropic_api_key are required outside development."
        )
    return settings

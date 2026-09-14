"""Chooses the providers this process will use, once, at import of the settings.

Credentials decide. There is no `PROVIDER=` switch to get wrong: a key present
means the real thing, a key absent means the keyless fallback, and the choice is
logged at startup so nobody has to guess which one answered.
"""

from __future__ import annotations

from functools import lru_cache

import structlog

from reef_technologies_ai.config import get_settings
from reef_technologies_ai.providers.base import ChatProvider, EmbeddingProvider
from reef_technologies_ai.providers.extractive import ExtractiveChatProvider
from reef_technologies_ai.providers.hashing import HashingEmbeddingProvider
from reef_technologies_ai.providers.remote import AnthropicChatProvider, OpenAIEmbeddingProvider

logger = structlog.get_logger(__name__)


@lru_cache(maxsize=1)
def get_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()

    if settings.openai_api_key:
        return OpenAIEmbeddingProvider(
            api_key=settings.openai_api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )

    logger.warning(
        "no OPENAI_API_KEY; embedding with the keyless hashing vectoriser "
        "(lexical overlap only, not semantic)",
    )
    return HashingEmbeddingProvider(dimensions=settings.embedding_dimensions)


@lru_cache(maxsize=1)
def get_chat_provider() -> ChatProvider:
    settings = get_settings()

    if settings.anthropic_api_key:
        return AnthropicChatProvider(
            api_key=settings.anthropic_api_key,
            model=settings.reasoning_model,
            timeout_seconds=settings.request_timeout_seconds,
        )

    logger.warning(
        "no ANTHROPIC_API_KEY; answering extractively by quoting verified sources",
    )
    return ExtractiveChatProvider()

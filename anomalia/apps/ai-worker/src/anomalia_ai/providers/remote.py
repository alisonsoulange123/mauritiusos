"""The credentialled providers.

Thin on purpose. Everything interesting — what may be said, what must be cited,
when to refuse — is decided before a provider is reached, so these do one thing:
turn verified passages into a request and a reply into a `Completion`.

The SDK imports are function-local. A deployment running without credentials
never touches them, and never pays their import cost or fails on their absence.
"""

from __future__ import annotations

import structlog

from anomalia_ai.providers.base import Completion, Passage

logger = structlog.get_logger(__name__)

_SYSTEM = """You are ANOMALIA's relocation concierge for Mauritius.

Answer ONLY from the verified sources supplied in the user message. If they do
not cover the question, say so and suggest speaking to an advisor — never fill
the gap from your own knowledge of immigration or tax rules, which may be out of
date or wrong for this jurisdiction.

Cite the sources you used by title. Be concise and concrete. Reply in {language}.
"""


class AnthropicChatProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, timeout_seconds: int) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout_seconds

    async def answer(self, question: str, passages: list[Passage], locale: str) -> Completion:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self._api_key, timeout=float(self._timeout))
        language = "French" if locale.lower().startswith("fr") else "English"

        sources = "\n\n".join(
            f"[{index}] {passage.title} (confidence {passage.confidence:.2f})\n{passage.text}"
            for index, passage in enumerate(passages, start=1)
        )

        message = await client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=_SYSTEM.format(language=language),
            messages=[
                {
                    "role": "user",
                    "content": f"Verified sources:\n\n{sources}\n\nQuestion: {question}",
                }
            ],
        )

        text = "".join(block.text for block in message.content if block.type == "text")
        return Completion(
            text=text,
            provider=self.name,
            usage={
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
            },
        )


class OpenAIEmbeddingProvider:
    name = "openai"

    def __init__(self, api_key: str, model: str, dimensions: int) -> None:
        self._api_key = api_key
        self._model = model
        self.dimensions = dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self._api_key)
        response = await client.embeddings.create(
            model=self._model,
            input=texts,
            dimensions=self.dimensions,
        )
        # Sorted by index rather than trusted to arrive in order: the column is
        # positional, and a silently reordered batch would attach every vector
        # to the wrong chunk.
        return [item.embedding for item in sorted(response.data, key=lambda item: item.index)]

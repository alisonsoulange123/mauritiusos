"""The two model ports, and what "no credentials" means.

Both have a working implementation that needs no API key. That is a design
choice rather than a convenience: the whole retrieval pipeline — chunking,
embedding, vector search, fusion, citation — can then be built, tested and
demonstrated end to end before anyone signs up to a vendor, and the fallback
becomes the deterministic test double afterwards.

What a fallback must never do is pretend. A stand-in that quietly produced
plausible prose would make an unconfigured deployment look like a working one,
which for a platform whose rule is "never invent immigration information" is the
worst failure available. So the fallbacks here are extractive and
self-describing: they quote verified sources and name themselves in the reply.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Passage:
    """A retrieved piece of verified knowledge, as the model sees it."""

    knowledge_id: str
    title: str
    text: str
    confidence: float


@dataclass(frozen=True)
class Completion:
    text: str
    #: Which provider produced it, so a caller can tell a real answer from a
    #: stand-in without inspecting configuration.
    provider: str
    #: Populated only by providers that report usage; never invented.
    usage: dict[str, int] | None = None


class EmbeddingProvider(Protocol):
    name: str
    dimensions: int

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Returns one vector per input, in the same order."""
        ...


class ChatProvider(Protocol):
    name: str

    async def answer(
        self,
        question: str,
        passages: list[Passage],
        locale: str,
    ) -> Completion:
        """Answers strictly from `passages`.

        Implementations must not introduce facts absent from the passages. The
        caller has already refused the request if `passages` is empty, so an
        implementation never has to decide whether to answer unsourced.
        """
        ...

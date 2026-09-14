"""The keyless embedding provider.

A hashing vectoriser: tokens are folded to lowercase ASCII, hashed into a fixed
number of buckets, weighted by sub-linear term frequency, and L2-normalised.
Cosine similarity over the result is a real signal — it measures lexical overlap
— so vector search, fusion and ranking can all be exercised and tested without a
model behind them.

It is emphatically NOT semantic. "Permit" and "visa" hash to unrelated buckets,
so a question phrased in words the source does not use retrieves nothing. That
is the whole gap between this and a real embedding model, and it is why the
lexical and vector halves are fused rather than either being used alone.

Deterministic across processes and restarts: the hash is BLAKE2b with a fixed
key, not Python's randomised `hash()`. Vectors written today must still match
queries embedded tomorrow, in another process.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from hashlib import blake2b

_TOKEN = re.compile(r"[a-z0-9]+")

#: Function words, English and French.
#:
#: Without this the vectoriser measures grammar. "What are the rules for
#: opening a casino?" scored 0.26 against the retirement permit — entirely on
#: "a", "for" and "the" — which cleared the relevance floor and had the
#: concierge quote an immigration rule at a question about gambling. Words that
#: appear in every document distinguish none of them.
#:
#: A real embedding model needs no such list; it learns that these carry no
#: meaning. This one counts tokens, so it has to be told. Kept deliberately
#: conservative: "non" is absent because "non-citizen" tokenises through it,
#: and nothing domain-bearing appears here.
_STOPWORDS = frozenset(
    [
        "a", "ai", "an", "and", "any", "are", "as", "at", "au", "aux", "avec", "be", "been",
        "but", "by", "can", "ce", "ces", "comme", "dans", "de", "des", "did", "do", "does",
        "du", "elle", "en", "est", "et", "for", "from", "had", "has", "have", "how", "i", "if",
        "il", "ils", "in", "into", "is", "it", "its", "je", "la", "le", "les", "leur", "lui",
        "ma", "mais", "may", "me", "mon", "must", "my", "ne", "nos", "notre", "nous", "of",
        "on", "or", "ou", "our", "par", "pas", "pour", "quand", "que", "quel", "quelle",
        "quelles", "quels", "qui", "sa", "sans", "se", "ses", "shall", "should", "si", "so",
        "son", "sont", "sur", "ta", "te", "tes", "than", "that", "the", "their", "them", "then",
        "there", "these", "they", "this", "to", "toi", "ton", "tu", "un", "une", "vos", "votre",
        "vous", "was", "we", "were", "what", "when", "where", "which", "who", "will", "with",
        "would", "y", "you", "your",
    ]
)


class HashingEmbeddingProvider:
    name = "hashing"

    def __init__(self, dimensions: int = 1536) -> None:
        self.dimensions = dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    def _vector(self, text: str) -> list[float]:
        counts = Counter(content_tokens(text))
        vector = [0.0] * self.dimensions

        for token, count in counts.items():
            # Sub-linear term frequency: a word used twenty times says a little
            # more than one used twice, not ten times more.
            weight = 1.0 + math.log(count)
            bucket = _bucket(token, self.dimensions)
            # Signed, so unrelated tokens colliding in a bucket are as likely to
            # cancel as to reinforce. Without the sign, every collision inflates
            # similarity and the whole space drifts towards "everything matches".
            vector[bucket] += weight * _sign(token)

        return _normalise(vector)


def tokenize(text: str) -> list[str]:
    """Lowercase, accent-folded, alphanumeric runs.

    Folding matters for the same reason it matters in Postgres: the French half
    of the knowledge base is written with accents and asked about without them.
    """
    folded = unicodedata.normalize("NFD", text.lower())
    ascii_only = "".join(char for char in folded if not unicodedata.combining(char))
    return _TOKEN.findall(ascii_only)


def content_tokens(text: str) -> list[str]:
    """Tokens that carry meaning: `tokenize` minus the function words.

    Separate from `tokenize` so the raw split stays available and honest; this
    is the one used for anything that measures similarity.
    """
    return [token for token in tokenize(text) if token not in _STOPWORDS]


def _digest(token: str) -> int:
    return int.from_bytes(blake2b(token.encode("utf-8"), digest_size=8).digest(), "big")


def _bucket(token: str, dimensions: int) -> int:
    return _digest(token) % dimensions


def _sign(token: str) -> float:
    return 1.0 if _digest(token) >> 63 & 1 else -1.0


def _normalise(vector: list[float]) -> list[float]:
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude == 0.0:
        # An empty or wholly non-alphanumeric text. Returned as zeros rather
        # than as a random unit vector: cosine against it is 0 everywhere, so it
        # retrieves nothing instead of retrieving something arbitrary.
        return vector
    return [value / magnitude for value in vector]

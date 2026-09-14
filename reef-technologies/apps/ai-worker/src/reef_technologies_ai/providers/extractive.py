"""The keyless chat provider.

It does not write prose. It selects the most relevant sentences from the
passages it was given and presents them, attributed, in the reader's language.

That restraint is the point. The alternative — generating fluent text from a
template — would make an unconfigured deployment indistinguishable from a
configured one right up until someone checked whether the immigration advice was
real. An extractive answer is visibly quoted, so nobody mistakes it for
reasoning, and it is still genuinely useful: for a question whose answer is one
sentence of a verified rule, quoting that sentence IS the answer.
"""

from __future__ import annotations

import re

from reef_technologies_ai.providers.base import Completion, Passage
from reef_technologies_ai.providers.hashing import content_tokens

_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_MAX_SENTENCES = 3

_LEAD = {
    "en": "From verified sources:",
    "fr": "D'après des sources vérifiées :",
}
_NOTE = {
    "en": "(Quoted directly from the sources listed. No language model is configured.)",
    "fr": "(Cité directement des sources listées. Aucun modèle de langage n'est configuré.)",
}


class ExtractiveChatProvider:
    name = "extractive"

    async def answer(self, question: str, passages: list[Passage], locale: str) -> Completion:
        language = "fr" if locale.lower().startswith("fr") else "en"
        wanted = set(content_tokens(question))

        scored = [
            (self._overlap(sentence, wanted), passage, sentence)
            for passage in passages
            for sentence in _split(passage.text)
        ]
        # Only sentences that actually share a word with the question. Falling
        # back to "the first sentence of the top hit" would answer confidently
        # with something unrelated, which is worse than answering narrowly.
        relevant = sorted(
            (item for item in scored if item[0] > 0),
            key=lambda item: item[0],
            reverse=True,
        )[:_MAX_SENTENCES]

        if not relevant:
            relevant = [(0, passages[0], _split(passages[0].text)[0])] if passages else []

        lines = [f"— {sentence} ({passage.title})" for _, passage, sentence in relevant]
        text = "\n".join([_LEAD[language], *lines, "", _NOTE[language]])

        return Completion(text=text, provider=self.name)

    @staticmethod
    def _overlap(sentence: str, wanted: set[str]) -> int:
        return len(wanted & set(content_tokens(sentence)))


def _split(text: str) -> list[str]:
    sentences = [part.strip() for part in _SENTENCE.split(text.strip()) if part.strip()]
    return sentences or [text.strip()]

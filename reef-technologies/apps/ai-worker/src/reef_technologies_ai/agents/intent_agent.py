"""Intent classification (AI blueprint §5).

Runs on the fast model: this is a routing decision, not the answer, and paying
reasoning-model prices to classify seven labels would dominate the cost per
conversation for no quality gain.
"""

from __future__ import annotations

from typing import Final

import structlog

logger = structlog.get_logger(__name__)

INTENTS: Final[tuple[str, ...]] = (
    "retirement",
    "investment",
    "business_setup",
    "remote_work",
    "family_relocation",
    "property_purchase",
    "lifestyle_change",
)

# Deterministic pre-filter. An unambiguous phrase never needs a model call —
# cheaper, faster, and reproducible in tests.
_KEYWORDS: Final[dict[str, tuple[str, ...]]] = {
    "retirement": ("retire", "retraite", "pension", "retired"),
    "investment": ("invest", "investir", "yield", "rendement"),
    "business_setup": ("company", "business", "société", "entreprise", "startup"),
    "remote_work": ("remote", "digital nomad", "télétravail", "freelance"),
    "family_relocation": ("family", "famille", "school", "école", "children", "enfants"),
    "property_purchase": ("buy a house", "property", "villa", "acheter", "immobilier"),
}


class IntentAgent:
    key = "intent"

    async def run(self, payload: dict[str, object]) -> dict[str, object]:
        message = str(payload.get("message", "")).lower()

        for intent, keywords in _KEYWORDS.items():
            if any(keyword in message for keyword in keywords):
                return {"primary_intent": intent, "confidence": 0.85, "method": "keyword"}

        # Ambiguous input falls through to the model. Until that is wired, be
        # explicit about the low confidence rather than guessing confidently.
        logger.debug(
            "intent unresolved by keywords; deferring to model",
            message_length=len(message),
        )
        return {"primary_intent": "lifestyle_change", "confidence": 0.3, "method": "fallback"}

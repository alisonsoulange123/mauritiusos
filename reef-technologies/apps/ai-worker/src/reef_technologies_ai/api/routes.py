"""HTTP surface. Called only by the Node API — never by a browser.

Engineering Standards §2.4: the frontend goes through the backend, which goes
through this service. That is why there is no CORS configuration here and why
the service holds no user credentials: it receives pre-authorized context and
nothing else.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from reef_technologies_ai.agents.registry import AGENT_REGISTRY
from reef_technologies_ai.config import get_settings
from reef_technologies_ai.providers.base import Passage
from reef_technologies_ai.providers.factory import get_chat_provider

router = APIRouter(prefix="/v1")


class KnowledgeContext(BaseModel):
    id: str
    title: str
    excerpt: str
    confidence: float


class ChatContext(BaseModel):
    profile: dict[str, Any] | None = None
    eligibility: dict[str, Any] | None = None
    knowledge: list[KnowledgeContext] = Field(default_factory=list)
    memory: list[dict[str, str]] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    user_id: str = Field(alias="userId")
    session_id: str = Field(alias="sessionId")
    locale: str = "en"
    context: ChatContext

    model_config = {"populate_by_name": True}


class SuggestedAction(BaseModel):
    type: str
    label: str
    payload: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[str]
    confidence: float
    suggestedActions: list[SuggestedAction]  # noqa: N815 — matches the TS contract
    usage: dict[str, int] | None = None


@router.post("/concierge/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    x_reef_technologies_tenant_id: Annotated[str | None, Header()] = None,
) -> ChatResponse:
    if not x_reef_technologies_tenant_id:
        # The worker refuses to reason without a tenant, even though it is only
        # reachable from our own API. Defence in depth.
        raise HTTPException(
            status_code=400,
            detail="x-reef-technologies-tenant-id header is required",
        )

    settings = get_settings()
    intent = await AGENT_REGISTRY.get("intent").run({"message": request.message})

    passages = await _gather_passages(
        request,
        x_reef_technologies_tenant_id,
        settings.max_context_items,
    )

    # No verified knowledge means no answer. Refusing is correct here: an
    # uncited answer about immigration is precisely what the guardrails forbid,
    # and it is the one case where saying nothing is the useful thing to do.
    if not passages:
        return _decline(request.locale)

    completion = await get_chat_provider().answer(
        question=request.message,
        passages=passages,
        locale=request.locale,
    )

    # The floor is the weakest thing the answer rests on: the least confident
    # passage quoted, and the classifier's own certainty about the question.
    confidence = min(
        min(passage.confidence for passage in passages),
        _as_confidence(intent.get("confidence")),
    )

    return ChatResponse(
        answer=completion.text,
        citations=[passage.knowledge_id for passage in passages],
        confidence=confidence,
        suggestedActions=(
            [SuggestedAction(type="contact_advisor", label="Have an advisor review this")]
            if confidence < settings.human_review_threshold
            else []
        ),
        usage=completion.usage,
    )


async def _gather_passages(
    request: ChatRequest,
    tenant_id: str,
    limit: int,
) -> list[Passage]:
    """Fuses what the API found lexically with what this side finds by vector.

    The split is the architecture, not an accident: the Node API owns the
    knowledge contract and does the lexical half; the worker owns the embeddings
    and does the vector half. Reciprocal Rank Fusion combines them on RANK
    rather than score, because a cosine similarity and a `ts_rank` are on
    incomparable scales and blending the raw numbers would silently let one
    strategy decide everything.
    """
    lexical = [
        {
            "id": item.id,
            "title": item.title,
            "excerpt": item.excerpt,
            "confidence": item.confidence,
        }
        for item in request.context.knowledge
    ]

    retrieval = AGENT_REGISTRY.get("retrieval")
    result = await retrieval.run(
        {
            "tenant_id": tenant_id,
            "query": request.message,
            "locale": request.locale,
            "lexical_hits": lexical,
            "limit": limit,
        }
    )

    hits = result.get("hits")
    fused = hits if isinstance(hits, list) else []

    return [
        Passage(
            knowledge_id=str(hit.get("id", "")),
            title=str(hit.get("title", "")),
            text=str(hit.get("excerpt", "")),
            confidence=_as_confidence(hit.get("confidence"), default=0.5),
        )
        for hit in fused
        if hit.get("excerpt")
    ]


def _decline(locale: str) -> ChatResponse:
    message = {
        "fr": (
            "Je n'ai pas encore de source vérifiée sur ce point. Un conseiller peut vous aider, "
            "et j'ai signalé ce sujet comme une lacune de notre base de connaissances."
        ),
        "en": (
            "I do not have a verified source for that yet. An advisor can help, "
            "and I have flagged the topic as a gap in our knowledge base."
        ),
    }["fr" if locale.lower().startswith("fr") else "en"]

    return ChatResponse(
        answer=message,
        citations=[],
        confidence=0.2,
        suggestedActions=[SuggestedAction(type="contact_advisor", label="Talk to an advisor")],
    )


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """Mirrors the Node API's /_platform/topology for the AI side."""
    return {
        "agents": [
            {
                "key": definition.key,
                "description": definition.description,
                "subscribes": list(definition.subscribes),
                "publishes": list(definition.publishes),
            }
            for definition in AGENT_REGISTRY.definitions
        ]
    }


def _as_confidence(value: object, default: float = 0.5) -> float:
    """Reads a confidence out of an agent's reply, clamped to 0-1."""
    if isinstance(value, int | float) and not isinstance(value, bool):
        return max(0.0, min(1.0, float(value)))
    return default

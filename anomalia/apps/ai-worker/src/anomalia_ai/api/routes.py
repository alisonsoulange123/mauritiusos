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

from anomalia_ai.agents.registry import AGENT_REGISTRY
from anomalia_ai.config import get_settings

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
    x_anomalia_tenant_id: Annotated[str | None, Header()] = None,
) -> ChatResponse:
    if not x_anomalia_tenant_id:
        # The worker refuses to reason without a tenant, even though it is only
        # reachable from our own API. Defence in depth.
        raise HTTPException(status_code=400, detail="x-anomalia-tenant-id header is required")

    settings = get_settings()
    intent = await AGENT_REGISTRY.get("intent").run({"message": request.message})

    # No verified knowledge means no answer. Refusing is correct here: an
    # uncited answer about immigration is precisely what the guardrails forbid.
    if not request.context.knowledge:
        return ChatResponse(
            answer=(
                "I do not have a verified source for that yet. An advisor can help, "
                "and I have flagged the topic as a gap in our knowledge base."
            ),
            citations=[],
            confidence=0.2,
            suggestedActions=[
                SuggestedAction(type="contact_advisor", label="Talk to an advisor"),
            ],
        )

    top = request.context.knowledge[0]
    confidence = min(top.confidence, float(intent.get("confidence", 0.5)))

    return ChatResponse(
        answer=f"Based on verified sources: {top.excerpt}",
        citations=[item.id for item in request.context.knowledge],
        confidence=confidence,
        suggestedActions=(
            [SuggestedAction(type="contact_advisor", label="Have an advisor review this")]
            if confidence < settings.human_review_threshold
            else []
        ),
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

"""════════════════════════════════════════════════════════════════════════════
 THE AGENT REGISTRY — the AI worker's single point of registration.
════════════════════════════════════════════════════════════════════════════

Add an agent: write the class, add one entry here. Same contract as the Node
side's `modules/registry.ts`, for the same reason — the wiring should be
readable in one screen.
"""

from anomalia_ai.agents.embedding_agent import EmbeddingAgent
from anomalia_ai.agents.intent_agent import IntentAgent
from anomalia_ai.agents.retrieval_agent import RetrievalAgent
from anomalia_ai.core.registry import AgentDefinition, AgentRegistry

AGENT_REGISTRY = AgentRegistry(
    [
        AgentDefinition(
            key="intent",
            description="Classifies the user's real goal from free text.",
            factory=IntentAgent,
        ),
        AgentDefinition(
            key="retrieval",
            description="Hybrid vector + lexical retrieval over verified knowledge.",
            factory=RetrievalAgent,
        ),
        AgentDefinition(
            key="embedding",
            description="Embeds knowledge items when they are published.",
            factory=EmbeddingAgent,
            subscribes=("knowledge.item.published",),
        ),
        # AgentDefinition(key="planner", ..., publishes=("ai.plan.generated",)),
        # AgentDefinition(key="memory", ...),
    ]
)

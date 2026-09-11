"""Agent tests. No network, no database — the logic worth testing is pure."""

from anomalia_ai.agents.embedding_agent import EmbeddingAgent
from anomalia_ai.agents.intent_agent import IntentAgent
from anomalia_ai.agents.retrieval_agent import RetrievalAgent


class TestIntentAgent:
    async def test_detects_retirement_in_english(self) -> None:
        result = await IntentAgent().run({"message": "I want to retire somewhere warm"})
        assert result["primary_intent"] == "retirement"

    async def test_detects_retirement_in_french(self) -> None:
        result = await IntentAgent().run({"message": "Je suis à la retraite"})
        assert result["primary_intent"] == "retirement"

    async def test_reports_low_confidence_when_unsure(self) -> None:
        result = await IntentAgent().run({"message": "hello"})
        assert result["confidence"] < 0.5


class TestRetrievalFusion:
    def test_rewards_documents_ranked_by_both_strategies(self) -> None:
        vector = [{"knowledge_id": "a"}, {"knowledge_id": "b"}]
        lexical = [{"knowledge_id": "b"}, {"knowledge_id": "c"}]
        fused = RetrievalAgent.fuse(vector, lexical)
        # "b" appears in both rankings, so it outranks either list's own leader.
        assert fused[0]["knowledge_id"] == "b"

    def test_keeps_documents_found_by_only_one_strategy(self) -> None:
        fused = RetrievalAgent.fuse([{"knowledge_id": "a"}], [{"knowledge_id": "c"}])
        assert {hit["knowledge_id"] for hit in fused} == {"a", "c"}

    def test_handles_empty_rankings(self) -> None:
        assert RetrievalAgent.fuse([], []) == []


class TestChunking:
    def test_short_text_is_one_chunk(self) -> None:
        assert EmbeddingAgent.chunk("short text") == ["short text"]

    def test_long_text_is_split_with_overlap(self) -> None:
        text = ". ".join(f"Sentence number {index}" for index in range(400))
        chunks = EmbeddingAgent.chunk(text)
        assert len(chunks) > 1
        assert all(chunk.strip() for chunk in chunks)

    def test_prefers_sentence_boundaries(self) -> None:
        text = "A" * 900 + ". " + "B" * 400
        chunks = EmbeddingAgent.chunk(text, size=1000, overlap=100)
        assert chunks[0].endswith(".")

    def test_empty_text_yields_no_chunks(self) -> None:
        assert EmbeddingAgent.chunk("") == []

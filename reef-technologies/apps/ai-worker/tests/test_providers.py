"""Provider tests. No network and no keys — these ARE the keyless providers."""

from reef_technologies_ai.providers.base import Passage
from reef_technologies_ai.providers.extractive import ExtractiveChatProvider
from reef_technologies_ai.providers.hashing import (
    HashingEmbeddingProvider,
    content_tokens,
    tokenize,
)


def cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


class TestTokenizer:
    def test_folds_accents(self) -> None:
        # The French half of the knowledge base is written with accents and
        # asked about without them, exactly as in Postgres.
        assert tokenize("Résidence fiscale") == ["residence", "fiscale"]

    def test_splits_on_punctuation_and_lowercases(self) -> None:
        assert tokenize("Tax residence — the 183-day rule!") == [
            "tax",
            "residence",
            "the",
            "183",
            "day",
            "rule",
        ]


class TestContentTokens:
    def test_drops_function_words(self) -> None:
        assert content_tokens("What are the rules for opening a casino?") == [
            "rules",
            "opening",
            "casino",
        ]

    def test_keeps_numbers_and_domain_words(self) -> None:
        # "183" is the whole point of the tax-residence rule, and "non" must
        # survive because "non-citizen" tokenises through it.
        assert content_tokens("non-citizens present 183 days") == [
            "non",
            "citizens",
            "present",
            "183",
            "days",
        ]

    def test_stops_grammar_from_looking_like_relevance(self) -> None:
        """A regression guard for a live guardrail failure.

        "What are the rules for opening a casino?" scored 0.26 against the
        retirement permit on "a", "for" and "the" alone. That cleared the
        relevance floor, so the concierge answered a gambling question by
        quoting an immigration rule — the failure "never invent immigration
        information" exists to prevent, arriving through retrieval rather than
        through generation.
        """
        assert not set(content_tokens("What are the rules for opening a casino?")) & set(
            content_tokens("Non-citizens aged 50 and above may apply for a permit.")
        )


class TestHashingEmbeddings:
    async def test_returns_one_unit_vector_of_the_right_size_per_input(self) -> None:
        provider = HashingEmbeddingProvider(dimensions=1536)
        vectors = await provider.embed(["permit", "property"])

        assert len(vectors) == 2
        assert all(len(vector) == 1536 for vector in vectors)
        assert cosine(vectors[0], vectors[0]) == 1.0

    async def test_is_deterministic_across_instances(self) -> None:
        """The property the whole pipeline rests on.

        Vectors written today are queried tomorrow, from another process.
        Python's own `hash()` is randomised per process, so a vectoriser built
        on it would silently stop matching its own stored output after a
        restart — retrieval would return nothing and nothing would look broken.
        """
        first = await HashingEmbeddingProvider().embed(["retirement residence permit"])
        second = await HashingEmbeddingProvider().embed(["retirement residence permit"])

        assert first == second

    async def test_scores_shared_vocabulary_above_unrelated_text(self) -> None:
        provider = HashingEmbeddingProvider()
        vectors = await provider.embed(
            [
                "retirement residence permit for non-citizens aged 50",
                "residence permit retirement application",
                "buying beachfront property under approved schemes",
            ]
        )

        assert cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2])

    async def test_gives_empty_text_a_zero_vector(self) -> None:
        # Zeros rather than a random unit vector: cosine against zero is 0
        # everywhere, so it retrieves nothing instead of something arbitrary.
        [vector] = await HashingEmbeddingProvider().embed(["!!! ???"])

        assert not any(vector)

    async def test_scores_an_unrelated_question_at_zero(self) -> None:
        provider = HashingEmbeddingProvider()
        vectors = await provider.embed(
            [
                "Non-citizens aged 50 and above may apply for a Retirement Residence Permit.",
                "What are the rules for opening a casino?",
            ]
        )

        # Not merely "low": nothing in common at all, so the relevance floor
        # rejects it however the floor is tuned.
        assert cosine(vectors[0], vectors[1]) == 0.0

    async def test_does_not_pretend_to_be_semantic(self) -> None:
        """The documented limitation, asserted so nobody mistakes it later.

        A synonym shares no characters, so it shares no buckets. This is the
        entire gap between the fallback and a real embedding model, and it is
        why the lexical and vector halves are fused rather than either being
        trusted alone.
        """
        provider = HashingEmbeddingProvider()
        vectors = await provider.embed(["residence permit", "visa authorisation"])

        assert cosine(vectors[0], vectors[1]) == 0.0


PASSAGES = [
    Passage(
        knowledge_id="k1",
        title="Retirement Residence Permit",
        text=(
            "Non-citizens aged 50 and above may apply for a Retirement Residence Permit. "
            "The permit is renewable and covers a spouse as a dependent."
        ),
        confidence=0.95,
    ),
    Passage(
        knowledge_id="k2",
        title="Buying property as a non-citizen",
        text="Non-citizens may acquire residential property under approved schemes.",
        confidence=0.9,
    ),
]


class TestExtractiveChat:
    async def test_quotes_the_sentence_that_answers_the_question(self) -> None:
        completion = await ExtractiveChatProvider().answer(
            "Can a spouse be included on the permit?", PASSAGES, "en"
        )

        assert "covers a spouse as a dependent" in completion.text
        assert "Retirement Residence Permit" in completion.text

    async def test_says_that_no_model_is_configured(self) -> None:
        """It must never read as generated prose.

        An unconfigured deployment that looked configured is the worst failure
        available to a platform whose rule is "never invent immigration
        information".
        """
        completion = await ExtractiveChatProvider().answer("permit?", PASSAGES, "en")

        assert "No language model is configured" in completion.text
        assert completion.provider == "extractive"

    async def test_answers_in_french_for_a_french_locale(self) -> None:
        completion = await ExtractiveChatProvider().answer("permis ?", PASSAGES, "fr")

        assert "sources vérifiées" in completion.text

    async def test_introduces_no_facts_of_its_own(self) -> None:
        # Every line of the body is a quotation from a supplied passage.
        completion = await ExtractiveChatProvider().answer("property?", PASSAGES, "en")
        quoted = [line for line in completion.text.splitlines() if line.startswith("—")]

        assert quoted
        for line in quoted:
            sentence = line.removeprefix("— ").rsplit(" (", 1)[0]
            assert any(sentence in passage.text for passage in PASSAGES)

    async def test_reports_no_usage_it_did_not_measure(self) -> None:
        completion = await ExtractiveChatProvider().answer("permit?", PASSAGES, "en")

        assert completion.usage is None


class TestEventBusTimings:
    def test_socket_timeout_outlives_the_blocking_read(self) -> None:
        """A regression guard for a bug that made the worker consume nothing.

        redis-py applies a read timeout to the socket regardless of the BLOCK
        argument. With the default, every blocking `XREADGROUP` raised
        `TimeoutError`, the consume loop logged and backed off, and the worker
        processed no events at all while its health endpoint said "ok".

        Asserting the relationship rather than the numbers: whatever the block
        becomes, the socket has to outlast it.
        """
        from reef_technologies_ai.core.events import _BLOCK_MS, _SOCKET_TIMEOUT_SECONDS

        assert _SOCKET_TIMEOUT_SECONDS > _BLOCK_MS / 1000


class TestEventContract:
    def test_finds_the_generated_contract(self) -> None:
        """A regression guard for a check that was silently disabled.

        The path was computed by counting `parents[n]` and resolved to
        `apps/packages/contracts/...`, which has never existed. So the artifact
        was never loaded, the known-event set was always empty, and the
        subscription guard — whose entire job is to make an unknown event name
        fail loudly — was skipped on every single startup.
        """
        from reef_technologies_ai.core.events import find_contracts_path

        path = find_contracts_path()

        assert path is not None, "the exported contract should be discoverable from the repo"
        assert path.exists()

    def test_knows_the_events_this_worker_subscribes_to(self) -> None:
        from reef_technologies_ai.core.events import load_event_names

        names = load_event_names()

        # The one the embedding agent reacts to. If this is absent the guard
        # would reject a subscription the worker genuinely needs.
        assert "knowledge.item.published" in names

    def test_rejects_an_event_outside_the_contract(self) -> None:
        import pytest

        from reef_technologies_ai.core.events import EventBus

        bus = EventBus(
            url="redis://localhost:6379",
            stream_prefix="test",
            consumer_group="test",
            consumer_name="test",
        )

        async def handler(envelope: dict[str, object]) -> None:  # pragma: no cover
            return None

        with pytest.raises(ValueError, match="not in the generated contract"):
            bus.subscribe("knowledge.item.invented", handler)

"""Redis Streams consumer and publisher — the Python half of the event bus.

Reads the SAME streams the Node API writes, under its own consumer group, so
both services see every event instead of stealing them from each other.

Payloads are validated against `packages/contracts/generated/contracts.schema.json`,
which is exported from the Zod catalog. TypeScript owns the contract; this side
consumes a generated artifact, so a producer change that this worker cannot
handle fails in CI rather than in production.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from typing import Any, cast

import redis.asyncio as redis
import structlog

from reef_technologies_ai.config import get_settings

logger = structlog.get_logger(__name__)

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]

#: How long one `XREADGROUP` parks waiting for messages.
_BLOCK_MS = 5_000

#: The socket read timeout, which MUST outlive the blocking read.
#:
#: redis-py applies a read timeout to the socket regardless of the BLOCK
#: argument, so with the default the client gives up on a call that is
#: behaving exactly as instructed: every blocking read raises `TimeoutError`,
#: the consume loop logs and backs off, and the worker silently consumes
#: nothing while looking busy. Derived from `_BLOCK_MS` rather than written as
#: a second number, so the two cannot drift apart.
_SOCKET_TIMEOUT_SECONDS = _BLOCK_MS / 1000 + 5.0

#: Where the generated contract lives, relative to whatever contains it.
_CONTRACTS_RELATIVE = Path("packages") / "contracts" / "generated" / "contracts.schema.json"


def find_contracts_path() -> Path | None:
    """Locates the generated contract by walking upward from this module.

    Counting `parents[n]` was wrong and silently so: it resolved to
    `apps/packages/contracts/...`, a directory that has never existed, so the
    artifact was never found, `load_event_names` always returned an empty set,
    and the subscription check — the thing that is supposed to make an unknown
    event name fail loudly — was skipped on every startup.

    Walking up finds it from the repository layout AND from the container's,
    where the tree is rooted at `/app` and no fixed depth is correct for both.
    `CONTRACTS_SCHEMA_PATH` overrides, for a deployment shaped like neither.
    """
    override = os.environ.get("CONTRACTS_SCHEMA_PATH")
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None

    for parent in Path(__file__).resolve().parents:
        candidate = parent / _CONTRACTS_RELATIVE
        if candidate.exists():
            return candidate
    return None


def load_event_names() -> set[str]:
    """Event names this deployment knows about, from the generated contract.

    Missing is fatal outside development. The worker's safety story is that the
    contract is enforced; a deployment that quietly accepts any event name
    instead is worse than one that refuses to start, because nothing about it
    looks wrong until a producer renames something.
    """
    path = find_contracts_path()

    if path is None:
        message = (
            "generated contract not found; run `pnpm contracts:export` "
            "or set CONTRACTS_SCHEMA_PATH"
        )
        if get_settings().environment == "development":
            logger.warning(message + " — event names will not be validated")
            return set()
        raise RuntimeError(message)

    document = json.loads(path.read_text())
    names = set(document.get("events", {}).keys())
    logger.info("event contract loaded", path=str(path), events=len(names))
    return names


class EventBus:
    """Durable consumer with at-least-once delivery.

    Handlers must be idempotent: an un-ACKed entry is redelivered after a crash
    or a partial failure, which is the price of never losing an event.
    """

    def __init__(
        self,
        url: str,
        stream_prefix: str,
        consumer_group: str,
        consumer_name: str,
    ) -> None:
        self._redis = redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=_SOCKET_TIMEOUT_SECONDS,
        )
        self._prefix = stream_prefix
        self._group = consumer_group
        self._consumer = consumer_name
        self._handlers: dict[str, list[EventHandler]] = {}
        self._running = False
        self._known_events = load_event_names()
        #
        # The consume loop, held deliberately.
        #
        # `asyncio.create_task` returns the only strong reference to the task it
        # creates; drop it and the event loop is free to garbage-collect the
        # task mid-flight, which stops consumption silently and at random.
        # Holding it here is what makes the loop live as long as the bus does.
        #
        self._consumer_task: asyncio.Task[None] | None = None

    def _stream_key(self, event_name: str) -> str:
        return f"{self._prefix}:{event_name}"

    def subscribe(self, event_name: str, handler: EventHandler) -> None:
        if self._known_events and event_name not in self._known_events:
            raise ValueError(
                f'"{event_name}" is not in the generated contract. '
                "Add it to the Zod catalog and re-run `pnpm contracts:export`."
            )
        self._handlers.setdefault(event_name, []).append(handler)

    async def publish(self, event_name: str, envelope: dict[str, Any]) -> None:
        await self._redis.xadd(self._stream_key(event_name), {"envelope": json.dumps(envelope)})
        logger.debug("published", event=event_name, id=envelope.get("id"))

    async def start(self) -> None:
        for event_name in self._handlers:
            try:
                await self._redis.xgroup_create(
                    self._stream_key(event_name), self._group, id="$", mkstream=True
                )
            except redis.ResponseError as error:
                # BUSYGROUP: another replica created it first — expected.
                if "BUSYGROUP" not in str(error):
                    raise
        self._running = True
        self._consumer_task = asyncio.create_task(self._consume_loop())
        logger.info("event bus started", streams=list(self._handlers))

    async def stop(self) -> None:
        self._running = False

        # Cancel and await, rather than leaving the loop to notice the flag on
        # its next 5-second block: shutdown should not take five seconds, and a
        # task still running while the connection closes logs a spurious error.
        if self._consumer_task is not None:
            self._consumer_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._consumer_task
            self._consumer_task = None

        await self._redis.aclose()

    async def _consume_loop(self) -> None:
        streams = {self._stream_key(name): ">" for name in self._handlers}
        if not streams:
            return

        while self._running:
            try:
                response = await self._redis.xreadgroup(
                    self._group,
                    self._consumer,
                    # `dict` is invariant in its value type, so a plain
                    # `dict[str, str]` is not assignable to the wide key/value
                    # union `redis-py` declares — even though every value here
                    # is one of its members. One cast, rather than widening the
                    # local and losing the checker on its construction.
                    cast("Any", streams),
                    count=8,
                    block=_BLOCK_MS,
                )
                for stream_key, entries in _as_stream_reply(response):
                    for entry_id, fields in entries:
                        await self._dispatch(stream_key, entry_id, fields)
            except asyncio.CancelledError:
                raise
            except redis.TimeoutError:
                # An idle window, not a fault: the block elapsed with nothing to
                # read. Caught explicitly so a quiet stream cannot be mistaken
                # for a broken one — and so that a client version which times
                # out at the socket layer degrades to polling rather than to
                # error-logging forever.
                continue
            except Exception:
                if not self._running:
                    return
                logger.exception("consume loop error; backing off")
                await asyncio.sleep(1.0)

    async def _dispatch(self, stream_key: str, entry_id: str, fields: dict[str, str]) -> None:
        raw = fields.get("envelope")
        if not raw:
            await self._ack(stream_key, entry_id)
            return

        try:
            envelope = json.loads(raw)
        except json.JSONDecodeError:
            # Unparseable: retrying cannot help, so ACK and drop.
            logger.error("malformed envelope dropped", entry=entry_id, stream=stream_key)
            await self._ack(stream_key, entry_id)
            return

        event_name = envelope.get("name", "")
        handlers = self._handlers.get(event_name, [])

        results = await asyncio.gather(
            *(handler(envelope) for handler in handlers), return_exceptions=True
        )
        failures = [result for result in results if isinstance(result, Exception)]

        if failures:
            # No ACK: the entry stays pending and is redelivered.
            logger.error(
                "handler failure; will redeliver",
                event=event_name,
                id=envelope.get("id"),
                failures=len(failures),
            )
            return

        await self._ack(stream_key, entry_id)

    async def _ack(self, stream_key: str, entry_id: str) -> None:
        await self._redis.xack(stream_key, self._group, entry_id)


def _as_stream_reply(response: object) -> list[tuple[str, list[tuple[str, dict[str, str]]]]]:
    """Narrows an `XREADGROUP` reply to the shape this module relies on.

    `redis-py` types the reply as `Any`-ish because its shape depends on
    `decode_responses` and on the RESP version in use. The connection here is
    built with `decode_responses=True`, so the entries are strings — but that
    is a fact about the constructor, not something the call site can prove.
    Asserting it once, in one function, is better than scattering `type: ignore`
    across the loop and losing the checker's help everywhere else.
    """
    if not isinstance(response, list):
        return []
    return response

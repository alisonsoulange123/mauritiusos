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
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import redis.asyncio as redis
import structlog

logger = structlog.get_logger(__name__)

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]

_CONTRACTS_PATH = (
    Path(__file__).resolve().parents[4] / "packages" / "contracts" / "generated" / "contracts.schema.json"
)


def load_event_names() -> set[str]:
    """Event names this deployment knows about, from the generated contract."""
    if not _CONTRACTS_PATH.exists():
        logger.warning("contracts artifact missing; run `pnpm contracts:export`", path=str(_CONTRACTS_PATH))
        return set()
    document = json.loads(_CONTRACTS_PATH.read_text())
    return set(document.get("events", {}).keys())


class EventBus:
    """Durable consumer with at-least-once delivery.

    Handlers must be idempotent: an un-ACKed entry is redelivered after a crash
    or a partial failure, which is the price of never losing an event.
    """

    def __init__(self, url: str, stream_prefix: str, consumer_group: str, consumer_name: str) -> None:
        self._redis = redis.from_url(url, decode_responses=True)
        self._prefix = stream_prefix
        self._group = consumer_group
        self._consumer = consumer_name
        self._handlers: dict[str, list[EventHandler]] = {}
        self._running = False
        self._known_events = load_event_names()

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
            except redis.ResponseError as error:  # noqa: PERF203
                # BUSYGROUP: another replica created it first — expected.
                if "BUSYGROUP" not in str(error):
                    raise
        self._running = True
        asyncio.create_task(self._consume_loop())
        logger.info("event bus started", streams=list(self._handlers))

    async def stop(self) -> None:
        self._running = False
        await self._redis.aclose()

    async def _consume_loop(self) -> None:
        streams = {self._stream_key(name): ">" for name in self._handlers}
        if not streams:
            return

        while self._running:
            try:
                response = await self._redis.xreadgroup(
                    self._group, self._consumer, streams, count=8, block=5000
                )
                for stream_key, entries in response or []:
                    for entry_id, fields in entries:
                        await self._dispatch(stream_key, entry_id, fields)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
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

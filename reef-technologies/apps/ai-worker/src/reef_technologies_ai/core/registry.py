"""Agent registry — the same plug-and-play pattern as the Node module registry.

One file to edit when an agent is added or removed. The orchestrator resolves
agents by capability rather than importing them, so nothing here knows which
concrete agents exist at import time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class Agent(Protocol):
    """The contract every agent satisfies."""

    key: str

    async def run(self, payload: dict[str, object]) -> dict[str, object]: ...


@dataclass(frozen=True)
class AgentDefinition:
    key: str
    description: str
    factory: type[Agent]
    # Events this agent reacts to, mirroring the Node module definition.
    subscribes: tuple[str, ...] = field(default_factory=tuple)
    publishes: tuple[str, ...] = field(default_factory=tuple)
    enabled: bool = True


class AgentRegistry:
    def __init__(self, definitions: list[AgentDefinition]) -> None:
        seen: set[str] = set()
        for definition in definitions:
            if definition.key in seen:
                raise ValueError(f'duplicate agent key "{definition.key}"')
            seen.add(definition.key)
        self._definitions = [d for d in definitions if d.enabled]
        self._instances: dict[str, Agent] = {}

    def get(self, key: str) -> Agent:
        if key not in self._instances:
            definition = next((d for d in self._definitions if d.key == key), None)
            if definition is None:
                raise KeyError(f'agent "{key}" is not registered or is disabled')
            self._instances[key] = definition.factory()
        return self._instances[key]

    @property
    def definitions(self) -> list[AgentDefinition]:
        return list(self._definitions)

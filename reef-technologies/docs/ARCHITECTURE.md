# Reef Technologies — architecture

A modular monolith that can be split into services without a rewrite, and a
frontend whose features can be enabled per deployment.

## The one-sentence version

Modules talk through **contracts** and **events** only; a registry file is the
sole place that knows which modules exist; and a boundary linter makes all of
that a build failure rather than a convention.

## Why a modular monolith, not microservices

Microservices from day one would buy independent deployment and cost
distributed transactions, network failure modes, and a separate repo per
bounded context — at a stage when the domain boundaries are still being
learned. The blueprints define ten bounded contexts, and some of them will turn
out to be wrong.

So: one process, hard internal boundaries. A module already communicates as if
it were remote (async events, versioned contracts, its own tables, no shared
transactions), which means extracting one later is a deployment change rather
than a redesign. The event bus is the seam — swapping `RedisEventBus` for a
broker does not touch a single module.

## Backend layout

```
apps/api/src/
├── main.ts                 process bootstrap: CORS, helmet, OpenAPI, shutdown
├── app.module.ts           THE COMPOSITION ROOT — the only file that knows both
│
├── core/                   global concerns. Knows NOTHING about modules.
│   ├── module-system/      module definition + loader (graph validation)
│   ├── config/             validated config; the only reader of process.env
│   ├── database/           pool, core tables (tenants, audit_log, processed_events)
│   ├── events/             EventBus port + in-memory & Redis adapters, idempotency
│   ├── contracts/          ContractRegistry + boot-time verifier
│   ├── tenancy/            TenantContext (ALS), middleware, resolver
│   ├── auth/               global deny-by-default guard, token service
│   ├── audit/              append-only audit trail
│   ├── http/               error filter, Zod pipe, trace interceptor
│   └── platform/           /_platform/{capabilities,topology,health}
│
└── modules/
    ├── registry.ts         ← THE ONE FILE you edit to add/remove a module
    ├── identity/           User Context (platform floor)
    ├── knowledge/          Knowledge Context — "the brain", RAG + provenance
    ├── immigration/        Immigration Context — declarative rules engine
    ├── assessment/         conversion funnel (consumes three contracts)
    ├── ai-concierge/       orchestration; delegates to the Python worker
    └── sample-feature/     the canonical template — copy this
```

Each module is four layers, dependencies pointing inward:

```
interface/ → application/ → domain/ ← infrastructure/
```

`domain/` imports nothing but `@reef-technologies/contracts`. That is what makes the
business rules testable in microseconds with no container.

## Inter-module communication

Two mechanisms. Nothing else is permitted.

### Events (default)

```ts
await this.events.publish('assessment.completed', { assessmentId, score, … });
```

Typed against `packages/contracts/src/events/catalog.ts`: an unknown event name
or a wrong payload is a **compile error**, and the bus re-validates at runtime
so a stale producer cannot poison a consumer.

Delivery is at-least-once (Redis Streams, consumer groups, un-ACKed entries
redelivered). Handlers therefore wrap their work in `IdempotencyGuard.once()`,
which claims the event in `processed_events` inside the same transaction as the
effect.

### Contracts (when you need an answer now)

```ts
const immigration = this.contracts.get(IMMIGRATION_CONTRACT);
const outcome = await immigration.evaluateBest(profile);
```

The consumer imports an *interface* from `@reef-technologies/contracts`, never the
providing module. `tryGet` returns `undefined` when the provider is disabled,
so a feature can degrade rather than fail — see `SubmitAssessmentUseCase`,
where eligibility is required but knowledge retrieval is optional.

## Boundaries, enforced

`scripts/check-boundaries.mjs` runs first in CI and fails in seconds:

1. `core/` must not import `modules/`
2. no cross-module deep imports
3. `domain/` must not import framework or persistence
4. frontend features must not import each other's internals, or `app/`
5. `components/ui/` must not import business code

ESLint enforces the same rules while you type; the script cannot be silenced by
an inline disable.

## Multi-tenancy — Core Platform + Country Packs

One codebase, many countries. `MauritiusOS` and `PortugalOS` differ only in
rows: immigration rules, knowledge items, partners and locations are all
tenant-scoped. Adding a country is a data migration.

Isolation is enforced three times over:

1. `TenantContext` (AsyncLocalStorage) — a request with no resolvable tenant is
   rejected by middleware before reaching a repository.
2. `withTenant()` — every repository composes its filters through it.
3. Postgres **row-level security** — even a repository bug cannot read another
   tenant's rows. This is why the app connects as `reef_technologies_app` and not as the
   table owner: owners and superusers bypass RLS.

## The AI boundary

```
browser → Next.js → NestJS API → Python worker → LLM
```

The frontend never calls an LLM, and neither does the API. Two paths to the
worker:

- **Synchronous** (a chat turn someone is waiting on): HTTP, with a timeout.
- **Asynchronous** (embedding, plan generation): the same Redis streams, under
  a different consumer group, so both services receive every event.

The worker holds **no database credentials**. It receives pre-authorized
context and nothing else, so a prompt injection has nothing to reach for.

Knowledge retrieval and rule evaluation both happen *before* the model is
called. The model's job is to phrase verified facts, not to recall them — which
is how "never invent immigration information" becomes an architectural property
instead of a line in a prompt.

## Configuration

One Zod schema, validated once, at boot, with production tripwires (an
in-memory event bus, a non-TLS database or a localhost CORS origin all refuse
to start in production).

Each module contributes its **own** env schema through its definition, and only
enabled modules' variables are required — so running with billing switched off
does not demand a payment provider key.

## Data ownership

Each module owns its tables, declared in
`modules/<key>/infrastructure/*.schema.ts`. `drizzle.config.ts` finds them by
**glob**, so there is no central schema file: adding a module adds tables,
deleting the directory drops them in the next generated migration.

Core owns only what is genuinely cross-cutting: `tenants`, `audit_log`,
`processed_events`.

## Observability

Every log line carries `traceId`, `tenantId` and `userId`. Every error response
carries the same `traceId`, so a screenshot from a user maps to a log line.
`GET /_platform/topology` renders the live coupling graph — the artifact to
open when someone asks what breaks if a module is removed.

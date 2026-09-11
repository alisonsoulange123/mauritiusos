# ANOMALIA

A multi-tenant, AI-native relocation intelligence platform. Modular monolith
backend (microservices-ready), feature-sliced frontend, Python AI worker.

Architecture derived from the MauritiusOS blueprints: DDD bounded contexts,
API contract, ERD, security/multi-tenancy model and engineering standards.

```
┌──────────────┐   ┌──────────────┐
│  apps/web    │   │ apps/admin   │   Next.js 15 · App Router · FSD
│  landing +   │   │ back office  │   features gated by API capabilities
│  portal      │   │ (planned)    │
└──────┬───────┘   └──────┬───────┘
       └──────────┬───────┘
                  ▼
        ┌───────────────────┐
        │     apps/api      │   NestJS · modular monolith
        │  core/ + modules/ │   registry-driven, boundary-enforced
        └─────┬──────┬──────┘
              │      │
   Redis Streams     │ HTTP (sync, pre-authorized context only)
              │      │
              ▼      ▼
        ┌───────────────────┐
        │  apps/ai-worker   │   FastAPI · RAG · agents · embeddings
        └───────────────────┘
                  │
       PostgreSQL + pgvector · Redis
```

## Quick start

```bash
pnpm install
pnpm infra:up                                   # postgres (pgvector) + redis
cp apps/api/.env.example apps/api/.env          # then set JWT_SECRET
cp apps/web/.env.example apps/web/.env.local
cp apps/ai-worker/.env.example apps/ai-worker/.env

pnpm contracts:export                           # Zod catalog -> JSON Schema for Python
pnpm db:generate && pnpm db:migrate
pnpm --filter @anomalia/api seed                # tenant + immigration rules + knowledge
pnpm dev                                        # api :4000 · web :3000

cd apps/ai-worker && pip install -e ".[dev]" && uvicorn anomalia_ai.main:app --reload
```

| URL | What |
|---|---|
| `localhost:3000` | Landing + portal |
| `localhost:4000/api/v1/docs` | OpenAPI |
| `localhost:4000/api/v1/_platform/capabilities` | Which modules are live |
| `localhost:4000/api/v1/_platform/topology` | Live coupling graph |
| `localhost:8000/docs` | AI worker |

## Repository structure

```
anomalia/
├── apps/
│   ├── api/                     NestJS modular monolith
│   │   ├── src/core/            global concerns — knows NOTHING about modules
│   │   │   ├── module-system/   module definition + loader (graph validation)
│   │   │   ├── config/          validated config; only reader of process.env
│   │   │   ├── database/        pool + core tables + RLS helpers
│   │   │   ├── events/          EventBus port; in-memory & Redis adapters
│   │   │   ├── contracts/       ContractRegistry + boot-time verifier
│   │   │   ├── tenancy/         TenantContext (ALS), middleware, resolver
│   │   │   ├── auth/            global deny-by-default guard
│   │   │   ├── audit/           append-only audit trail
│   │   │   ├── http/            error filter, Zod pipe, trace interceptor
│   │   │   └── platform/        capabilities · topology · health
│   │   ├── src/modules/
│   │   │   ├── registry.ts      ← ONE FILE to add or remove a module
│   │   │   ├── sample-feature/  the canonical template — copy this
│   │   │   ├── identity/        User Context
│   │   │   ├── knowledge/       Knowledge Context (RAG + provenance)
│   │   │   ├── immigration/     declarative rules / decision engine
│   │   │   ├── assessment/      conversion funnel
│   │   │   └── ai-concierge/    orchestration -> Python worker
│   │   └── src/app.module.ts    THE COMPOSITION ROOT
│   │
│   ├── web/                     Next.js 15
│   │   ├── src/app/             layout, providers, /portal/[feature]
│   │   ├── src/features/
│   │   │   ├── registry.ts      ← ONE FILE to add or remove a feature
│   │   │   ├── resolve-features.ts   capability + auth + role gating
│   │   │   ├── assessment/      ui/ · model/ · api/
│   │   │   ├── ai-concierge/
│   │   │   └── knowledge-explorer/
│   │   ├── src/components/ui/   dumb primitives
│   │   └── src/shared/          api client, config, utils
│   │
│   └── ai-worker/               FastAPI + Redis Streams consumer
│       └── src/anomalia_ai/
│           ├── agents/registry.py    ← ONE FILE to add or remove an agent
│           ├── core/events.py        same streams as the API
│           └── config.py             pydantic-settings, strict
│
├── packages/
│   ├── contracts/               event catalog · module contracts · error envelope
│   ├── config/                  Zod env schemas (server + client) + flags
│   ├── db/                      Drizzle client, tenancy helpers, column vocabulary
│   ├── ui/                      Tailwind preset + design tokens
│   ├── tsconfig/                shared TS configs
│   └── eslint-config/           lint + architectural boundary rules
│
├── infrastructure/docker/       compose stack, DB init (extensions + app role)
├── scripts/check-boundaries.mjs the architecture guard
└── docs/                        ARCHITECTURE · ADDING_A_MODULE · ADDING_A_FEATURE
```

## The three registries

Everything plug-and-play about this repo reduces to three files.

| File | Add a… | Effect |
|---|---|---|
| `apps/api/src/modules/registry.ts` | backend module | routes, tables, events, config, contracts |
| `apps/web/src/features/registry.ts` | frontend feature | route, nav item, gating, lazy bundle |
| `apps/ai-worker/src/anomalia_ai/agents/registry.py` | AI agent | subscriptions, orchestration |

Nothing else changes. Not `core/`, not `app.module.ts`, not a route table, not
a central schema file.

## How modules stay decoupled

**Events** (default) — typed against the catalog in `@anomalia/contracts`, so a
bad event name or payload is a compile error:

```ts
await this.events.publish('assessment.completed', { assessmentId, score, … });
```

**Contracts** (when a user is waiting on the answer) — the consumer imports an
interface, never the providing module:

```ts
const immigration = this.contracts.get(IMMIGRATION_CONTRACT);
const knowledge = this.contracts.tryGet(KNOWLEDGE_CONTRACT);  // degrades if off
```

**Nothing else.** No cross-module imports, no shared tables, no shared
transactions. Enforced by `pnpm boundaries`, which runs first in CI.

## What fails at boot, on purpose

The module loader refuses to start on: a duplicate key, an event name not in
the catalog, a `consumes` with no enabled provider, two modules providing the
same contract, a dependency cycle, an advertised contract that was never
registered, an `experimental` module in production, or missing env vars for an
enabled module.

A misconfigured deployment dies in the container, not at a user's first request.

## Feature flags

One flag per module, derived from the key — `sample-feature` →
`FEATURE_SAMPLE_FEATURE`. Turn one off and:

- its routes 404 and its tables are untouched
- modules that `dependsOn` it are disabled too, transitively
- its env vars stop being required
- frontend features that `requiresModules` it disappear from nav, and their
  JavaScript is never downloaded

Ship the billing UI months before billing is enabled; turn it on with an env
var on the API, no frontend deploy.

## Multi-tenancy

Core Platform + Country Packs: one codebase, many countries. Rules, knowledge,
partners and locations are tenant-scoped rows, so adding Portugal is a data
migration.

Isolation is enforced three times: `TenantContext` rejects an unresolvable
tenant in middleware, `withTenant()` in every repository, and Postgres
row-level security underneath. The app connects as `anomalia_app`, never the
table owner — owners bypass RLS.

## Verified behaviour

The scaffold was run end to end against Postgres 17 + pgvector and Redis, not
just compiled. What was confirmed:

| Claim | Evidence |
|---|---|
| Registry drives the module graph | boots `identity → knowledge → immigration → ai-concierge → assessment → sample-feature`, topologically sorted |
| Module owns its schema | `db:generate` discovered 16 tables by glob across core + 6 modules |
| Contracts self-register | 4 contracts registered; `ContractVerifier` passed at boot |
| Events decouple modules | registering a user published `identity.user.registered`; `sample-feature` reacted and wrote a row, with the idempotency claim recorded — no import between them |
| Cross-module orchestration | assessment resolved eligibility + knowledge through contracts; retiree → `retirement_residence` 0.95, investor → `occupation_investor` 0.90, remote worker → `premium_visa` 0.88 |
| Flags cascade | `FEATURE_IMMIGRATION=false` disabled `assessment` and `ai-concierge` transitively; their routes 404, the rest kept serving |
| Frontend follows the API | with immigration off, `/portal/assessment` and `/portal/ai-concierge` 404 and vanish from nav — **no frontend rebuild or restart** |
| Config fails fast | a missing `JWT_SECRET` refuses to start and names every missing variable |
| Boundaries are enforced | the guard catches relative cross-module imports, module-root imports, cross-feature imports and `features/ → app/` |
| Session never reaches the browser | no access token, refresh token or JWT-shaped string appears in the HTML, the RSC payload or any of the 13 client chunks |
| Token type confusion is refused | a refresh token presented as a bearer is rejected 401 (it previously reached `claims.roles.filter` on an absent claim and 500'd) |
| Cross-tenant replay is refused | a token minted for one tenant is rejected 403 on another, on both the access and refresh paths |
| Refresh rotation | each refresh retires the token it was given; the replaced token stops working |
| Reuse detection | replaying a retired token revokes **every** session on the account — the victim's current refresh token, their unexpired access token, and an untouched second device all stop working |
| Revocation is real, not nominal | the guard consults the denylist, so a revoked session's still-valid access token is rejected rather than working out its 15 minutes |
| Concurrent refresh is not an attack | 5 simultaneous refreshes of one token all succeed, converge on a single token and advance the lineage once |
| Sign-out is server-side | `POST /auth/logout` ends that lineage only; a second device keeps its session |
| Roles can actually change | `PATCH /auth/users/:id/role` moves `lead → client`, publishes the `identity.role.changed` the manifest always declared, and revokes the account's sessions so the new role applies at once rather than in up to 15 minutes |
| Privilege cannot be self-granted | an advisor may work the `visitor/lead/client` ladder only — minting or stripping `advisor`/`admin`/`knowledge_manager` is refused, as is changing your own role, admins included; both denials are audited with the reason |
| Capability outage degrades safely | with the API down the site keeps its features from a last-known-good snapshot; only a cold start with no snapshot reports "unavailable" |

`pnpm verify` is green: boundaries clean, 0 type errors, 0 lint errors/warnings,
77 tests passing, both apps building.

The session-registry tests talk to a real Redis, because the part worth testing
is a Lua compare-and-swap and a mock of it would only prove the mock agrees
with itself. CI provides the service; locally they skip when nothing is
listening rather than failing `verify` on a machine with no infrastructure up.

Not yet exercised: the Python worker's `pytest` suite (the toolchain targets
3.12; its agent logic was verified directly), and any LLM call — the worker
returns grounded stubs until API keys are supplied.

### Sessions

The access token is the only credential sent to the API and lasts 15 minutes.
Both tokens live in httpOnly cookies, so page scripts cannot read them; browser
calls reach the API through a same-origin proxy that attaches the bearer
server-side. Next.js middleware renews silently, because only middleware, route
handlers and server actions may set cookies — a server component can read a
session but cannot renew one.

Refresh tokens rotate, and rotation is what makes theft detectable: each
refresh retires the token it was presented with, so a retired token coming back
means two parties hold the same credential. There is no way to tell which is
the user, so every session on the account ends. Lineages ("families") are held
in Redis and the rotation itself is a Lua compare-and-swap, so concurrent
refreshes cannot both believe they won.

`AUTH_REFRESH_GRACE_SECONDS` (default 5) is the one hole, and it is deliberate:
a single page load can fire several requests carrying the same expired cookie,
and without leeway an ordinary navigation would look like an attack and sign
the user out everywhere. Within that window a replay is honoured; after it, the
account is signed out. Set it as low as the client's concurrency allows.

## Commands

```bash
pnpm dev              # all apps
pnpm verify           # boundaries → typecheck → lint → test
pnpm boundaries       # architecture guard alone (seconds, no install)
pnpm contracts:export # Zod catalog -> JSON Schema for the Python worker
pnpm db:generate      # migration from module schemas (glob-discovered)
pnpm db:migrate
pnpm --filter @anomalia/api seed   # dev data: tenant, permit rules, knowledge
```

## Stack

| | |
|---|---|
| Backend | NestJS 11 · TypeScript · Drizzle · OpenAPI |
| Frontend | Next.js 15 (App Router) · Tailwind · Framer Motion · TanStack Query |
| AI | FastAPI · Python 3.12 · pgvector · Claude Opus 5 / Haiku 4.5 |
| Data | PostgreSQL 17 + pgvector · Redis Streams |
| Tooling | Turborepo · pnpm · Zod end-to-end · Vitest · pytest · ruff |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the decisions and why
- [docs/ADDING_A_MODULE.md](docs/ADDING_A_MODULE.md) — backend walkthrough
- [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) — frontend walkthrough

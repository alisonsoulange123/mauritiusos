# Reef Technologies

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
pnpm --filter @reef-technologies/api seed                # tenant + immigration rules + knowledge
pnpm dev                                        # api :4000 · web :3000

cd apps/ai-worker && pip install -e ".[dev]" && uvicorn reef_technologies_ai.main:app --reload
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
reef-technologies/
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
│       └── src/reef_technologies_ai/
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
| `apps/ai-worker/src/reef_technologies_ai/agents/registry.py` | AI agent | subscriptions, orchestration |

Nothing else changes. Not `core/`, not `app.module.ts`, not a route table, not
a central schema file.

## How modules stay decoupled

**Events** (default) — typed against the catalog in `@reef-technologies/contracts`, so a
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
row-level security underneath. The app connects as `reef_technologies_app`, never the
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
| Account recovery works without a mail vendor | registration, reset and the change notice are composed and delivered through a `Mailer` port; the `log` transport prints them, an env invariant refuses it in production |
| A reset link is single use | eight simultaneous redemptions of one token yield exactly one success — the read and the delete are one Lua call |
| A reset link is stored hashed | only SHA-256 of the token is in Redis; the token itself appears nowhere, so a dump of the store yields nothing usable |
| A rejected password does not spend the link | a too-short password is refused 422 and the same link still completes the reset |
| Reset ends every session | the account's live access token stops working immediately, the old password is refused, the replayed link returns 410, and the owner is notified at the address on file |
| Forgot-password does not enumerate | a registered and an unknown address both return `202 {"status":"sent"}`; only the registered one produces a message, and the unknown attempt is audited as denied |
| Confirmation survives link scanners | the emailed URL renders a page with a button instead of consuming the token on GET, so a mail client's prefetch cannot spend it |
| Unproven identities cannot be promoted | `lead → client` is refused with `unverified-email` until the address is confirmed — for admins too, since no amount of privilege makes an unconfirmed address confirmed; movement inside `visitor`/`lead` and demotions stay allowed |
| The portal says so | an unconfirmed account sees the prompt and a resend button; once confirmed it disappears and the concierge unlocks |
| Back Office exists | `/admin` gives advisors an account directory and admins the audit trail; the role change that was API-only now has a UI, and every screen is a server component — no admin data reaches a browser bundle |
| The back office gate is layered | a `client` is redirected to the portal and an anonymous visitor to sign-in; an advisor reaching `/admin/audit` lands back on the directory; underneath, `/auth/users` answers 403 to a client and 401 to an anonymous caller, and `/audit` answers 403 to an advisor |
| Refusals reach the operator intact | submitting the role form for an unconfirmed account renders the API's own sentence and records `identity.role.change_denied`; an advisor attempting `admin` is told only an administrator may assign it |
| The form works without JavaScript | every result above was produced by replaying the rendered form as a plain multipart POST — progressive enhancement is real, not assumed |
| Paging is stable under ties | 42 accounts paged two at a time yielded 42 distinct rows and no duplicates, including five rows sharing a single millisecond; a tampered cursor is refused rather than silently restarting the listing |
| The API was capped at 10 req/min | **fixed**: every configured throttler applies to every route, so the `auth` bucket meant to protect login was throttling the entire API. One coarse bucket now, tightened per route — login still stops at 10 guesses while the directory serves 15 reads without blinking |

| Knowledge has an authoring surface | `/admin/knowledge` gives `knowledge_manager` the role's first actual capability: draft, revise, cite a source, verify, and move items through draft → review → published → archived |
| Provenance is enforced, not asserted | publication is refused in order — no source, then never verified, then empty, then below the search floor — each with a sentence naming the fix; every refusal is audited with its reason |
| Published text is frozen | editing a published item returns 409 naming the remedy, because the item carries a verification date and rewriting the words behind it would make that date describe a paragraph nobody verified |
| The UI cannot offer an illegal move | the server derives the permitted transitions from the same policy that judges the request, so a draft shows "Send for review" and "Archive" and no Publish button at all |
| `knowledge.item.published` is real | declared in the manifest since the first commit, subscribed to by `ai-concierge`, and published by nothing until now — confirmed on the Redis stream with the full envelope |
| Editors see what search withholds | a published item past its verification window vanishes from public search and appears in the Back Office flagged "needs re-verification", from one predicate shared by both |
| French content is findable | **fixed**: search indexed `société` and a reader typing `societe` matched nothing. `unaccent` had been installed since the first migration — with a comment saying it was there "so Rivière matches Riviere" — and never used. Both sides now fold; English results are unchanged |
| Back office sections gate per page | **fixed**: the shell admitted anyone with any section, so a knowledge manager opening `/admin/users` got a 500 from a 403, and `/admin/audit` bounced them to that same broken page. Each page now admits its own section and misdirects land on a section the viewer can actually open |

| The AI worker does real work | `knowledge.item.published` → fetch → chunk → embed → `knowledge_embeddings`, confirmed end to end with 1536-dimension vectors written per chunk |
| It runs without any API key | models sit behind ports with keyless implementations: a hashing vectoriser for embeddings and an extractive answerer that quotes verified sentences. Credentials alone decide which runs, and the reply says when no model is configured |
| The concierge answers and cites | asked whether a spouse is covered, it quotes the two sentences of the permit rule that say so; asked about tax residence, the 183-day sentence — both attributed, both from published, in-locale, verified items |
| …and declines what it cannot source | **fixed**: nearest-neighbour search always returns a neighbour, so an uncovered topic quoted whatever was least unlike it. A question about casinos scored 0.26 against the retirement permit on the words "a", "for" and "the" alone, cleared the floor, and got an immigration rule as its answer |
| Grammar is not relevance | the vectoriser now drops English and French function words: the same question scores 0.00 and is declined, while the spouse question rose to 0.43 |
| The Python job was never green | **fixed**: 10 ruff errors and 12 mypy errors under `strict`, including an `asyncio.create_task` whose result nobody held — the consume loop could be garbage-collected mid-flight |
| Blocking reads actually block | **fixed**: under redis-py 8 every blocking `XREADGROUP` raised `TimeoutError`, so the worker logged an error every five seconds and consumed nothing while reporting healthy. The socket timeout now outlives the block, and a test asserts the relationship |

| The platform runs from images | five services on one compose network — postgres, redis, a migration job, a seed job, then API, worker and web; web starts only once the API reports healthy, and every container's healthcheck passes |
| Migrations are a separate target | `drizzle-kit` is a dev dependency, so the runtime image cannot run migrations and should not be able to; `--target migrator` builds one that can, connecting as the schema owner while the API connects as an unprivileged role that RLS actually applies to |
| A migrated database serves nothing | discovered by deploying it: no tenant row means the tenancy middleware rejects every request with 400. A seed job covers local use; production provisioning is named as the open gap rather than papered over |
| An IP address is not a subdomain | **fixed**: `slugFromHost('127.0.0.1')` split four labels and resolved the tenant slug `0`, so every request reaching the API by address — a sibling container, a load-balancer probe, the image's own healthcheck — was refused 400. Invisible locally, because `localhost` has one label and falls through to the default |
| The API URL must resolve from the server | **fixed**: every consumer of `NEXT_PUBLIC_API_BASE_URL` runs inside the Next server, since page scripts reach the API through the same-origin proxy. Baked as `localhost` the web container called itself and answered 502 to everything; it is the service name now |
| The worker's contract check was a no-op | **fixed**: the path counted `parents[n]` and resolved to `apps/packages/contracts/…`, which has never existed — so the known-event set was always empty and the subscription guard never ran. It walks upward now, loads 15 events, and rejects an unknown name |

| The claims above are now guarded | 31 integration tests boot the real application against a real Postgres and Redis and drive it over HTTP — token-type confusion, reuse detection revoking every session, cross-tenant replay, the role policy's refusals, enumeration-safe password reset, and every publication rule |
| Nothing in them is mocked | the behaviours that broke in this codebase lived in the seams — middleware order, the global guard, the Zod pipe, the error filter, tenant resolution, the throttler's real request context — and a test that calls a use case directly proves none of them |
| Test code no longer ships | **fixed**: `tsconfig.json` had no `exclude`, so `nest build` compiled every `__tests__` directory into `dist/`, and the Docker image copies `dist` wholesale — the production artifact contained the suite, its fixtures and the harness that boots the app with a chosen configuration |
| The rate-limit bug cannot come back | a dedicated suite boots with the limiter live: login stops at exactly ten guesses a minute while fifteen ordinary reads all succeed |

| Capability outage degrades safely | with the API down the site keeps its features from a last-known-good snapshot; only a cold start with no snapshot reports "unavailable" |

`pnpm verify` is green: boundaries clean, 0 type errors, 0 lint errors/warnings,
144 unit tests across the TypeScript workspace, 30 in the Python worker and 31 HTTP integration tests, all three images building and running.

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
pnpm --filter @reef-technologies/api seed   # dev data: tenant, permit rules, knowledge

pnpm test:integration # boots the real app against real Postgres + Redis;
                      # skips cleanly when neither is running
```

```bash
# The Python worker, which has its own toolchain.
cd apps/ai-worker && uv venv --python 3.12 .venv && uv pip install -e ".[dev]"
source .venv/bin/activate && ruff check src tests && mypy src && pytest -q
```

## Containers

Three images, each built from the repository root because a workspace package
cannot be built without the lockfile and the packages it depends on:

```bash
docker build -f apps/api/Dockerfile       -t reef-technologies-api .
docker build -f apps/web/Dockerfile       -t reef-technologies-web .
docker build -f apps/ai-worker/Dockerfile -t reef-technologies-ai-worker .
```

The whole platform, from those images:

```bash
export JWT_SECRET=$(openssl rand -base64 32)
docker compose -f infrastructure/docker/docker-compose.yml \
               -f infrastructure/docker/docker-compose.app.yml up --build
```

Five services come up in order — postgres and redis, then a migration job, then
a seed job, then the API, then the worker and the web app once the API reports
healthy.

Three things about it are worth knowing before deploying anywhere:

**Migrations are a separate image target.** `drizzle-kit` is a development
dependency, so the runtime image cannot run migrations — and should not be able
to. `--target migrator` builds an image that can, and it connects as the schema
*owner*, while the API connects as an unprivileged role. That split is not
cosmetic: Postgres row-level security is bypassed by table owners, so an API
running as the owner would silently have no tenant isolation at all.

**A migrated database serves nothing.** There is no tenant row, so the tenancy
middleware rejects every request with 400. The `seed` service fills that gap for
local use and refuses to run against production, by design. A real deployment
needs a provisioning step that creates the tenant and its first administrator
from supplied values — **that does not exist yet**, and it is the honest gap in
this deployment story.

**`NEXT_PUBLIC_API_BASE_URL` must be reachable from the server, not the
browser.** Despite the prefix, every consumer runs inside the Next server; page
scripts reach the API through the same-origin proxy because the session cookie
is httpOnly. In a container network that means the service name. Point it at
`localhost` and the web app calls itself, answering 502 to everything.

Not included, and needed before this is a deployment rather than a proof that
the images work: TLS termination, secret management, log shipping, and a
registry to push to.

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

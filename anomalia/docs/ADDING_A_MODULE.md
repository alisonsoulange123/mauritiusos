# Adding a backend module

The whole integration is **one directory and one line**. This document is the
proof; if a step below ever requires touching `core/`, that is a bug in the
architecture, not in your module.

## 1. Add the key

`packages/contracts/src/modules/keys.ts`:

```ts
export const MODULE_KEYS = [
  // …
  'billing',   // ← add
] as const;
```

This single addition gives you the `FEATURE_BILLING` flag (derived, not
declared), a valid `dependsOn` target, and a key the frontend can require.

## 2. Copy the template

```bash
cp -r apps/api/src/modules/sample-feature apps/api/src/modules/billing
```

Then work outward from the centre:

| Layer | Directory | May import | Holds |
|---|---|---|---|
| Domain | `domain/` | nothing but `@anomalia/contracts` | entities, invariants, repository **ports** |
| Application | `application/` | domain, core | use cases, contract impl, subscribers |
| Infrastructure | `infrastructure/` | domain, core, drizzle | `*.schema.ts`, repository **adapters** |
| Interface | `interface/http/` | application | controllers, DTOs |

Dependencies point **inward**. The boundary linter fails the build if
`domain/` imports `@nestjs/*` or `drizzle-orm`.

## 3. Declare the module

`apps/api/src/modules/billing/index.ts`:

```ts
export default defineModule({
  key: 'billing',
  version: '1.0.0',
  description: 'Subscriptions and invoicing.',
  nestModule: BillingModule,
  stability: 'experimental',          // cannot run in production until 'beta'
  configSchema: z.object({ BILLING_PROVIDER_KEY: z.string().min(20) }),
  provides: [BILLING_CONTRACT],
  consumes: [IDENTITY_CONTRACT],
  dependsOn: ['identity'],
  publishes: ['billing.subscription.activated'],
  subscribes: ['identity.user.registered'],
});
```

Be honest in this declaration — the loader enforces every field, and it is
what the next engineer reads to understand your blast radius.

## 4. Register it

`apps/api/src/modules/registry.ts` — one import, one array entry. **Done.**

No `core/` edit, no `app.module.ts` edit, no central schema file, no route
table, no migration registration.

## 5. Generate the migration

```bash
pnpm db:generate   # globs modules/*/infrastructure/*.schema.ts
pnpm db:migrate
```

## Boot-time checks you now get for free

The loader refuses to start if you have:

- a duplicate module key
- an event name that is not in the catalog (a typo'd subscription)
- a `consumes` with no enabled provider
- two modules providing the same contract
- a dependency cycle
- a `provides` that is never actually registered (caught by `ContractVerifier`)
- an `experimental` module in production
- missing or invalid env vars **for enabled modules only**

## Choosing how to talk to another module

| Need | Use | Coupling |
|---|---|---|
| Tell others something happened | `events.publish(...)` | none — publisher does not know its subscribers |
| Need an answer in this request | `contracts.get(TOKEN)` | interface only, plus a `dependsOn` |
| Can proceed without the answer | `contracts.tryGet(TOKEN)` | interface only, no hard dependency |
| Read another module's tables | **never** | — |

Default to events. Reach for a contract only when a user is waiting on the
answer, and prefer `tryGet` so the feature degrades instead of failing.

## Removing a module

Delete the directory, delete its registry line, delete its key. Run
`pnpm db:generate` for the drop migration. Nothing else references it — that
is the guarantee the boundary linter has been maintaining all along.

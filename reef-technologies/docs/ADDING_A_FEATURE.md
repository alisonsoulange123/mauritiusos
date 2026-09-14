# Adding a frontend feature

Same shape as the backend: **one directory, one registry line.**

## 1. Create the slice

```
src/features/roadmap/
├── index.ts          # the definition — metadata ONLY, no component imports
├── ui/               # screens and components
├── model/            # hooks, state machines
└── api/              # fetchers + response schemas
```

## 2. Declare it

```ts
export default defineFeature({
  key: 'roadmap',
  title: 'Relocation Roadmap',
  description: 'Your personalised steps, documents and deadlines.',
  requiresModules: ['relocation'],        // ← the important line
  requiresRoles: ['client', 'advisor'],
  mount: () => import('./ui/roadmap-screen'),
  nav: { order: 40, icon: 'map' },
});
```

`requiresModules` is checked against `GET /_platform/capabilities` at render
time. **Consequence:** you can ship this feature today with the `relocation`
backend module disabled, and it simply will not appear. Enable the module with
an env var on the API and the feature appears — no frontend deploy.

Keep `index.ts` free of component imports: the registry imports it eagerly, so
anything pulled in here lands in the shared bundle. The screen arrives through
`mount()`, which is a dynamic import.

## 3. Register it

`src/features/registry.ts` — one import, one array entry. **Done.**

Routing (`/portal/<key>`), navigation, ordering and gating are all derived.
There is no route file to add and no nav component to edit.

## Layer rules (enforced by lint + `scripts/check-boundaries.mjs`)

```
app/            composes features; owns layout, providers, routes
 ↓
features/       isolated business features; never import each other
 ↓
components/ui/  dumb primitives; no business knowledge whatsoever
 ↓
shared/         api client, config, utilities
```

- `features/` **may not** import from `app/` — data flows one way.
- One feature **may not** import another's `ui/`, `model/` or `api/`. If two
  features need the same thing, lift it into `shared/` or `components/ui/`.
- `components/ui/` **may not** import from `features/` or `app/`.

## Local overrides

`NEXT_PUBLIC_FLAG_OVERRIDES=roadmap` previews a feature locally. It can only
ever *narrow* — it cannot conjure an endpoint the API does not serve, because
the capability check runs first.

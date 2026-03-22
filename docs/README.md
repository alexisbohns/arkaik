# arkaik Documentation

## Contents

- [Architecture](architecture.md) — System design, component relationships, data flow
- [Graph Model](graph-model.md) — 4-species taxonomy, composition model, statuses, platforms, edge types
- [Data Layer](data-layer.md) — DataProvider interface, local storage, import/export
- [Conventions](conventions.md) — Coding patterns, file organization, state management
- [Vision](vision.md) — Long-term product direction and roadmap ideas

## Frontend Docs Route

Documentation is also available inside the app at `/docs`.

- `/docs` renders the repository root `README.md`
- `/docs/<path>` maps to markdown files under `docs/` (including nested paths)
- Unknown docs routes redirect to `/docs`

Source references: `app/docs/layout.tsx`, `app/docs/page.tsx`, `app/docs/[...slug]/page.tsx`, `lib/utils/docs.ts`

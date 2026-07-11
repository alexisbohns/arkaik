# arkaik Documentation

## Contents

- [Architecture](architecture.md) — System design, component relationships, data flow
- [Graph Model](graph-model.md) — 4-species taxonomy, composition model, statuses, platforms, edge types
- [Data Layer](data-layer.md) — DataProvider interface, local storage, import/export
- [Conventions](conventions.md) — Coding patterns, file organization, state management
- [Vision](vision.md) — Product strategy: the four layers, modes & tiers, format levels, roadmap

## Specifications

Normative (draft) specs for the arkaik format and tooling:

- [Bundle Format v2](spec/bundle-format.md) — schema versioning, references, asset values, ID conventions, canonical serialization
- [Journal & Events](spec/journal.md) — event vocabulary, JSONL sidecar, authority model, releases & projections
- [Toolchain & Packaging](spec/toolchain.md) — npm workspace, `@arkaik/schema`, the `arkaik` CLI, skill distribution

## LLM & Prompt Surfaces

- Generate prompt builder UI: `/generate`
- LLM concise manifest: `/llms.txt`
- LLM full context bundle: `/llms-full.txt`
- Import schema: `/schema/project-bundle.json`
- Import example bundle: `/schema/example-bundle.json`

## Frontend Docs Route

Documentation is also available inside the app at `/docs`.

- `/docs` renders the repository root `README.md`
- `/docs/<path>` maps to markdown files under `docs/` (including nested paths)
- Unknown docs routes redirect to `/docs`

Source references: `app/docs/layout.tsx`, `app/docs/page.tsx`, `app/docs/[...slug]/page.tsx`, `lib/utils/docs.ts`

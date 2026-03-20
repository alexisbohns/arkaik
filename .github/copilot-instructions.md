# Project Guidelines

## Framework Warning

This project uses Next.js 16 with breaking changes. Read `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

## Architecture

- Product graph browser built with React Flow on Next.js App Router
- 8-level species hierarchy (token → product) + 2 parallel layers (data-model, api-endpoint)
- Local-first data with provider abstraction (localStorage now, Supabase planned)
- See `docs/` for detailed documentation

## Documentation

When reviewing or making changes:

- If a new component, hook, node type, or data type is added → update relevant doc in `docs/`
- If a public function/hook signature changes → verify JSDoc is updated
- If species, statuses, platforms, or edge types change → update `docs/graph-model.md`
- If architecture or data flow changes → update `docs/architecture.md`

## Conventions

- State: local hooks (`useNodes`, `useEdges`, `useProject`, `useGraphNavigation`) — no global store
- Styling: Tailwind + shadcn/ui + class-variance-authority
- Config: typed const arrays in `lib/config/` — add new taxonomies there
- Data: all mutations go through `DataProvider` interface in `lib/data/`

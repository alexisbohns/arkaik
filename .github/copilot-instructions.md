# Project Guidelines

## Framework Warning

This project uses Next.js 16 with breaking changes. Read `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

## Architecture

- Product graph browser built with React Flow on Next.js App Router
- 4-species model (`flow`, `view`, `data-model`, `api-endpoint`) with playlist-driven flow expansion
- Project shell routes include both canvas and library (`/project/[id]/canvas`, `/project/[id]/library`)
- Local-first data with provider abstraction (localStorage now, Supabase planned)
- See `docs/` for detailed documentation

## Documentation

When reviewing or making changes:

- If a new component, hook, node type, or data type is added → update relevant doc in `docs/`
- If a public function/hook signature changes → verify JSDoc is updated
- If species, statuses, platforms, or edge types change → update `docs/graph-model.md`
- If architecture or data flow changes → update `docs/architecture.md`

## Conventions

- State: local hooks (`useNodes`, `useEdges`, `useProject`, `useProjects`, `useGraphNavigation`) — no global store
- Styling: Tailwind + shadcn/ui + class-variance-authority
- Config: typed const arrays in `lib/config/` — add new taxonomies there
- Data: all mutations go through `DataProvider` interface in `lib/data/`

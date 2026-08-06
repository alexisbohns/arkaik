# Project Guidelines

## Framework Warning

This project uses Next.js 16 with breaking changes. Read `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

## Architecture

- Product graph browser built with React Flow on Next.js App Router
- 6-species model (`flow`, `view`, `data-model`, `api-endpoint`, `acceptance`, `decision`) with playlist-driven flow expansion. `docs/graph-model.md` is the taxonomy's source of truth — read it rather than assuming a species set, and note the decision-only edge types (`supersedes`, `generates`, `impacts`)
- Project shell routes: `/project/[id]` redirects to `overview`; the shell carries `overview`, `maps` + `maps/[mapId]`, `library`, `delivery`, `acceptances`, `decisions`, `pyramid`, `changelog`, `history`, `settings`. `canvas` is a redirect to `maps/journey`, kept so old links work. Full tree in `docs/architecture.md`
- Canonical data model lives in `packages/schema` (`@arkaik/schema`); `lib/data/types.ts` re-exports it. After schema changes run `npm run generate` (artifacts are drift-checked in CI)
- All data goes through the `DataProvider` seam (`getProvider()`, `lib/data/provider-registry.ts`), whose default is a **routing** provider over three backends chosen by project id: `local-provider.ts` (IndexedDB via Dexie — local-first, the default for a project), `remote-provider.ts` (`prj_`-prefixed hosted projects over `app/api/graph/**`, where the server is the system of record), and `seed-provider.ts` (the in-memory public self-map). Publik and Synk remain share/backup rather than providers — and there is no Supabase anywhere
- See `docs/` for detailed documentation; product direction in `docs/vision.md` § Core Product

## Documentation

When reviewing or making changes:

- If a new component, hook, node type, or data type is added → update relevant doc in `docs/`
- If a public function/hook signature changes → verify JSDoc is updated
- If species, statuses, platforms, or edge types change → update `docs/graph-model.md`
- If architecture or data flow changes → update `docs/architecture.md`

## Conventions

- State: local hooks (`useNodes`, `useEdges`, `useProject`, `useProjects`, `useJournal`) — no global store
- Styling: Tailwind + shadcn/ui + class-variance-authority
- Config: taxonomy **ids** live in `@arkaik/schema` (`packages/schema/src/ids.ts`); `lib/config/` holds the labels and display order, validated against those ids with `as const satisfies`. A new taxonomy value needs both files, then `npm run generate`
- Data: all mutations go through `DataProvider` interface in `lib/data/`

## Validation Rules (LLM / Coding Agent)

- Before considering any code change complete, always run `npm run lint`.
- Before considering any code change complete, always run `npx next build`.
- After touching `packages/schema`, the agent skill, the plugin, or the wobble registry, run `npm run generate` — CI fails the PR on any drift in the generated artifacts, and the generator is the only way to close it.
- If any of these fails, fix regressions before finalizing.

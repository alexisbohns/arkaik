# Vision

> This document describes long-term direction while staying aligned with the current architecture.
> Source of truth for implemented behavior: [architecture.md](architecture.md), [graph-model.md](graph-model.md), and [data-layer.md](data-layer.md).

## Problem Statement

Product knowledge is usually fragmented across planning docs, design files, API specs, and database tools. Teams lose time reconstructing dependencies between user-facing behavior, backend calls, and data storage.

arkaik targets that gap with one navigable graph.

## Product Direction

arkaik is a local-first graph workspace for mapping how product behavior is built and reused.

The current model centers on four species:

- `flow`: ordered sequence container
- `view`: reusable screen/page node
- `data-model`: data entity node
- `api-endpoint`: API contract node

Flow behavior is playlist-driven (`metadata.playlist.entries`) and anchored by optional `project.root_node_id`.

## UX Direction

### Playlist-Centric Exploration

- Expand flows in place to reveal ordered playlist entries.
- Support branching directly inside playlists via `condition` and `junction` entries.
- Keep rendering readable with alternating drill layout and top-level accordion expansion.

Implementation references: [app/project/[id]/canvas/page.tsx](../app/project/[id]/canvas/page.tsx), [lib/utils/elk-layout.ts](../lib/utils/elk-layout.ts)

### Reuse-First Authoring

- Enable many-to-many reuse of `view` and `flow` nodes across playlists.
- Make reverse references visible in where-used UI.
- Support insert-between and search-or-create flows directly from composition edges.

Implementation references: [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx), [components/panels/InsertBetweenDialog.tsx](../components/panels/InsertBetweenDialog.tsx), [lib/utils/where-used.ts](../lib/utils/where-used.ts)

### Two Complementary Workspaces

- **Canvas route** for spatial graph editing and sequence expansion.
- **Library route** for high-density browsing, filtering, and metadata audits.
- **Sidebar shell** for stable in-project navigation between both modes.

Implementation references: [app/project/[id]/canvas/page.tsx](../app/project/[id]/canvas/page.tsx), [app/project/[id]/library/page.tsx](../app/project/[id]/library/page.tsx), [components/layout/ProjectSidebar.tsx](../components/layout/ProjectSidebar.tsx)

## Platform And Status Direction

- Keep per-platform status editing on `view` nodes.
- Keep `flow` status as computed rollup from descendant views.
- Continue exposing lifecycle state as a first-class visual signal in cards, panels, and table rows.

Config sources: [lib/config/platforms.ts](../lib/config/platforms.ts), [lib/config/statuses.ts](../lib/config/statuses.ts)

## Data And Backend Direction

- Preserve the `DataProvider` abstraction to keep UI/hooks backend-agnostic.
- Continue local-first operation with import/export.
- Migrate to Supabase provider without changing UI contracts.

Implementation references: [lib/data/data-provider.ts](../lib/data/data-provider.ts), [lib/data/local-provider.ts](../lib/data/local-provider.ts), [lib/utils/export.ts](../lib/utils/export.ts)

## Roadmap Themes

| Horizon | Theme |
|---|---|
| Current | Playlist modeling, reusable nodes, route shell, library workflows |
| Near-term | Better collaboration primitives and stronger validation tooling |
| Mid-term | Supabase-backed provider parity with local-first behavior |
| Long-term | Multi-user graph operations, branch-aware review workflows, and richer analytics |

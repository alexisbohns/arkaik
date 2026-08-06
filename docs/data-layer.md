# Data Layer

## Data Types

Canonically defined in `packages/schema/src/` (`@arkaik/schema`) and re-exported through `lib/data/types.ts`:

### Node

```typescript
interface Node {
  id: string;
  project_id: string;
  species: SpeciesId;
  title: string;
  description?: string;
  status: StatusId;
  platforms: PlatformId[];
  metadata?: NodeMetadata;
}
```

### NodeMetadata

Declared in [`packages/schema/src/bundle.ts`](../packages/schema/src/bundle.ts) (`NodeMetadata`). Most fields are species-scoped: the type is one open bag rather than a union, so a field's *audience* column matters as much as its type.

| Field | Type | Audience | Purpose |
|-------|------|----------|---------|
| `stage` | `string` | any | Optional lifecycle marker used by node headers (`beta` / `monitoring` / `deprecated`) |
| `blocked_by` | `string` | any | Non-empty = the node is blocked at its current status. A node id (rendered as a link) or free text |
| `playlist` | `FlowPlaylist` | flow | Ordered playlist structure for flow sequencing with support for inline branching |
| `platformNotes` | `Partial<Record<PlatformId, string>>` | any | Per-platform notes in the detail panel |
| `platformStatuses` | `Partial<Record<PlatformId, StatusId>>` | view, acceptance | Per-platform source-of-truth statuses |
| `platformScreenshots` | `Partial<Record<PlatformId, string>>` | view | Per-platform screenshot asset values (path, URL, or data URI — [spec/bundle-format.md](spec/bundle-format.md) § Asset Values) |
| `refs` | `Ref[]` | any | Typed external references ([spec/bundle-format.md](spec/bundle-format.md) § References) |
| `gherkin` | `string` | acceptance | Exactly one Given/When/Then scenario — the How. A second scenario is a second acceptance node |
| `values` | `ValueId[]` | acceptance | Bain value elements served — the Why |
| `product` | `string` | flow, view, acceptance | Product membership, keyed to a `ProjectMetadata.products` entry |
| `decision_status` | `DecisionStatusId` | decision | The decision's own status (`proposed` … `superseded`) — **not** a lifecycle status |
| `context` | `string` | decision | Context — the Why (markdown) |
| `consequences` | `string` | decision | Consequences — the How (markdown) |
| `decided_at` | `string` | decision | ISO 8601 date the decision was actually made. Backfill-friendly: `node.created` events carry the write date, not this |

Unknown metadata keys are preserved (`catchall`) — the forward-compatibility rule of the format.

`FlowPlaylist` structure:

```typescript
type PlaylistEntry =
  | { type: "view"; view_id: string }
  | { type: "flow"; flow_id: string }
  | { type: "condition"; label: string; if_true: PlaylistEntry[]; if_false: PlaylistEntry[] }
  | { type: "junction"; label: string; cases: JunctionCase[] };

interface JunctionCase {
  label: string;
  entries: PlaylistEntry[];
}

interface FlowPlaylist {
  entries: PlaylistEntry[];
}
```

### Edge

```typescript
interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
  metadata?: Record<string, unknown>;
}
```

### Project

```typescript
interface Project {
  id: string;
  title: string;
  description?: string;
  version?: string;    // Current version label of the mapped product (Level 1)
  root_node_id?: string; // Optional node id used as the canvas anchor
  metadata?: ProjectMetadata; // Optional project-level UI preferences
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  archived_at?: string | null; // ISO 8601 when archived
}

interface ProjectMetadata extends Record<string, unknown> {
  view_card_variant?: "compact" | "large"; // Deprecated; superseded by map_display, no longer read
  maps?: MapDefinition[]; // Stored map definitions (spec/maps.md § Storage)
  map_display?: Record<string, MapDisplayOptions>; // Per-map card rendering, keyed by map id
  products?: ProductDefinition[]; // Product definitions (spec/bundle-format.md § Products)
}
```

`ProjectMetadata` is a `catchall` too, and one spec'd key rides through it rather than being typed: `ref_policy`, the opt-in ref → status promotion map read by `computeRefPromotions` ([spec/bundle-format.md](spec/bundle-format.md) § References). Absent it, nothing is promoted.

### ProjectBundle

```typescript
interface ProjectBundle {
  schema_version?: number;   // Absent means 1 (spec/bundle-format.md)
  project: Project;
  nodes: Node[];
  edges: Edge[];
  journal?: JournalEvent[];  // Level 2 embedded interchange projection (spec/journal.md)
}
```

A `ProjectBundle` is the unit of storage and export — one project with all its nodes and edges.

`project.root_node_id` (when present) points to the node the Journey map anchors on ([lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts)); a scoped map's own `root_node_id` overrides it. If it is missing, the canvas falls back to inferred roots (nodes without compose parents).

## DataProvider Interface

Declared in [lib/data/data-provider.ts](../lib/data/data-provider.ts) — **read the signatures there.** All data access goes through it. What follows is a map of the surface plus the reasoning behind the three shapes that surprise people; deliberately not a transcription, because the interface has been redesigned once already and a second copy of the signatures is exactly the thing that rots.

| Group | Methods |
|---|---|
| Projects | `getProject(id)` · `listProjects()` · `saveProject(bundle)` · `archiveProject(id)` |
| Reads | `getNodes(projectId)` · `getEdges(projectId)` · `getJournal(projectId)` |
| Node writes | `createNode(node)` · `updateNode(projectId, id, patch)` · `deleteNode(projectId, id)` · `deleteNodes(projectId, ids)` |
| Edge writes | `createEdge(edge)` · `deleteEdge(projectId, id)` |
| Batch write | `applyMutations(projectId, ops)` |
| Import / export | `exportProject(id)` · `importProject(bundle)` |

- **`listProjects()` returns `ProjectSummary[]`, not bundles.** A summary is `{ project, nodeCount, edgeCount, hosted, seed? }`. It used to return full `ProjectBundle`s, which meant the projects page read every node, edge and journal event of every project just to render titles and counts — merely wasteful against IndexedDB, untenable against a server.
- **Every mutator takes `projectId` explicitly**, including the ones whose subject id would seem to be enough. The local provider can get away without it by scanning IndexedDB for the project holding a node id; a remote provider cannot scan, and the routing provider below could not even tell which backend to ask. It is free at the call sites — the hooks are already built as `useNodes(projectId)`.
- **`applyMutations(projectId, ops)` is the atomic batch**: all ops commit, or none do. The single-op methods cannot express "create this node *and* this edge together", which forces callers into a create-then-create sequence with a hand-rolled rollback when the second half fails. The local provider runs one IndexedDB transaction; the remote provider sends one request. `MutationOp` comes from `@arkaik/schema`.

`archiveProject` performs a soft delete. Archived projects remain in storage but are excluded by default from `listProjects()`.

## Providers

`getProvider()` ([lib/data/provider-registry.ts](../lib/data/provider-registry.ts)) is the one seam every hook and component reads through; `setProvider()` swaps it (tests, and the read-only repo-bundle viewer of [rfcs/arkaik-dev.md](rfcs/arkaik-dev.md)). Its default is **not** the local provider alone but a router over three implementations of the same interface:

| Provider | Backs | Routing rule |
|---|---|---|
| `local-provider.ts` | IndexedDB via Dexie — local-first projects, the default for anything you create in the browser | every id that is neither of the two below |
| `remote-provider.ts` | The hosted graph API (`app/api/graph/**`), where the **server** is the system of record | id carries the server-minted `prj_` prefix |
| `seed-provider.ts` | Per-tab memory, initialized from `seed/arkaik-self-map.json` — the built-in public self-map sandbox, where a refresh *is* the reset | the single reserved id `arkaik-self-map` |

The routing rule is the id namespace, not a cache ([lib/data/routing-provider.ts](../lib/data/routing-provider.ts)): hosted ids are minted server-side and the import path refuses to give a local project one, so routing is a total function of the id with nothing to populate, invalidate, or get wrong offline. `listProjects()` is the one call that spans all three — it always leads with the seed, adds the account's hosted projects when `/api/auth/status` says there is an account, and degrades to the local list rather than blanking the page if that request fails.

Signed out, or with services unconfigured, nothing reaches the network and the app behaves exactly as it did before hosted projects existed.

## Local Provider

Implemented in `lib/data/local-provider.ts`.

- **Backend:** IndexedDB via Dexie (`lib/data/db.ts`, database `arkaik`) — three tables: `projects` (one row per project: the bundle snapshot minus its journal), `journals` (per-project event arrays), `meta` (bookkeeping)
- **Writes:** Row-level per project — a mutation to project A rewrites only A's row
- **Dual-write:** Every graph mutation patches the snapshot *and* appends the derived journal events (`lib/data/emit-events.ts`, actor `arkaik-app`) in the same Dexie transaction; `saveProject`/`importProject`/`archiveProject` deliberately do not emit
- **Notifications:** `subscribeToMutations(cb)` fires per affected project after the transaction commits (consumed by the Synk `SyncManager`)
- **Cascade:** `deleteNode` also removes all edges referencing that node (no separate `edge.removed` events — implied by `node.deleted`)
- **Legacy migration:** on first open, any old `arkaik:store` `localStorage` payload is imported once (running `migrateBundle` per bundle) and kept as a passive backup
- **Normalization:** legacy structural fields are stripped and playlists hydrated via the explicit migration chain in `lib/data/migrate.ts` (`schema_version`-aware)

## Import / Export

Utilities in `lib/utils/export.ts`:

- `exportToJson(bundle)` — Serializes a `ProjectBundle` to formatted JSON
- `downloadJson(bundle)` — Triggers browser download as `{project-title-slug}-{projectId}.json` and returns export diagnostics (`filename`, `bytes`, `warning`)
- `exportProject(id)` / `importProject(bundle)` — Delegate to `getProvider()`, so they follow the same routing as every other call
- `importProjectFromFile(file)` — Parses and validates JSON file content, normalizes timestamps, and imports via provider

`downloadJson(bundle)` applies a soft warning when the serialized bundle is larger than 4 MB. The warning is intended for UX guidance only and does not block download.

When importing, if the incoming project ID already exists locally, a new project ID is generated and all `project_id` references in nodes and edges are rewritten to the new ID before saving.

When importing JSON, `project.root_node_id` is optional. If provided, it must reference an existing node ID in `nodes` or the import fails validation.

### Public Schema Contract

Arkaik now publishes a machine-readable schema and example bundle for import/export alignment and LLM prompt tooling:

| Asset | Path | Purpose |
|---|---|---|
| ProjectBundle schema | `public/schema/project-bundle.json` | Canonical JSON Schema for the bundle format |
| Example bundle | `public/schema/example-bundle.json` | Complete, valid reference example |

These assets are generated from the canonical zod source in `packages/schema` (`npm run generate`, drift-checked in CI) and help external tooling generate importable bundles.

## Hooks

Hooks in `lib/hooks/` provide React state wrappers around the provider:

| Hook | Returns | Purpose |
|------|---------|---------|
| `useProject(id)` | `{ project, loading, error, updateProject }` | Load and update project-level metadata/settings |
| `useProjects()` | `{ projects, loading, error }` | The active `ProjectSummary[]` for shell navigation |
| `useNodes(projectId)` | `{ nodes, loading, error, addNode, removeNode, removeNodes, updateNode, applyMutations }` | CRUD for nodes, plus the atomic batch |
| `useEdges(projectId)` | `{ edges, loading, error, addEdge, removeEdge, syncEdges }` | CRUD for edges |
| `useJournal(projectId)` | `{ journal, loading, error }` | Read-only journal events for timelines and the changelog |

The Journey map (`components/maps/JourneyMap.tsx`) uses `useProject` for root-node anchoring and project-level card-style preferences, and still manages `expandedFlows` as local state.

### Node Editing Flow

The `NodeDetailPanel` is the primary UI for editing nodes. The mutation path:

```
NodeDetailPanel (title, description, platforms, metadata)
  → useNodes.updateNode(id, patch)
    → getProvider().updateNode(projectId, id, patch)
      → local: IndexedDB (Dexie) | remote: POST /api/graph/projects/{id}/mutations | seed: per-tab memory
```

The hook closes over the `projectId` it was constructed with, which is why the UI never passes one and the provider always gets one.

Views store editable per-platform statuses in `node.metadata.platformStatuses`. When legacy data does not have that field yet, the UI derives platform statuses from `node.status` + `node.platforms` and writes the richer metadata shape back on the next edit.

Flows do not expose an editable rollup status in UI. Flow cards and panel gauges compute status from descendant views in [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts) and [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx).
 
 Flow playlist edits (`metadata.playlist.entries`) also originate from `NodeDetailPanel` via [components/panels/PlaylistEditor.tsx](../components/panels/PlaylistEditor.tsx). All playlist mutations use `useNodes.updateNode`, and provider-side validation blocks circular flow references before persistence.

## What the seam bought

The `DataProvider` interface abstracts storage so the backend can change without touching hooks or UI. That has now been cashed in twice:

1. **The local provider moved from `localStorage` to IndexedDB** (Dexie — `lib/data/db.ts`) with the `localProvider` export name kept, so hooks and UI were unchanged.
2. **A second backend arrived and the app did not notice.** `remote-provider.ts` is a `DataProvider` over the hosted graph API, and `routing-provider.ts` dispatches to it by id; a third, `seed-provider.ts`, backs the public self-map from memory. No hook or component knows which one answered.

**Where the source of truth lives depends on the project, and this is a deliberate crossing.** For a local-first project the browser is still the system of record, and Publik and Synk remain what they always were — share and one-way backup, not providers ([spec/services.md](spec/services.md)). For a **hosted** project the *server* is the system of record: it applies mutations under a row lock and the GitHub App promotes acceptance statuses from pull-request events with no browser involved. That reverses boundary 1 of the services spec, and the spec says so explicitly rather than quietly — read the decision record in [spec/services.md](spec/services.md) § "Boundary 1 no longer holds for hosted projects" before designing anything on top of it, including its stated cost: hosted projects do not work offline, local-first ones still do and remain the default.

Every server-side mutation still passes the same `validateBundle` the CLI and MCP server use, in the same transaction, and is refused whole on any error; a hosted project can be exported and re-imported as a local one at any time.

Storage layout (local provider): a `projects` table keyed by `id` holds one row per project (the bundle snapshot minus its journal), so a mutation to project A rewrites only project A's row — not the whole store as the previous `localStorage` backend did. The embedded journal lives in its own `journals` table (keyed by `projectId`), leaving room for a future app-side journal append that need not rewrite the graph snapshot. On first load, any legacy `arkaik:store` `localStorage` payload is imported once into IndexedDB (running `migrateBundle` per bundle) and the source payload is kept as a passive backup.

To add a new provider: implement the `DataProvider` interface and inject it via `setProvider()` (`lib/data/provider-registry.ts`) — the seam every hook already reads through.

## Seed Data

`seed/pebbles.json` contains an example project ("Pebbles") exercising all six species, persisted compose edges for structure, and playlist-driven flow ordering. `seed/arkaik-self-map.json` is Arkaik's own map, served read-write-in-memory as the built-in public project by `seed-provider.ts`. Both are validated in CI (`npm run validate:seeds`).

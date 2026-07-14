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

| Field | Type | Purpose |
|-------|------|---------|
| `stage` | `string` | Optional lifecycle marker used by node headers (`beta` / `monitoring` / `deprecated`) |
| `playlist` | `FlowPlaylist` | Ordered playlist structure for flow sequencing with support for inline branching |
| `platformNotes` | `Partial<Record<PlatformId, string>>` | Per-platform notes in the detail panel |
| `platformStatuses` | `Partial<Record<PlatformId, StatusId>>` | Per-platform source-of-truth statuses for views |
| `platformScreenshots` | `Partial<Record<PlatformId, string>>` | Per-platform screenshot asset values (path, URL, or data URI — [spec/bundle-format.md](spec/bundle-format.md) § Asset Values) |
| `refs` | `Ref[]` | Typed external references ([spec/bundle-format.md](spec/bundle-format.md) § References) |

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
  view_card_variant?: "compact" | "large";
  maps?: MapDefinition[]; // Stored map definitions (spec/maps.md § Storage)
}
```

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

Defined in `lib/data/data-provider.ts`. All data access goes through this interface:

```typescript
interface DataProvider {
  // Projects
  getProject(id: string): Promise<ProjectBundle | undefined>;
  listProjects(): Promise<ProjectBundle[]>;
  saveProject(bundle: ProjectBundle): Promise<void>;
  archiveProject(id: string): Promise<void>;

  // Nodes
  getNodes(projectId: string): Promise<Node[]>;
  createNode(node: Node): Promise<Node>;
  updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>): Promise<Node>;
  deleteNode(id: string): Promise<void>;
  deleteNodes(ids: string[]): Promise<void>;

  // Edges
  getEdges(projectId: string): Promise<Edge[]>;
  createEdge(edge: Edge): Promise<Edge>;
  deleteEdge(id: string): Promise<void>;

  // Journal
  getJournal(projectId: string): Promise<JournalEvent[]>;

  // Import/Export
  exportProject(id: string): Promise<ProjectBundle>;
  importProject(bundle: ProjectBundle): Promise<Project>;
}
```

`archiveProject` performs a soft delete. Archived projects remain in storage but are excluded by default from `listProjects()`.

## Local Provider

Implemented in `lib/data/local-provider.ts`, resolved through the provider seam `lib/data/provider-registry.ts` (`getProvider()` / `setProvider()`).

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
- `exportProject(id)` / `importProject(bundle)` — Delegate to `localProvider`
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
| `useProject(id)` | `{ project, loading, updateProject }` | Load and update project-level metadata/settings |
| `useProjects()` | `{ projects, loading }` | Load the active project list for shell navigation |
| `useNodes(projectId)` | `{ nodes, loading, addNode, removeNode, removeNodes, updateNode }` | CRUD for nodes |
| `useEdges(projectId)` | `{ edges, loading, addEdge, removeEdge }` | CRUD for edges |
| `useJournal(projectId)` | `{ journal, loading }` | Read-only journal events for timelines and the changelog |

The Journey map (`components/maps/JourneyMap.tsx`) uses `useProject` for root-node anchoring and project-level card-style preferences, and still manages `expandedFlows` as local state.

### Node Editing Flow

The `NodeDetailPanel` is the primary UI for editing nodes. The mutation path:

```
NodeDetailPanel (title, description, platforms, metadata)
  → useNodes.updateNode(id, patch)
    → localProvider.updateNode(id, patch)
      → IndexedDB (Dexie)
```

Views store editable per-platform statuses in `node.metadata.platformStatuses`. When legacy data does not have that field yet, the UI derives platform statuses from `node.status` + `node.platforms` and writes the richer metadata shape back on the next edit.

Flows do not expose an editable rollup status in UI. Flow cards and panel gauges compute status from descendant views in [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts) and [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx).
 
 Flow playlist edits (`metadata.playlist.entries`) also originate from `NodeDetailPanel` via [components/panels/PlaylistEditor.tsx](../components/panels/PlaylistEditor.tsx). All playlist mutations use `useNodes.updateNode`, and provider-side validation blocks circular flow references before persistence.

## Migration Path

The `DataProvider` interface abstracts storage so the backend can change without touching hooks or UI:

1. **Current:** IndexedDB via `localProvider` (Dexie — `lib/data/db.ts`). The `localProvider` export name is kept; it is repointed at the IndexedDB implementation, so the hooks and UI are unchanged.
2. **Hosted services** are *not* providers: Publik shares snapshots and Synk backs them up one-way ([spec/services.md](spec/services.md)); the browser stays the source of truth. (The old "Supabase provider" plan is superseded — see the backend decision record in [spec/services.md](spec/services.md).)
3. **Future second provider:** the read-only repo-bundle provider contemplated by [rfcs/arkaik-dev.md](rfcs/arkaik-dev.md), injected through `setProvider()`.

Storage layout: a `projects` table keyed by `id` holds one row per project (the bundle snapshot minus its journal), so a mutation to project A rewrites only project A's row — not the whole store as the previous `localStorage` backend did. The embedded journal lives in its own `journals` table (keyed by `projectId`), leaving room for a future app-side journal append that need not rewrite the graph snapshot. On first load, any legacy `arkaik:store` `localStorage` payload is imported once into IndexedDB (running `migrateBundle` per bundle) and the source payload is kept as a passive backup.

To add a new provider: implement the `DataProvider` interface and inject it via `setProvider()` (`lib/data/provider-registry.ts`) — the seam every hook already reads through.

## Seed Data

`seed/pebbles.json` contains an example project ("Pebbles") demonstrating the 4-species model, persisted compose edges for structure, and playlist-driven flow ordering.

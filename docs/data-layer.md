# Data Layer

## Data Types

Defined in `lib/data/types.ts`:

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

Defined in `lib/data/types.ts`:

| Field | Type | Purpose |
|-------|------|---------|
| `stage` | `string` | Optional lifecycle marker used by node headers |
| `playlist` | `FlowPlaylist` | Ordered playlist structure for flow sequencing with support for inline branching |
| `platformNotes` | `Partial<Record<PlatformId, string>>` | Per-platform notes in the detail panel |
| `platformStatuses` | `Partial<Record<PlatformId, StatusId>>` | Per-platform source-of-truth statuses for views |

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
  root_node_id?: string; // Optional node id used as the canvas anchor
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  archived_at?: string | null; // ISO 8601 when archived
}
```

### ProjectBundle

```typescript
interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}
```

A `ProjectBundle` is the unit of storage and export — one project with all its nodes and edges.

`project.root_node_id` (when present) points to the node that should render as the primary canvas anchor in [app/project/[id]/page.tsx](../app/project/[id]/page.tsx). If it is missing, the canvas falls back to inferred roots (nodes without compose parents).

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

  // Edges
  getEdges(projectId: string): Promise<Edge[]>;
  createEdge(edge: Edge): Promise<Edge>;
  deleteEdge(id: string): Promise<void>;

  // Import/Export
  exportProject(id: string): Promise<ProjectBundle>;
  importProject(bundle: ProjectBundle): Promise<Project>;
}
```

`archiveProject` performs a soft delete. Archived projects remain in storage but are excluded by default from `listProjects()`.

## Local Provider

Implemented in `lib/data/local-provider.ts`.

- **Storage key:** `arkaik:store`
- **Backend:** `localStorage` with an in-memory `Map<string, ProjectBundle>`
- **Indexing:** Dual index maps — `nodeIndex` (node ID → project ID) and `edgeIndex` (edge ID → project ID) for fast lookups
- **Persistence:** Auto-persists to `localStorage` on every mutation
- **Cascade:** `deleteNode` also removes all edges referencing that node
- **Normalization:** Legacy node fields (`parent_id`, `sort_order`, `position_x`, `position_y`) are stripped on load/import, and ordered `metadata.playlist.entries` values are hydrated from legacy data when present

## Import / Export

Utilities in `lib/utils/export.ts`:

- `exportToJson(bundle)` — Serializes a `ProjectBundle` to formatted JSON
- `downloadJson(bundle)` — Triggers browser download as `{project-title-slug}-{projectId}.json` and returns export diagnostics (`filename`, `bytes`, `warning`)
- `exportProject(id)` / `importProject(bundle)` — Delegate to `localProvider`
- `importProjectFromFile(file)` — Parses and validates JSON file content, normalizes timestamps, and imports via provider

`downloadJson(bundle)` applies a soft warning when the serialized bundle is larger than 4 MB. The warning is intended for UX guidance only and does not block download.

When importing, if the incoming project ID already exists locally, a new project ID is generated and all `project_id` references in nodes and edges are rewritten to the new ID before saving.

When importing JSON, `project.root_node_id` is optional. If provided, it must reference an existing node ID in `nodes` or the import fails validation.

## Hooks

Hooks in `lib/hooks/` provide React state wrappers around the provider:

| Hook | Returns | Purpose |
|------|---------|---------|
| `useProject(id)` | `{ project, loading }` | Load a full `ProjectBundle` |
| `useNodes(projectId)` | `{ nodes, loading, addNode, removeNode, updateNode }` | CRUD for nodes |
| `useEdges(projectId)` | `{ edges, loading, addEdge, removeEdge }` | CRUD for edges |
| `useGraphNavigation()` | `{ expandedNodeIds, zoomLevel, breadcrumbs, expand, collapse, navigateTo }` | Generic semantic zoom state |

> **Note:** The project canvas page (`app/project/[id]/page.tsx`) uses `useNodes` and `useEdges` directly but does **not** use `useProject` or `useGraphNavigation`. It currently manages an `expandedFlows` set as local state.

### Node Editing Flow

The `NodeDetailPanel` is the primary UI for editing nodes. The mutation path:

```
NodeDetailPanel (title, description, platforms, metadata)
  → useNodes.updateNode(id, patch)
    → localProvider.updateNode(id, patch)
      → localStorage
```

Views store editable per-platform statuses in `node.metadata.platformStatuses`. When legacy data does not have that field yet, the UI derives platform statuses from `node.status` + `node.platforms` and writes the richer metadata shape back on the next edit.

Flows do not expose an editable rollup status in UI. Flow cards and panel gauges compute status from descendant views in [app/project/[id]/page.tsx](../app/project/[id]/page.tsx) and [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx).
 
 Flow playlist edits (`metadata.playlist.entries`) also originate from `NodeDetailPanel` via [components/panels/PlaylistEditor.tsx](../components/panels/PlaylistEditor.tsx). All playlist mutations use `useNodes.updateNode`, and provider-side validation blocks circular flow references before persistence.

## Migration Path

The `DataProvider` interface abstracts storage so the backend can change without touching hooks or UI:

1. **Current:** `localStorage` via `localProvider`
2. **Planned:** Supabase (auth, RLS, realtime sync)

To add a new provider: implement the `DataProvider` interface and swap the import in the hooks.

## Seed Data

`seed/pebbles.json` contains an example project ("Pebbles") demonstrating the 4-species model, persisted compose edges for structure, and playlist-driven flow ordering.

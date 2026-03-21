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
  parent_id?: string | null;
  sort_order?: number;          // Sibling ordering within a parent (0-based)
  position_x: number;
  position_y: number;
  metadata?: Record<string, unknown>;
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

## Import / Export

Utilities in `lib/utils/export.ts`:

- `exportToJson(bundle)` — Serializes a `ProjectBundle` to formatted JSON
- `downloadJson(bundle)` — Triggers browser download as `{projectId}.json`
- `exportProject(id)` / `importProject(bundle)` — Delegate to `localProvider`
- `importProjectFromFile(file)` — Parses and validates JSON file content, normalizes timestamps, and imports via provider

When importing, if the incoming project ID already exists locally, a new project ID is generated and all `project_id` references in nodes and edges are rewritten to the new ID before saving.

## Hooks

Hooks in `lib/hooks/` provide React state wrappers around the provider:

| Hook | Returns | Purpose |
|------|---------|---------|
| `useProject(id)` | `{ project, loading }` | Load a full `ProjectBundle` |
| `useNodes(projectId)` | `{ nodes, loading, addNode, removeNode, updateNode }` | CRUD for nodes |
| `useEdges(projectId)` | `{ edges, loading, addEdge, removeEdge }` | CRUD for edges |
| `useGraphNavigation()` | `{ expandedNodeIds, zoomLevel, breadcrumbs, expand, collapse, navigateTo }` | Generic semantic zoom state |

> **Note:** The project canvas page (`app/project/[id]/page.tsx`) uses `useNodes` and `useEdges` directly but does **not** use `useProject` or `useGraphNavigation`. It manages expansion sets (`expandedProducts`, `expandedScenarios`, `expandedFlows`) and breadcrumbs as local `useState` — the granularity required three separate sets rather than the single `expandedNodeIds` set in `useGraphNavigation`.

### Node Editing Flow

The `NodeDetailPanel` is the primary UI for editing nodes. The mutation path:

```
NodeDetailPanel (title, status, platforms, description, metadata)
  → useNodes.updateNode(id, patch)
    → localProvider.updateNode(id, patch)
      → localStorage
```

Platform variant notes are stored in `node.metadata.platformNotes` as `Partial<Record<PlatformId, string>>`.

## Migration Path

The `DataProvider` interface abstracts storage so the backend can change without touching hooks or UI:

1. **Current:** `localStorage` via `localProvider`
2. **Planned:** Supabase (auth, RLS, realtime sync)

To add a new provider: implement the `DataProvider` interface and swap the import in the hooks.

## Seed Data

`seed/pebbles.json` contains an example project ("Pebbles") demonstrating the data shape with products, scenarios, flows, views, conditions, and all edge types.

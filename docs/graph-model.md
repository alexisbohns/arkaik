# Graph Model

The graph is built from nodes and edges with structure driven by persisted relationships.

## Species

Current taxonomy has exactly 4 species.

| Level | Species | Role | React Flow node type |
|---|---|---|---|
| 1 | `flow` | Ordered sequence container | `flow` |
| 0 | `view` | Reusable page/screen | `view` |
| — | `data-model` | Data entity/table | `dataModel` |
| — | `api-endpoint` | API endpoint | `apiEndpoint` |

Config source: [lib/config/species.ts](../lib/config/species.ts)

## Composition Model

### Parent/Child Links

- Persisted parent/child links are `composes` edges.
- Child ordering is read from `node.metadata.playlist.entries`.
- When playlist entries do not reference all compose-edge children, missing children are appended after playlist-derived ordering.
- Root anchoring uses `project.root_node_id` when present; otherwise the canvas infers roots from nodes without compose parents.

Source: [app/project/[id]/page.tsx](../app/project/[id]/page.tsx)

### Flow Children

All flows start collapsed. Any visible flow can be expanded in-canvas. Top-level expansion (root flow and/or direct flow children of `project.root_node_id`, or inferred root flows when no explicit root exists) is accordion-style: opening one top-level flow collapses any other top-level flow already open. Expanded flows render only `flow` and `view` children as in-canvas children.

Source: [app/project/[id]/page.tsx](../app/project/[id]/page.tsx)

### Playlist Entry Types

`flow` nodes store ordered playlist data in `node.metadata.playlist.entries`.

| Entry Type | Required Fields | Notes |
|---|---|---|
| `view` | `view_id` | Reference to an existing view node |
| `flow` | `flow_id` | Reference to an existing flow node (cycle-checked before persist) |
| `condition` | `label`, `if_true`, `if_false` | Two branch lists, each a recursive `PlaylistEntry[]` |
| `junction` | `label`, `cases[]` | Each case has `label` + `entries: PlaylistEntry[]` |

Editing source: [components/panels/PlaylistEditor.tsx](../components/panels/PlaylistEditor.tsx), [components/panels/PlaylistEntryRow.tsx](../components/panels/PlaylistEntryRow.tsx)

Type source: [lib/data/types.ts](../lib/data/types.ts)

## Status Model

Statuses are configured in:

- [lib/config/statuses.ts](../lib/config/statuses.ts)

Rollup behavior:

- `view` is the only species with editable per-platform status values (`metadata.platformStatuses`).
- `flow` status is computed for display by aggregating descendant views (including nested sub-flows).
- `data-model` and `api-endpoint` use single lifecycle status.

Sources:

- [lib/utils/platform-status.ts](../lib/utils/platform-status.ts)
- [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx)
- [app/project/[id]/page.tsx](../app/project/[id]/page.tsx)

## Platforms

Platforms are configured in:

- [lib/config/platforms.ts](../lib/config/platforms.ts)

Views can target one or more platforms; per-platform notes/statuses are stored in node metadata.

Source:

- [lib/data/types.ts](../lib/data/types.ts)

## Edge Types

| Edge Type | Use |
|---|---|
| `composes` | Composition hierarchy and ordered flow sequences |
| `calls` | View to API relationship |
| `displays` | View to data-model relationship |
| `queries` | API to data-model relationship |

Config source: [lib/config/edge-types.ts](../lib/config/edge-types.ts)

Rendering mapping source: [app/project/[id]/page.tsx](../app/project/[id]/page.tsx)

## Node And Edge Components

Node registration is in:

- [components/graph/Canvas.tsx](../components/graph/Canvas.tsx)

Current custom registrations:

- `flow` -> `FlowNode`
- `view` -> `ViewNode`
- `dataModel` -> `DataModelNode`
- `apiEndpoint` -> `ApiEndpointNode`

Edge registration is also in [components/graph/Canvas.tsx](../components/graph/Canvas.tsx).

## Taxonomy Update Checklist

1. Update config array in `lib/config/*`.
2. Update page mappings and rendering filters in [app/project/[id]/page.tsx](../app/project/[id]/page.tsx).
3. Update Canvas registrations in [components/graph/Canvas.tsx](../components/graph/Canvas.tsx).
4. Update forms/panels that branch by species.
5. Update seed data in [seed/pebbles.json](../seed/pebbles.json).
6. Update this document.

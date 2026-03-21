# Graph Model

The product graph is built from **nodes** (entities) connected by **edges** (relationships). Platform status now has two layers:

- Step-like species (`view`, `section`, `component`, `state`, `token`) store a status per selected platform in `node.metadata.platformStatuses`
- `flow` and `scenario` compute their platform status gauges from descendants instead of exposing an editable lifecycle status in the UI

## Species Hierarchy

8 levels forming a composition tree, plus 2 parallel layers:

| Level | Species | Description | Node Component |
|-------|---------|-------------|----------------|
| 7 | `product` | Top-level product | `ProductNode` — large circle, Package icon |
| 6 | `scenario` | Composed set of flows | `ScenarioNode` — rounded rect, chevron toggle |
| 5 | `flow` | Sequence of steps | `FlowNode` — rounded rect, violet accent |
| 4 | `view` | A page or screen | `StepNode` — platform-aware card stacking |
| 3 | `section` | Card grid, header bar | `StepNode` |
| 2 | `component` | Button, Card, Input | `StepNode` |
| 1 | `state` | button:hover, input:error | `StepNode` |
| 0 | `token` | Color, spacing, translation key | `StepNode` |
| — | `condition` | Branching logic in flows | `ConditionNode` — diamond shape, amber border |
| — | `data-model` | Database table / entity | `DataModelNode` — amber border, Database icon |
| — | `api-endpoint` | REST endpoint | `ApiEndpointNode` — teal border, Plug icon |

**Config source:** `lib/config/species.ts`

### Flow Children

Species that can appear inside an expanded flow:

- `view`, `component`, `section`, `state`, `token` → rendered as `StepNode`
- `condition` → rendered as `ConditionNode`

## Statuses

Lifecycle states defined in `lib/config/statuses.ts`:

| ID | Label | Order | Counted In Rollups | Visual Effect |
|----|-------|-------|--------------------|---------------|
| `idea` | Idea | 0 | No | Dashed border, 60% opacity |
| `backlog` | Backlog | 1 | No | Normal |
| `prioritized` | Prioritized | 2 | Yes | Normal |
| `development` | Development | 3 | Yes | Normal |
| `releasing` | Releasing | 4 | Yes | Normal |
| `live` | Live | 5 | Yes | Normal |
| `archived` | Archived | 6 | No | 60% opacity |
| `blocked` | Blocked | 7 | Yes | Normal |

**Config source:** `lib/config/statuses.ts`

### Rollup Preset

The current counted-status preset is `delivery`, defined in `lib/config/statuses.ts`.

- Included: `prioritized`, `development`, `releasing`, `live`, `blocked`
- Excluded: `idea`, `backlog`, `archived`

The preset is static for now but is structured to become user-configurable later.

## Platforms

First-class multi-platform support. Nodes can target any combination:

| ID | Label | Emoji | Dot Color | Border Color |
|----|-------|-------|-----------|--------------|
| `web` | Web | 🟢 | `bg-green-500` | `border-green-500` |
| `ios` | iOS | 🔵 | `bg-blue-500` | `border-blue-500` |
| `android` | Android | 🟣 | `bg-purple-500` | `border-purple-500` |

**Config source:** `lib/config/platforms.ts`

### Platform Status Rendering

The graph page (`app/project/[id]/page.tsx`) derives the presentation payload for node cards:

- `StepNode` renders one status row per active platform
- `FlowNode` renders one stacked gauge per platform from direct step-like children
- `ScenarioNode` renders one stacked gauge per platform by merging child flow rollups

Empty platforms render an inactive gauge instead of inventing a lifecycle state.

## Edge Types

| ID | Label | Visual | Use |
|----|-------|--------|-----|
| `composes` | Composes | Straight solid | Hierarchy: product→scenario→flow |
| `branches` | Branches | Bezier curve | Flow branching: step→condition→step |
| `calls` | Calls | Default (no custom component) | View → API endpoint |
| `displays` | Displays | Default (no custom component) | View → data model |
| `queries` | Queries | Default (no custom component) | API endpoint → data model |

**Config source:** `lib/config/edge-types.ts`

### Edge Components

| Component | Path Style | Mapped Edge Types |
|-----------|------------|-------------------|
| `ComposeEdge` | Straight | `composes` |
| `BranchEdge` | Bezier | `branches` |
| `CrossLayerEdge` | Dashed straight | Not yet registered in `Canvas.tsx` |
| *(React Flow default)* | Straight | `calls`, `displays`, `queries` |

The mapping from domain `edge_type` to React Flow edge type is in `app/project/[id]/page.tsx`:
- `composes` → `"compose"` → `ComposeEdge`
- `branches` → `"branch"` → `BranchEdge`
- All others → `undefined` → React Flow default edge

## Adding New Taxonomies

All taxonomies live in `lib/config/` as typed `const` arrays:

1. Add the new entry to the relevant array in `lib/config/`
2. The `SpeciesId`, `StatusId`, `PlatformId`, or `EdgeTypeId` type updates automatically via `typeof`
3. If adding a new species: create a node component in `components/graph/nodes/`, register it in `Canvas.tsx`, and add a mapping in `SPECIES_TO_NODE_TYPE` in `app/project/[id]/page.tsx`
4. If adding a new edge type: create an edge component in `components/graph/edges/`, register it in `Canvas.tsx`, and add a mapping in the edge-type-to-xy-type logic in `app/project/[id]/page.tsx`
5. Update this document

# Graph Model

The product graph is built from **nodes** (entities) connected by **edges** (relationships). Every node has a species, a status, and optional platform tags.

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

Lifecycle states for any node:

| ID | Label | Order | Badge Color | Visual Effect |
|----|-------|-------|-------------|---------------|
| `idea` | Idea | 0 | Gray | Dashed border, 60% opacity |
| `planned` | Planned | 1 | Blue | Normal |
| `in-development` | In Development | 2 | Orange | Normal |
| `live` | Live | 3 | Green | Normal |
| `deprecated` | Deprecated | 4 | Red | Normal |

**Config source:** `lib/config/statuses.ts`

## Platforms

First-class multi-platform support. Nodes can target any combination:

| ID | Label | Emoji | Dot Color | Border Color |
|----|-------|-------|-----------|--------------|
| `web` | Web | 🟢 | `bg-green-500` | `border-green-500` |
| `ios` | iOS | 🔵 | `bg-blue-500` | `border-blue-500` |
| `android` | Android | 🟣 | `bg-purple-500` | `border-purple-500` |

**Config source:** `lib/config/platforms.ts`

### Platform Split Rendering

When a flow is expanded, step-like nodes are checked for platform-split rendering in `app/project/[id]/page.tsx`:

- **All 3 platforms or 1 platform**: rendered as a single `StepNode`
- **2 platforms (proper subset)**: split into separate React Flow nodes, one per platform, each with a single-platform `platforms` array and ID `{nodeId}__{platformId}`

Within the `StepNode` component itself, platform count affects visual rendering:
- **All 3 platforms**: Stacked cards with opacity cascade
- **2 platforms**: Single card with platform dots
- **1 platform**: Single card with platform-colored border

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

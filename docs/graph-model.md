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

| ID | Label | Dot Color | Border Color |
|----|-------|-----------|--------------|
| `web` | Web | Green | `border-green-500` |
| `ios` | iOS | Blue | `border-blue-500` |
| `android` | Android | Purple | `border-purple-500` |

**Config source:** `lib/config/platforms.ts`

### Platform Rendering in StepNode

- **All 3 platforms**: Stacked cards with opacity cascade
- **2 platforms**: Single card with platform dots
- **1 platform**: Single card with platform-colored border

## Edge Types

| ID | Label | Visual | Use |
|----|-------|--------|-----|
| `composes` | Composes | Straight solid | Hierarchy: product→scenario→flow |
| `branches` | Branches | Bezier curve | Flow branching: step→condition→step |
| `calls` | Calls | Straight solid | View → API endpoint |
| `displays` | Displays | Straight solid | View → data model |
| `queries` | Queries | Straight solid | API endpoint → data model |

**Config source:** `lib/config/edge-types.ts`

### Edge Components

| Component | Path Style | Used For |
|-----------|------------|----------|
| `ComposeEdge` | Straight | composes, displays, queries |
| `BranchEdge` | Bezier | branches |
| `CrossLayerEdge` | Dashed straight | Cross-layer references (not yet registered in Canvas) |

## Adding New Taxonomies

All taxonomies live in `lib/config/` as typed `const` arrays:

1. Add the new entry to the relevant array in `lib/config/`
2. The `SpeciesId`, `StatusId`, `PlatformId`, or `EdgeTypeId` type updates automatically via `typeof`
3. If adding a new species: create a node component in `components/graph/nodes/`, register it in `Canvas.tsx`
4. If adding a new edge type: create an edge component in `components/graph/edges/`, register it in `Canvas.tsx`
5. Update this document

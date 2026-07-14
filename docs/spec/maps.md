---
title: "Spec: Maps & Projections"
navTitle: "Maps"
order: 5
---

# Maps & Projections

> Status: **Implemented** — the format/projection half lives in `packages/schema/src/maps.ts` + `bundle.ts` + `validate.ts`; the renderers are live at `/project/[id]/maps` (index + custom-map editor) and `/project/[id]/maps/[mapId]` (Journey via `lib/utils/journey-graph.ts`, System via `lib/utils/system-graph.ts` with species-tier ELK partitioning); the Delivery board consumes the delivery reading at `/project/[id]/delivery`. This document remains the normative contract.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Purpose

A product graph is one dataset with many legitimate readings: a navigation drill-down, a systems diagram, a delivery board, an executive dashboard. A **map** is a named, parameterized *projection* over the bundle — scope + selection + rendering mode — so the same graph can be read from the angle the question demands.

Maps follow the projection doctrine established by the journal ([journal.md](journal.md) § Projections): **pure functions over (snapshot, journal), defined once in `@arkaik/schema`, consumed everywhere.** The app renders a map, the CLI prints it, the MCP server ([mcp.md](mcp.md)) serves it to agents. Every human surface has an agent-consumable twin.

## MapDefinition

```ts
interface MapDefinition extends Record<string, unknown> {
  id: string;                    // kebab-case, unique within the project; built-in ids reserved
  title: string;
  description?: string;
  kind: "journey" | "system";    // selects the renderer and the defaults below
  species?: SpeciesId[];         // node filter; defaults by kind
  edge_types?: EdgeTypeId[];     // edge filter; defaults by kind
  root_node_id?: string;         // scope anchor; journey falls back to project.root_node_id
  depth?: number;                // traversal bound from the root; absent = unbounded
  layout?: { direction?: "DOWN" | "RIGHT"; algorithm?: "layered" | "organic" };
}
```

| Rule | Detail |
|---|---|
| Defaults by kind | `journey`: `species: ["flow","view"]`, `edge_types: ["composes"]`. `system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]` |
| Reserved ids | `journey` and `system` name the built-in maps every project has implicitly. A stored definition MUST NOT reuse them (validator warning `map-shadows-built-in`) |
| Unknown fields | Preserved and ignored, like every other format object (`Record<string, unknown>`) |
| Unknown kinds | Consumers MUST preserve definitions with unrecognized `kind` values and SHOULD list them as unrenderable rather than dropping them |
| `layout.algorithm` | `"organic"` = force-directed with overlap removal (structure/cluster reading); `"layered"` = hierarchical tiers (didactic reading). Renderers fall back to the kind's default for unknown values; the built-in System map defaults to `organic` — at whole-product scale the tiered rendition degenerates into an unreadably wide ribbon |

## Storage

Custom maps live at **`project.metadata.maps: MapDefinition[]`**.

This is a purely additive optional field in an already-`catchall` object (`ProjectMetadataSchema`), so per [bundle-format.md](bundle-format.md) § Schema Versioning it requires **no `schema_version` bump** — the same class of change as `metadata.refs` was. Every existing consumer (app import, published validator, Publik/Synk round-trips, canonical serialization) preserves it today.

Maps-as-data is the point: a human saves a map from a dialog, **an agent authors one by writing JSON** — "make me a map of the admin area" is a metadata patch, not a feature request.

## Subgraph Algorithm

`computeMapSubgraph(definition, nodes, edges)` — the normative selection semantics, in order:

1. **Species filter.** Keep nodes whose `species` is in the (defaulted) `species` list.
2. **Edge filter.** Keep edges whose `edge_type` is in the (defaulted) `edge_types` list **and** whose two endpoints both survived step 1.
3. **Scope.** If `root_node_id` is present and resolves to a surviving node: **undirected BFS** from it through the surviving edges, bounded by `depth` when present; keep the visited nodes and the surviving edges among them. Undirected, because a scoped map means *"the neighborhood of this anchor"* — an admin view's map must include the API that calls into it, not only what it calls. (A directed variant was considered and rejected for v1; a `direction` knob MAY be added later without breaking this contract.)
4. **Unresolvable root → empty subgraph**, never an error — the same posture as `computeChangelog` with an unknown version.

The function is deterministic, pure, and generic over the node/edge element type (callers pass full app nodes or raw parsed JSON and get the same elements back).

## Built-in Maps

| Map | Kind | Answers | Rendering |
|---|---|---|---|
| **Journey** | `journey` | "How does a user move through the product?" | The existing canvas: compose closure from the root, playlist expansion, flows collapsible, visual node duplication for reuse |
| **System** | `system` | "Which screens render this model? What does this endpoint feed?" | Direct render of `computeMapSubgraph`: all selected species as cards, cross-layer edges drawn, ELK-layered by species tier (views / api-endpoints / data-models) |

**Renderer division of labor:** System is a *direct* projection render. Journey consumes the definition's root and species but owns its drawing logic (playlist ordering, expansion state, visual duplication of reused views) — renderer logic over a projection, exactly as `ReleaseCard` is renderer logic over `computeChangelog`. Delivery and Overview (vision.md § Core Product) are projections too, but render as a board and a dashboard rather than a canvas; their selection logic is specified with their implementation phases.

## Validation

Stored map definitions are checked by `validateBundle()` at **warning severity only** — a stale or dangling map must never fail an import or a CI gate:

| Finding | Trigger |
|---|---|
| `map-duplicate-id` | Two stored definitions share an `id` |
| `map-shadows-built-in` | A stored definition uses a reserved built-in id |
| `map-unknown-root` | `root_node_id` does not resolve to a node |
| `map-unknown-species` | A `species` entry is not a known species id |
| `map-unknown-edge-type` | An `edge_types` entry is not a known edge type id |

## Orphans

Nodes unreachable from any root (the Pebbles seed ships two orphan flows) are not an error: they appear in the System map (which is unscoped by default) and in the library. The Journey renderer MAY later surface an "unanchored" cluster; hiding data silently is the failure mode this spec exists to end.

## Non-Goals (v1)

- **Per-map layout persistence** — positions are computed (ELK), not stored.
- **Map sharing / cross-project maps** — a definition is project-scoped data.
- **"Area" / domain tags on nodes** — root-scoping covers the admin-vs-user-app case for now; a first-class area concept is a future format revision if root-scoping proves insufficient.
- **Journaling map edits** — `project.metadata` changes are not journal events today; unchanged by this spec.

---
title: "Spec: Maps & Projections"
navTitle: "Maps"
order: 5
---

# Maps & Projections

> Status: **Implemented** — the format/projection half lives in `packages/schema/src/maps.ts` + `bundle.ts` + `validate.ts`; the renderers are live at `/project/[id]/maps` (index + custom-map editor) and `/project/[id]/maps/[mapId]` (Journey via `lib/utils/journey-graph.ts`, System via `lib/utils/system-graph.ts` with species-tier ELK partitioning), each with a Display popover over § Display Options; the Delivery board consumes the delivery reading at `/project/[id]/delivery`; the Overview dashboard composes the aggregations in `lib/utils/coverage.ts` at `/project/[id]/overview` (§ Overview Composition). This document remains the normative contract.
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
  display?: MapDisplayOptions;   // card rendering (§ Display Options)
}
```

| Rule | Detail |
|---|---|
| Defaults by kind | `journey`: `species: ["flow","view"]`, `edge_types: ["composes"]`. `system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]` |
| Reserved ids | `journey` and `system` name the built-in maps every project has implicitly. A stored definition MUST NOT reuse them (validator warning `map-shadows-built-in`) |
| Unknown fields | Preserved and ignored, like every other format object (`Record<string, unknown>`) |
| Unknown kinds | Consumers MUST preserve definitions with unrecognized `kind` values and SHOULD list them as unrenderable rather than dropping them |
| `layout.algorithm` | `"organic"` = force-directed with overlap removal (structure/cluster reading); `"layered"` = hierarchical tiers (didactic reading). Renderers fall back to the kind's default for unknown values; the built-in System map defaults to `organic` — at whole-product scale the tiered rendition degenerates into an unreadably wide ribbon |

## Display Options

A map is a reading, and how its cards *look* is part of the reading: a delivery
review wants the platform breakdown loud, a navigation walkthrough wants the
screenshots. These are per-map, not per-project — one project's Journey and its
Recording Loop legitimately want different answers.

```ts
interface MapDisplayOptions extends Record<string, unknown> {
  images?: boolean;                       // screenshot (or cover) art on view cards
  flow_platforms?: "rings" | "bars";      // a flow card's platform delivery
  view_platforms?: "chips" | "rows";      // a view card's platform availability
}
```

| Option | Default (listed first) | Alternative |
|---|---|---|
| `images` | `true` — the view's screenshot, falling back to `metadata.cover_url` | `false` — view cards carry no art |
| `flow_platforms` | `rings` — the Pyramid's ring set, the global ring centering the flow's view count | `bars` — one stacked status gauge per platform |
| `view_platforms` | `chips` — circular platform chips in the card footer | `rows` — a labelled line per platform with its status icon |

`resolveMapDisplay(definition, project)` resolves them least- to most-specific:

1. the defaults — `{ images: true, flow_platforms: "rings", view_platforms: "chips" }`;
2. the definition's own `display` — the agent-authored half;
3. `project.metadata.map_display[definition.id]` — the human half, and the only
   path open to the built-in maps, which have no stored definition of their own.

The superseded project-wide `metadata.view_card_variant` is deliberately **not**
a layer: display is per map now, and a project-wide preset that quietly outranked
the defaults would mean a project saved before this section could never see them.
The field still parses, validates, and round-trips; no renderer reads it.

Resolution is key by key, and an unrecognized value at any layer falls through to
the layer beneath rather than blanking the card — the same posture as
`layout.algorithm`. Renderers honour only the options they can draw: the System
map has no flow cards and carries no screenshot payload, so `view_platforms` is
the only one that reads across.

## Storage

Custom maps live at **`project.metadata.maps: MapDefinition[]`**, and per-map
display overrides at **`project.metadata.map_display: Record<string, MapDisplayOptions>`**,
keyed by map id — built-in ids included, since `journey` and `system` have no
stored definition to carry a `display`.

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

**Renderer division of labor:** System is a *direct* projection render. Journey consumes the definition's root and species but owns its drawing logic (playlist ordering, expansion state, visual duplication of reused views) — renderer logic over a projection, exactly as `ReleaseCard` is renderer logic over `computeChangelog`. Delivery and Overview (vision.md § Core Product) are projections too, but render as a board and a dashboard rather than a canvas; Delivery's item semantics live with its implementation (`lib/utils/delivery.ts`), and the Overview's composition is specified in § Overview Composition below.

## Overview Composition

The Overview answers *"where does this product stand?"* — a dashboard of pure aggregations (`lib/utils/coverage.ts`) over (snapshot, journal), rendered at `/project/[id]/overview`, which is also where `/project/[id]` lands. Each section links into the surface that owns the detail:

| Section | Feeds from | Jump-off |
|---|---|---|
| Platform delivery | `computeProductRollup` — every view through the flow cards' rollup (counted-preset statuses only) | Delivery board |
| Delivery snapshot | `computeDeliverySnapshot` — the board's own item expansion and column grouping | Delivery board |
| Release pulse | `computeReleasePulse` — `release.tagged` markers newest-first, each with its `computeChangelog` event count; a re-tagged version resolves to its latest marker | Changelog |
| Backlog | `computeBacklog` (journal.md § Projections) | Changelog |
| Inventory | `computeInventory` — node/edge/journal census; per-species totals + node-level status tallies | Library (per species) |
| Health | `computeHealthIndicators` (below) | Per-indicator evidence |
| Maps | `listMaps` + `computeMapSubgraph` counts | Maps index |

**Health indicators** (fixed order; `count` of offenders, 0 = healthy; offending node ids included where the offenders are nodes):

| Indicator | Rule |
|---|---|
| `unreachable-from-root` | Flow/view ids not reached by a **directed** BFS over `composes` edges (source → target) from `project.root_node_id`. Directed is the Journey's own traversal direction — an undirected walk would absolve an orphan flow that merely composes *into* reachable views (§ Orphans). Data models and API endpoints are out of scope (composes never reaches them). Unset or unresolvable root → zero findings, never an error — the § Subgraph Algorithm rule-4 posture |
| `views-without-screenshot` | Views with no non-empty `metadata.platformScreenshots` value |
| `nodes-without-description` | Nodes whose `description` is absent or whitespace |
| `disconnected-nodes` | Nodes appearing in no edge as source or target |
| `open-backlog` | `computeBacklog(...).items.length` — journal ideas/requests not realized as snapshot nodes |

The Overview is read-only by design: strategists get the global picture one screen deep and jump into maps, the board, the changelog, or the library to act. Audience symmetry holds — every number on the dashboard comes from an exported pure function an agent can call (mcp.md).

## Validation

Stored map definitions are checked by `validateBundle()` at **warning severity only** — a stale or dangling map must never fail an import or a CI gate:

| Finding | Trigger |
|---|---|
| `map-duplicate-id` | Two stored definitions share an `id` |
| `map-shadows-built-in` | A stored definition uses a reserved built-in id |
| `map-unknown-root` | `root_node_id` does not resolve to a node |
| `map-unknown-species` | A `species` entry is not a known species id |
| `map-unknown-edge-type` | An `edge_types` entry is not a known edge type id |
| `map-unknown-display` | A `display` (or `map_display[id]`) option holds a value no renderer knows — the renderer falls back to the default |

## Orphans

Nodes unreachable from any root (the Pebbles seed ships two orphan flows) are not an error: they appear in the System map (which is unscoped by default) and in the library. The Journey renderer MAY later surface an "unanchored" cluster; hiding data silently is the failure mode this spec exists to end.

## Non-Goals (v1)

- **Per-map layout persistence** — positions are computed (ELK), not stored. Card *rendering* is per-map and stored (§ Display Options); card *placement* is not.
- **Map sharing / cross-project maps** — a definition is project-scoped data.
- **"Area" / domain tags on nodes** — root-scoping covers the admin-vs-user-app case for now; a first-class area concept is a future format revision if root-scoping proves insufficient.
- **Journaling map edits** — `project.metadata` changes are not journal events today; unchanged by this spec.

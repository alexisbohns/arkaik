---
title: "Spec: Maps & Projections"
navTitle: "Maps"
order: 5
---

# Maps & Projections

> Status: **Implemented** — the format/projection half lives in `packages/schema/src/maps.ts` + `bundle.ts` + `validate.ts`; the renderers are live at `/project/[id]/maps` (index + custom-map editor) and `/project/[id]/maps/[mapId]` (Journey via `lib/utils/journey-graph.ts`, System via `lib/utils/system-graph.ts` with species-tier ELK partitioning); the Delivery board consumes the delivery reading at `/project/[id]/delivery`; the Overview dashboard composes the aggregations in `lib/utils/coverage.ts` at `/project/[id]/overview` (§ Overview Composition). This document remains the normative contract.
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
  product?: string;              // product scope; absent = every product
  depth?: number;                // traversal bound from the root; absent = unbounded
  layout?: { direction?: "DOWN" | "RIGHT"; algorithm?: "layered" | "organic" };
}
```

| Rule | Detail |
|---|---|
| Defaults by kind | `journey`: `species: ["flow","view"]`, `edge_types: ["composes"]`. `system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]` |
| Reserved ids | `journey` and `system` name the built-in maps every project has implicitly. A stored definition MUST NOT reuse them (validator warning `map-shadows-built-in`) |
| `product` | Scopes the map to one product ([bundle-format.md](bundle-format.md) § Products); absent selects every product. It composes with `root_node_id` rather than competing with it — the anchor still scopes the walk. Full semantics in § Product Scope below |
| Unknown fields | Preserved and ignored, like every other format object (`Record<string, unknown>`) |
| Unknown kinds | Consumers MUST preserve definitions with unrecognized `kind` values and SHOULD list them as unrenderable rather than dropping them |
| `layout.algorithm` | `"organic"` = force-directed with overlap removal (structure/cluster reading); `"layered"` = hierarchical tiers (didactic reading). Renderers fall back to the kind's default for unknown values; the built-in System map defaults to `organic` — at whole-product scale the tiered rendition degenerates into an unreadably wide ribbon |

## Storage

Custom maps live at **`project.metadata.maps: MapDefinition[]`**.

This is a purely additive optional field in an already-`catchall` object (`ProjectMetadataSchema`), so per [bundle-format.md](bundle-format.md) § Schema Versioning it requires **no `schema_version` bump** — the same class of change as `metadata.refs` was. Every existing consumer (app import, published validator, Publik/Synk round-trips, canonical serialization) preserves it today.

Maps-as-data is the point: a human saves a map from a dialog, **an agent authors one by writing JSON** — "make me a map of the admin area" is a metadata patch, not a feature request.

## Product Scope

A project may describe a family of apps ([bundle-format.md](bundle-format.md) § Products), and two
product answers can be in play when a map is opened: the definition's own `product`, and the
**global scope** the shell carries for every surface. They are resolved once, by one expression:

> **The map's own `product` wins; the global scope is the default for a map that declares none.**

A definition's `product` is an explicit, named, stored property of a *saved view*; the global scope
is an ambient default. So a map titled "Admin systems" MUST show admin whatever the sidebar says —
the only rule under which its title cannot lie. The rejected alternatives each break something
visible: *global-scope-wins* renders another product's graph under the saved map's own name, and
*intersection* renders the saved map as a blank canvas, with no explanation, under every scope but
one. The built-in Journey and System maps declare no `product`, so they follow the shell exactly as
every other surface does, and a project declaring no products resolves the whole rule to "no
filter".

**The journey anchor** resolves in strict order, and the fallback chain is written as a single
expression so it cannot be reordered by a local-looking edit:

1. the map's own `root_node_id`;
2. the resolved product's `root_node_id`;
3. `project.root_node_id`.

A blank or absent value at any level falls **through** to the next: a product that declares no
anchor does not blank the map, it inherits the project's. Nothing anchored anywhere yields the
unanchored render, never an error. Level 2 is what makes a product an app rather than a tag —
Admin opens on Admin's own front door.

**Which surfaces the restriction applies to** differs by renderer kind, and deliberately:

| Renderer | How `product` scopes it |
|---|---|
| `system` (and every subgraph **count**: the maps index, the Overview's Maps card) | The resolved product restricts the candidate nodes **before** § Subgraph Algorithm runs; species and edge filters then compose on top unchanged. Counts go through the same restriction as the canvas, so a card can never advertise a node count the map it links to does not show |
| `journey` | Scoped by its **anchor** only. A membership filter on top would cut a shared view out of the middle of a compose chain and silently truncate the journey below it — the opposite of what the reader asked for |

Membership is resolved per species — stored for flows and views, anchors-first for acceptances,
derived from consumers for data models and API endpoints — and an *orphan* endpoint or model, which
nothing in the graph reaches, stays visible under every named product. A restriction is not a
partition: a data model two products both reach appears in both.

> **Known gap.** The restriction is applied by the app (`lib/utils/product-scope.ts`,
> `mapScopedNodes`) rather than inside `computeMapSubgraph`, because membership resolution lives
> there and a second copy of it is how two surfaces come to disagree about the same node. The
> consequence is that the MCP server's `get_map` ([mcp.md](mcp.md)) and any CLI consumer call
> `computeMapSubgraph` directly and therefore **do not apply `product`** — an agent asking for a
> product-scoped map gets the unscoped subgraph. Audience symmetry is broken here until membership
> resolution moves into `@arkaik/schema` and `computeMapSubgraph` can take it; that move is the fix,
> not a second implementation.

## Subgraph Algorithm

`computeMapSubgraph(definition, nodes, edges)` — the normative selection semantics, in order.
The `product` restriction (§ Product Scope) is applied to `nodes` by the caller before step 1, so
these four steps are unchanged by it:

1. **Species filter.** Keep nodes whose `species` is in the (defaulted) `species` list.
2. **Edge filter.** Keep edges whose `edge_type` is in the (defaulted) `edge_types` list **and** whose two endpoints both survived step 1.
3. **Scope.** If `root_node_id` is present and resolves to a surviving node: **undirected BFS** from it through the surviving edges, bounded by `depth` when present; keep the visited nodes and the surviving edges among them. Undirected, because a scoped map means *"the neighborhood of this anchor"* — an admin view's map must include the API that calls into it, not only what it calls. (A directed variant was considered and rejected for v1; a `direction` knob MAY be added later without breaking this contract.)
4. **Unresolvable root → empty subgraph**, never an error — the same posture as `computeChangelog` with an unknown version.

The function is deterministic, pure, and generic over the node/edge element type (callers pass full app nodes or raw parsed JSON and get the same elements back).

## Built-in Maps

| Map | Kind | Answers | Rendering |
|---|---|---|---|
| **Journey** | `journey` | "How does a user move through the product?" | The existing canvas: compose closure from the root (resolved by the anchor chain in § Product Scope), playlist expansion, flows collapsible, visual node duplication for reuse |
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
| Maps | `listMaps` + `computeMapSubgraph` counts, product-restricted like the canvas (§ Product Scope) | Maps index |

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

## Orphans

Nodes unreachable from any root (the Pebbles seed ships two orphan flows) are not an error: they appear in the System map (which is unscoped by default) and in the library. The Journey renderer MAY later surface an "unanchored" cluster; hiding data silently is the failure mode this spec exists to end.

## Non-Goals (v1)

- **Per-map layout persistence** — positions are computed (ELK), not stored.
- **Map sharing / cross-project maps** — a definition is project-scoped data.
- **"Area" / domain tags on nodes** — root-scoping covers the admin-vs-user-app case for now; a first-class area concept is a future format revision if root-scoping proves insufficient.
- **Journaling map edits** — `project.metadata` changes are not journal events today; unchanged by this spec.

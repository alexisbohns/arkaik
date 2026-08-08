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
  root_node_id?: string;         // scope anchor; journey falls back to the product's, then — only
                                 // when no product is named — to project.root_node_id
  product?: string;              // product scope; absent = every product
  depth?: number;                // traversal bound from the root; absent = unbounded
  layout?: { direction?: "DOWN" | "RIGHT"; algorithm?: "layered" | "organic" };
  display?: MapDisplayOptions;   // card rendering (§ Display Options)
}
```

| Rule | Detail |
|---|---|
| Defaults by kind | `journey`: `species: ["flow","view"]`, `edge_types: ["composes"]`. `system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]` |
| Reserved ids | `journey` and `system` name the built-in maps every project has implicitly. A stored definition MUST NOT reuse them (validator warning `map-shadows-built-in`) |
| `product` | Scopes the map to one product ([bundle-format.md](bundle-format.md) § Products); absent selects every product. It composes with `root_node_id` rather than competing with it: the product restricts which nodes exist for this map, and the anchor then scopes the walk through them — a `journey` is scoped by **both**, and an anchor outside the product is no anchor at all. Full semantics in § Product Scope below |
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
  minimap_color?: "status" | "species";   // what a minimap node's fill encodes
}
```

| Option | Default (listed first) | Alternative |
|---|---|---|
| `images` | `true` — the view's screenshot, falling back to `metadata.cover_url` | `false` — view cards carry no art |
| `flow_platforms` | `rings` — the Pyramid's ring set, the global ring centering the flow's view count | `bars` — one stacked status gauge per platform |
| `view_platforms` | `chips` — circular platform chips in the card footer | `rows` — a labelled line per platform with its status icon |
| `minimap_color` | `status` — a minimap node's fill matches its card badge, the delivery reading | `species` — the fill names the node's kind instead |

`resolveMapDisplay(definition, project)` resolves them least- to most-specific:

1. the defaults — `{ images: true, flow_platforms: "rings", view_platforms: "chips", minimap_color: "status" }`;
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
map has no flow cards and carries no screenshot payload, so `view_platforms` and
`minimap_color` are the ones that read across.

### Display versus product scope

A map's display and its product scope (§ Product Scope) answer different
questions and neither substitutes for the other:

| Question | Answered by |
|---|---|
| *Which nodes may this map draw, and which platforms may a card claim?* | the product scope — `computeMapSubgraph`'s step 0 (`mapScopedNodes` for the journey renderer), `scopedPlatforms`, `flowGaugePlatforms` |
| *How does a card draw whatever it was given?* | the display — `resolveMapDisplay` |

So a display flip re-draws the same facts: the platform list a flow card renders
is `flowGaugePlatforms(...)` under both `rings` and `bars`, and a view card's
chips and rows both enumerate `scopedPlatforms(node, scope)`.

The one place they meet is the **arity rule** ([graph-model.md](../graph-model.md)
§ The arity rule), which wins: at one effective platform or none there is no
per-platform breakdown for a rendition to be a rendition of, so a flow card draws
the single unlabelled status track whichever of `rings` or `bars` the map asked
for. That collapse lives in `PlatformAvailability`, the one switch over per-platform
shape — `flow_platforms` reaches it as a `multiPlatformShape` prop rather than
branching beside it.

## Storage

Custom maps live at **`project.metadata.maps: MapDefinition[]`**, and per-map
display overrides at **`project.metadata.map_display: Record<string, MapDisplayOptions>`**,
keyed by map id — built-in ids included, since `journey` and `system` have no
stored definition to carry a `display`.

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

**The journey anchor** resolves in strict order, and the chain is written as a single expression so
it cannot be reordered by a local-looking edit:

1. the map's own `root_node_id`;
2. the resolved product's `root_node_id`;
3. `project.root_node_id` — **only when the resolved product is `null`.**

A blank or absent value at levels 1 and 2 falls **through** to the next; `resolveProducts` is lenient
by contract, so a stored blank must not swallow the level beneath it. Level 2 is what makes a product
an app rather than a tag — Admin opens on Admin's own front door.

**Level 3 stops at the product boundary**, and that exception is load-bearing. `project.root_node_id`
is the *project's* front door, which on every real project is the end-user app's; falling through to
it under a named scope made a web-only Admin scope render the end-user app's landing view and walk
the end-user app's compose chain, drawn under Admin's name with Admin's platform menu clamped over
it — foreign content wearing another product's rules. A named product that declares no anchor has no
journey **yet**, and the honest render for that is an empty state saying so (below), not somebody
else's map. The exception is exactly two cases wide, and both are cases where nobody named a product:
**All products**, and a project that declares no products at all. For those two the chain is
byte-identical to the pre-products `definition ?? project`, and nothing anchored anywhere still
yields the unanchored render, never an error.

**How the restriction applies** is now the same for both renderer kinds, and the difference that used
to be here was the bug:

| Renderer | How `product` scopes it |
|---|---|
| `system` | § Subgraph Algorithm's step 0 restricts the candidate nodes; species and edge filters then compose on top unchanged |
| `journey` | The same restriction, **plus** the anchor. The journey renderer is not `computeMapSubgraph` — it walks its own compose closure — so it applies the restriction itself through `mapScopedNodes`, and the anchor chain is then resolved against what survived: an anchor the product does not contain does not resolve. The compose walk, the parent index and the playlist lookups all read the restricted set, so a journey can no more show another product's view than a System map can |

The earlier rule — journey scoped by its anchor *only* — rested on the premise that a membership
filter would cut a shared view out of the middle of a compose chain and truncate the journey below
it. That premise does not hold: membership is **single** per flow and view, and a surface two
products share is duplicated under distinct ids ([products RFC](../rfcs/products.md), decision 3), so
a `composes` edge never crosses a product boundary in the first place. What the missing filter
actually bought was the ability for one built-in map to disagree with the other about the same scope.

**An unresolved anchor under a named product is an empty state, not a fallback.** The journey
renderer names which of the two things went wrong — nothing anchors this product, or the declared
anchor is not part of it — and offers the System map, which is scoped and populated either way. The
unanchored parentless-roots render (§ Built-in Maps) stays exactly where it belongs: the
All-products / no-products case, where it is the fresh-project view of a graph nobody has rooted yet.

**Counts go through the renderer that draws them.** The maps index and the Overview's Maps card
count each map through its own renderer — `computeMapSubgraph` for `system`, and for `journey` the
collapsed `buildJourneyGraph` render (no flow expanded) — so a card can never advertise a node count
the map it links to does not show. Counting a journey with `computeMapSubgraph` did exactly that,
twice over: the built-in Journey carries no `root_node_id` of its own, so step 3 never ran for it and
it counted every flow and view in the project; and a stored journey that *does* carry one was counted
by step 3's **undirected** BFS, which walks up out of the anchor and back down through everything
above it. Journey expansion only ever *adds* — a flow's playlist, plus visual duplicates of nodes
already counted — so the collapsed count is a floor the map always shows.

Membership is resolved per species — stored for flows and views, anchors-first for acceptances,
derived from consumers for data models and API endpoints — and an *orphan* endpoint or model, which
nothing in the graph reaches, stays visible under every named product. A restriction is not a
partition: a data model two products both reach appears in both.

**The restriction is inside `computeMapSubgraph`, and every audience therefore gets it.** It used to
be applied by the app before the call — membership resolution lived in `lib/utils/product-scope.ts`,
so the schema function could not reach it — which left the MCP server's `get_map` and `list_maps`
([mcp.md](mcp.md)) serving the **unscoped** subgraph, and unscoped counts, under a scoped map's own
name (issue #319). A map titled "Admin systems" answered one question on the canvas and a different,
larger one over MCP, with nothing in the result saying so. The fix was to move membership resolution
into `@arkaik/schema` (`productsOfNode`, `nodeInProduct`, `buildProductGraph`) and let the algorithm
take the product, **not** to reimplement the restriction in the MCP layer: two implementations of one
membership rule is exactly how two surfaces come to disagree about the same node.

The default is what makes this hold for the *next* caller too: with no options, `computeMapSubgraph`
applies the definition's own `product`. A caller wanting the whole graph has to opt out
(`{ product: null }`), and opting out is then a visible decision in the source rather than an
omission. The app passes `mapProductId(definition, scope.productId)` — the resolved product, already
carrying the precedence above — plus the `ProductGraph` it builds once per snapshot, because the
usage index is a traversal and must never run per node.

## Subgraph Algorithm

`computeMapSubgraph(definition, nodes, edges, options?)` — the normative selection semantics, in
order:

0. **Product restriction.** Keep nodes the resolved product contains (§ Product Scope). The product
   is `options.product` when given and the definition's own `product` otherwise; `null` is All
   products. `nodes` and `edges` MUST be the whole snapshot — system-layer membership is derived from
   consumers, so a pre-filtered slice would resolve a data model against a graph missing the views
   that reach it. Filtering nodes is enough to filter edges: step 2 drops any edge that lost an
   endpoint. The four steps below are unchanged by it.
1. **Species filter.** Keep nodes whose `species` is in the (defaulted) `species` list.
2. **Edge filter.** Keep edges whose `edge_type` is in the (defaulted) `edge_types` list **and** whose two endpoints both survived step 1.
3. **Scope.** If `root_node_id` is present and resolves to a surviving node: **undirected BFS** from it through the surviving edges, bounded by `depth` when present; keep the visited nodes and the surviving edges among them. Undirected, because a scoped map means *"the neighborhood of this anchor"* — an admin view's map must include the API that calls into it, not only what it calls. (A directed variant was considered and rejected for v1; a `direction` knob MAY be added later without breaking this contract.)
4. **Unresolvable root → empty subgraph**, never an error — the same posture as `computeChangelog` with an unknown version.

The function is deterministic, pure, and generic over the node/edge element type (callers pass full app nodes or raw parsed JSON and get the same elements back).

**The `journey` renderer does not run this algorithm** — it consumes the definition's anchor and
species and owns its own walk (§ Built-in Maps), so rules 3 and 4 describe `system` and any future
direct-projection kind, not it. The journey's own equivalents, and where they differ, deliberately:

| Rule | `journey`'s equivalent |
|---|---|
| 3. Scope | A **directed** compose walk down from the anchor, not an undirected BFS. A journey answers *"where does this take the reader next"*; walking up out of the anchor would put the whole product above it back on the canvas, which is why counting a journey with this function was wrong (§ Product Scope) |
| 4. Unresolvable root | Under a named product, an empty canvas with the reason in words (§ Product Scope) — rule 4's posture, said out loud. Under **All products** and in a project declaring no products, an unresolvable or absent root instead renders the **parentless flow and view roots**: that is the fresh-project view of a graph nobody has rooted yet, it predates products, and it is deliberately kept |

## Built-in Maps

| Map | Kind | Answers | Rendering |
|---|---|---|---|
| **Journey** | `journey` | "How does a user move through the product?" | The existing canvas: compose closure from the root (product-restricted candidates and the anchor chain, both in § Product Scope), playlist expansion, flows collapsible, visual node duplication for reuse. With no root resolved and no product named, the parentless flow/view roots |
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
| Maps | `listMaps` + `computeMapCounts` — each map counted through the renderer that draws it, product-restricted like the canvas (§ Product Scope) | Maps index |

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

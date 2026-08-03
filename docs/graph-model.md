# Graph Model

The graph is built from nodes and edges with structure driven by persisted relationships.

## Species

Current taxonomy has exactly 5 species.

| Level | Species | Role | React Flow node type |
|---|---|---|---|
| 1 | `flow` | Ordered sequence container | `flow` |
| 0 | `view` | Reusable page/screen | `view` |
| — | `data-model` | Data entity/table | `dataModel` |
| — | `api-endpoint` | API endpoint | `apiEndpoint` |
| — | `acceptance` | A testable promise: What (`title`), How (`metadata.gherkin`, one Given/When/Then), Why (`metadata.values`, Bain elements), with per-platform status in `metadata.platformStatuses`. Id prefix `AC-`. | `acceptance` |

Config source: [lib/config/species.ts](../lib/config/species.ts)

## Canvas Visibility (Journey Map)

- The canvas is the **Journey map** ([vision.md § Core Product](vision.md), [spec/maps.md](spec/maps.md)): it renders `flow` and `view` species as React Flow nodes over the full compose closure from the root — views chain the traversal onward, flows render as collapsed, expandable cards.
- `data-model` and `api-endpoint` remain persisted graph species, editable from panels and import/export. They render as standalone cards on the **System map** (`/project/[id]/maps/system`); on the Journey map they surface inline on View cards via embedded API actions and in the detail panel's Connections section.
- Cross-layer edges (`calls`, `displays`, `queries`) draw whenever both endpoints are visible.

Source: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts), [components/graph/nodes/ViewNode.tsx](../components/graph/nodes/ViewNode.tsx)

## Library Views

Project library is available at `/project/[id]/library` with two browsing modes:

- **Gallery**: card grid with title, prefixed ID, species/status badges, platforms, and flow playlist preview.
- **Directory**: sortable table for `id`, `title`, `species`, `status`, and `used in` flow count.

Filtering:

- Species selection is owned by the **sidebar** (`?species=` deep links: `all` when absent, or one of `flow`, `view`, `data-model`, `api-endpoint`, `acceptance`); the in-page bar carries search and the display-mode toggle only.
- Search matches node title and description text.

Library source:

- [app/project/[id]/library/page.tsx](../app/project/[id]/library/page.tsx)
- [components/library/LibraryFilterBar.tsx](../components/library/LibraryFilterBar.tsx)
- [components/library/NodeCard.tsx](../components/library/NodeCard.tsx)
- [components/library/NodeTable.tsx](../components/library/NodeTable.tsx)

## Acceptances View

- **Acceptances** (`/project/[id]/acceptances`) — the parity matrix: acceptances grouped by the view/flow they cover, one status column per platform, filterable by platform/status/value/anchor/parity-gap. Editing (Gherkin, values, per-platform status) happens in the node detail panel.

## Pyramid View

- **Pyramid** (`/project/[id]/pyramid`) — the value-element gauge grid: four Bain tier sections (functional → emotional → life-changing → social impact), each rendering its value elements as cards showing the element's icon + label + per-platform delivery gauge + acceptance count. A platform chip row filters the gauges to a single platform (or all), and each element card links to the Acceptances matrix pre-filtered on that value (`?value=<id>`).

## Composition Model

### Root Node

- `project.root_node_id` is the explicit canvas anchor when present.
- If `root_node_id` is not set, the canvas infers roots from nodes with no incoming `composes` edge.

Source: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts), [lib/data/types.ts](../lib/data/types.ts)

### Playlist Expansion

- Persisted parent/child links are `composes` edges.
- Child ordering is read from `node.metadata.playlist.entries`.
- When playlist entries do not reference all compose-edge children, missing children are appended after playlist-derived ordering.

Source: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts)

The canvas walks the compose closure from the anchor (`project.root_node_id`, or inferred roots when absent): views are always rendered and chain the walk onward; flows are rendered as collapsed cards whose interiors (playlists) render only when expanded. Flows start collapsed, except that the first **top-level flow** (a flow reached without passing through another flow) auto-expands on initial load. Top-level expansion is accordion-style: opening one top-level flow collapses any other top-level flow already open.

Expanded flow children follow a strict alternating drill layout:

- Root children are rendered horizontally below the root.
- Level 2 children are rendered vertically below each level 1 node.
- Level 3 children are rendered horizontally below each level 2 node.
- The pattern continues alternating by depth.
- Vertical drill segments always use top/bottom handles for both `flow` and `view` nodes.

Layout is computed by **elkjs** (Eclipse Layout Kernel, layered algorithm). The page builds a flat list of nodes and compose edges with `position: {x:0, y:0}`, then an async `useEffect` calls `computeElkLayout()` which runs the ELK layered algorithm and returns positioned nodes.

Layout source: [lib/utils/elk-layout.ts](../lib/utils/elk-layout.ts)

Source: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts)

### Node Reuse

- `view` and `flow` nodes are reusable and can appear multiple times across playlists.
- Reuse is many-to-many: a single node can be referenced by many flow playlists, and one flow playlist can reference many nodes.
- The source of truth for sequence semantics is the playlist (`metadata.playlist.entries`), while `composes` edges provide structural connectivity.
- The detail panel's where-used UI derives reverse references by scanning all flow playlists.

Source: [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx), [lib/utils/where-used.ts](../lib/utils/where-used.ts), [lib/data/types.ts](../lib/data/types.ts)

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

The lifecycle vocabulary is seven statuses:

| Status | Meaning |
|---|---|
| `idea` | Raw capture — request, intuition, opportunity. The inbox. |
| `discovery` | Actively being made ready to deliver, via design or specification. |
| `backlog` | Ready to be delivered; waiting to start. |
| `development` | Being implemented or executed. |
| `releasing` | Implementation done; awaiting validation (QA) or effective release/distribution. |
| `live` | Fully available. |
| `archived` | Retired from the working set. |

The table reads top to bottom as the usual path, but transitions are documented, not enforced — `status` stays a free assignment, and a node can jump or move backwards without ceremony.

Being blocked is not a status. A node stalled by a dependency keeps its lifecycle status and sets `metadata.blocked_by`: non-empty means *blocked at the current status*. The value is a node id (rendered as a link in the detail panel) or free text naming the dependency; absence means unblocked.

Status is orthogonal to the **stage** axis (`metadata.stage`: `beta`, `monitoring`, `deprecated` — [lib/config/stages.ts](../lib/config/stages.ts)), which qualifies *exposure* of something already built and is unchanged by this vocabulary.

**Legacy** (since bundle `schema_version` 3): `prioritized` reads as `backlog`, and `blocked` reads as `development` with `blocked_by` set. The one-time migration also remapped old `backlog` to `idea` — the id survives with a different meaning (the old `backlog` was the unprioritized pile; the new one means ready to deliver), which is why that remap is keyed on the version bump rather than being a parse-time alias. Journal history keeps the old ids as written, and parsers accept them forever — see [spec/bundle-format.md](spec/bundle-format.md) § Schema Versioning.

Rollup behavior:

- `acceptance` is the primary carrier of stored per-platform status values (`metadata.platformStatuses`).
- `view` also stores `metadata.platformStatuses`, but this is now a deprecated fallback: it is authoritative only while no acceptance covers the view (see `covers` under Edge Types).
- `flow` status is computed for display by recursively walking playlist entries and aggregating descendant view platform statuses, including nested sub-flows and branch entries.
- `data-model` and `api-endpoint` use single lifecycle status.

Sources:

- [lib/utils/platform-status.ts](../lib/utils/platform-status.ts)
- [components/panels/NodeDetailPanel.tsx](../components/panels/NodeDetailPanel.tsx)
- [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts)

## Products

A project describes a *family* of apps sharing one graph — an end-user app, a web-only back office, a public API — not one product with three platforms. A **product** names one app in that family and the platforms it may ship on.

Definitions live at `project.metadata.products: ProductDefinition[]` (`id`, `title`, `description?`, `platforms[]`, `root_node_id?`), following the stored-maps precedent exactly: an additive optional field in an already-catchall object, so no `schema_version` bump.

Membership is stored by some species and derived by others:

| Species | Membership |
|---|---|
| `flow`, `view` | **Stored** in `node.metadata.product` — one product id |
| `acceptance` | **Anchors first** — the products of the views/flows its `covers` edges reach. Stored `metadata.product` answers only for an acceptance that covers nothing |
| `data-model`, `api-endpoint` | **Derived** from consumers — a walk out of the membership-bearing flows and views along `calls` / `displays` / `queries`, each edge in its stored direction, hopping only into system-layer targets. Producers MUST NOT store `metadata.product` |

Shared substrate is the norm, so the system layer never claims a product of its own, and a restriction is not a partition — a data model two products both reach appears in both.

An absent answer is a **triage state**, not "applies everywhere". An unassigned flow, view, or anchorless acceptance appears under "All products" only. An *orphan* data model or endpoint — reached by no consumer — stays visible under **every** scope instead, because burying the node that most needs attention is the failure this model exists to end ([spec/maps.md](spec/maps.md) § Orphans).

Each product may carry its own journey anchor, and the map resolves it in strict order — the map definition's `root_node_id`, then the product's, then `project.root_node_id` ([spec/maps.md](spec/maps.md) § Product Scope). That middle level is what makes a product an app rather than a tag: Admin opens on Admin's own front door.

A project declaring **no** products behaves exactly as it did before products existed: one implicit product spanning every platform, every node in it, no warnings, no migration.

Normative text — the definition, membership, and the eight warning-severity validator rules: [spec/bundle-format.md](spec/bundle-format.md) § Products.

Projections: [packages/schema/src/products.ts](../packages/schema/src/products.ts) (`resolveProducts`, `productOf`, `productPlatforms`, `effectiveNodePlatforms`, `buildProductUsageIndex` / `productsUsingNode`).

App-side scope resolution (the one membership answer every surface asks): [lib/utils/product-scope.ts](../lib/utils/product-scope.ts), [lib/hooks/useProductScope.ts](../lib/hooks/useProductScope.ts).

## Platforms

Platforms are configured in:

- [lib/config/platforms.ts](../lib/config/platforms.ts)

Nodes target one or more platforms; per-platform notes/statuses/screenshots are stored in node metadata, keyed by platform.

**`node.platforms` stays authoritative.** A product supplies a *menu* — the platforms that product may ship on — and readers intersect rather than trust: `effectiveNodePlatforms(node, product)` returns `node.platforms ∩ product.platforms` in `PLATFORM_IDS` order, so a platform outside the menu drops out of the display instead of corrupting it. That is why containment is a validator **warning** and never an error (§ Products).

### The arity rule

A surface never picks a per-platform shape for itself; it counts. The scope's platform menu — `productPlatforms(project, productId)` — is the sole input:

| Effective platforms | Shape |
|---|---|
| ≥ 2 | The aggregate plus one ring / column / tab per platform |
| 1 | A single bar (or a single column headed `Status`), carrying no platform name |
| 0 | The same single bar — availability is simply not a tracked dimension here (a CLI, a public API) |

**1 and 0 render identically, deliberately.** At arity 1 the aggregate and the lone platform ring carry the same numbers, and a lone ring standing beside three-ring cards from another scope reads as *data missing* rather than *absent*; at arity 0 there is nothing that could be missing, so the same bar says so without inventing a third shape. A project declaring no products resolves to every platform, so the ≥ 2 row is today's rendering unchanged.

The threshold is written once, in `platformAvailabilityShape` ([lib/utils/product-scope.ts](../lib/utils/product-scope.ts)); the switch over it is [components/graph/nodes/PlatformAvailability.tsx](../components/graph/nodes/PlatformAvailability.tsx), which every platform-bearing surface composes rather than choosing a shape itself. Platform filters and detail-panel tabs read the same arity and hide themselves at ≤ 1.

### Shape versus fact

Two different questions read two different sources. Swapping them breaks the degenerate case, so the distinction is load-bearing:

| Question | Read |
|---|---|
| *How many columns / rings / tabs does this surface show?* | `scope.platforms` — the scope's **menu** |
| *What does this node actually ship on?* | `scopedPlatforms(node, scope)` — the node's own `platforms`, intersected with the menu of **the node's own product** |

`scopedPlatforms` intersects against the node's product, not the scope's list, and that is the whole delivery fix: under "All products" the scope's list is the union of every product, so intersecting a node against *it* would leave a web-only admin view contributing to the Android column exactly as it did before products existed.

Source:

- [lib/data/types.ts](../lib/data/types.ts)
- [lib/utils/product-scope.ts](../lib/utils/product-scope.ts)

## Edge Types

| Edge Type | Use |
|---|---|
| `composes` | Composition hierarchy and ordered flow sequences |
| `calls` | View/flow to API relationship (either direction — `calls` names the initiator), or API endpoint to API endpoint (first-party endpoint fanning out to internal/external APIs) |
| `displays` | View to data-model relationship |
| `queries` | API to data-model relationship |
| `covers` | Acceptance to view/flow relationship — anchors a testable promise to the surface(s) it covers |

Config source: [lib/config/edge-types.ts](../lib/config/edge-types.ts)

Rendering mapping source: [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts), [lib/utils/system-graph.ts](../lib/utils/system-graph.ts)

`calls` edges between a view and API endpoint are projected into View card UI.
The edge's direction names the *initiator*, so both directions are legal and
mean different things:

- API -> View: inbound/read affordance (`cloud-download` icon) — the server
  opens the channel: a webhook, a server-sent events stream, a push.
- View -> API: outbound/write affordance (`cloud-upload` icon) — the view
  initiates the request.

Because `calls` runs upward as well as downward, anything that walks it must say
which direction it means. `buildProductUsageIndex`
([packages/schema/src/products.ts](../packages/schema/src/products.ts)) restricts
hops to system-layer targets for exactly this reason — a direction-blind walk
would climb an inbound edge back up into another product's views.

`calls` edges between two API endpoints (a first-party endpoint fanning out to
internal/external APIs) have no view endpoint to project onto, so they surface only
on the System map (`/project/[id]/maps/system`), drawn between the two endpoint cards.

Source: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts), [components/graph/nodes/ViewNode.tsx](../components/graph/nodes/ViewNode.tsx)

`covers` — acceptance → view | flow. Zero covers edges = product-level
acceptance (legal, not an orphan). Stored per-platform status lives on
acceptances; a covered view's per-platform status is computed from its
covering acceptances, falling back to the view's stored `platformStatuses`
when uncovered (spec §3.4).

Source: `packages/schema/src/acceptance.ts` (projections; not yet consumed by
the app's status rollups — see the Surfaces plan).

## Node And Edge Components

Node registration is in:

- [components/graph/Canvas.tsx](../components/graph/Canvas.tsx)

Current custom registrations:

- `flow` -> `FlowNode`
- `view` -> `ViewNode`
- `dataModel` -> `DataModelNode`
- `apiEndpoint` -> `ApiEndpointNode`

`dataModel` and `apiEndpoint` remain registered node types for compatibility, but the current project page renderer does not add those species into `visibleNodes`.

`acceptance` nodes and `covers` edges have no custom Canvas registration yet — they render with generic node/edge components, and the map-kind defaults exclude them (see the dated note under the Taxonomy Update Checklist).

Edge registration is also in [components/graph/Canvas.tsx](../components/graph/Canvas.tsx).

## Taxonomy Update Checklist

1. Update config array in `lib/config/*`.
2. Update graph builders and rendering filters in [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts) and [lib/utils/system-graph.ts](../lib/utils/system-graph.ts).
3. Update Canvas registrations in [components/graph/Canvas.tsx](../components/graph/Canvas.tsx).
4. Update forms/panels that branch by species.
5. Update seed data in [seed/pebbles.json](../seed/pebbles.json).
6. Update this document.

2026-07-19 — acceptance/covers: steps 3–4 deferred to the Surfaces plan
(docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md §9);
maps exclude acceptances by default. Step 1 is done ([lib/config/species.ts](../lib/config/species.ts),
[lib/config/edge-types.ts](../lib/config/edge-types.ts)); step 2 needed no
change — `journey` and `system` map kinds' species defaults in
[packages/schema/src/maps.ts](../packages/schema/src/maps.ts) exclude
`acceptance`, so `lib/utils/journey-graph.ts` and `lib/utils/system-graph.ts`
have no acceptance-specific branches. `lib/utils/graph-build.ts` already maps
`acceptance` to React Flow node type `"acceptance"` as a forward-fix
placeholder for when Canvas registration lands. Step 5 is done (seed).

2026-08-02 — products: a product is project metadata, not a species, so this
change touches the checklist sideways. Step 1 is done, but not in
`lib/config/*` — the definitions are *data*
([spec/bundle-format.md](spec/bundle-format.md) § Products), and the config
files stayed untouched precisely because a product is authored per project
rather than compiled in. Step 2 needed no change: membership never joins the
graph builders, it restricts the node list handed to them
(`mapScopedNodes`, [lib/utils/product-scope.ts](../lib/utils/product-scope.ts)),
so [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts) and
[lib/utils/system-graph.ts](../lib/utils/system-graph.ts) have no
product-specific branches. Step 3 needed none either — no new node or edge
type. Steps 5 and 6 are done ([seed/pebbles.json](../seed/pebbles.json) gains a
web-only `admin` product beside the three-platform `app`, so the example
project exercises both arities of the rule below; this document, above). **Step 4 is deferred**: no form or panel writes `metadata.product`
today, so products are authorable only by an agent or by hand-editing a bundle
— the P3 milestone ([rfcs/products.md](rfcs/products.md) § Phased plan) owns
the product manager, the picker in the node forms, and bulk reassignment. Also
deferred: the **per-surface product override**. The global scope in the sidebar
is the whole of it for now; every projection already takes the product as an
argument and every surface already resolves through `useEffectiveProduct`, so
that milestone changes one function to `override ?? global` and adds a control.

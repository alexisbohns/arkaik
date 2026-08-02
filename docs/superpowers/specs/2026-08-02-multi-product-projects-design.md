# Multi-product projects — scope, membership, and platform arity

**Date:** 2026-08-02
**Status:** Approved, ready for planning
**Source RFC:** [`docs/rfcs/products.md`](../../rfcs/products.md) — Option A, recommended and adopted

## Problem

A project today is implicitly **one product with up to three platforms** (`web` / `ios` /
`android`, hardcoded in `PLATFORM_IDS`). Real product graphs are families of apps sharing one
substrate: Pbbls has an end-user app and a web-only Admin; teale has four apps, two of them
web-only; arkaik itself is an app plus a CLI plus an agent plugin, for which "platform" is
meaningless.

Three things break:

1. **Phantom platforms.** An admin view shows iOS and Android tabs it can never have, and reads
   as "missing on iOS" when there is no iOS.
2. **Rollups lie.** Delivery, Pyramid, and the Acceptances matrix aggregate per platform across
   the whole project, so a web-only back office drags down an "Android delivery" number it was
   never part of.
3. **No grouping.** The Library, Journey map, and boards cannot answer "show me the therapist
   app".

The axis conflates two orthogonal dimensions: *which app is this screen part of* (product) and
*which runtime does that app ship on* (platform). Product is an implicit singleton, so platform
absorbed both questions.

## Scope of this spec

The RFC phases the work P0 → P4. **This spec covers P0, P1, and P2** — the spec text, the schema
package, and the read surfaces. It also pulls one small slice of P4 forward: the seed project
gains a product, so the feature is demoable on day one.

**P3 (editing UI) is deferred to a follow-up issue.** Products are project metadata, so agents
can author them through the existing bundle mutation path the moment P1 lands; the seed proves
the path. P3's acceptance criterion is "products are manageable without editing JSON".

## Decisions

Eight decisions, each settled during brainstorming. They are stated here as the design's
premises; the reasoning is preserved because it constrains the implementation.

### 1. Products are project metadata, membership is stored on flows and views

Following `project.metadata.maps` exactly:

```ts
interface ProductDefinition extends Record<string, unknown> {
  id: string;                  // kebab-case, unique within the project
  title: string;
  description?: string;
  platforms: PlatformId[];     // possibly [] — "availability is not tracked here"
  root_node_id?: string;       // this product's journey anchor
}
```

Stored at `project.metadata.products`. Membership is `node.metadata.product?: string`, meaningful
only on `flow`, `view`, and `acceptance`. Data models and API endpoints never carry membership —
theirs is derived, because shared substrate is the norm.

`node.platforms` stays authoritative. Every existing projection keeps reading it unchanged; the
product adds a *constraint* on editing plus a *scope* for reading. That containment is what keeps
this change small.

### 2. Scope is global, in the shell — with per-surface override as the end vision

A product scope selector lives in `ProjectSidebar`, beside `ProjectSwitcher`. Every view respects
it. The alternative — a product filter on each of the five platform-bearing surfaces — was
rejected because the pain is that rollups aggregate across products that should not be
aggregated, which is a scope problem, not a filter problem.

Per-surface override remains the end vision and is deferred to a follow-up issue. Three
implementation constraints exist **now** so that milestone stays cheap:

- **Projections take the product as an argument and never read scope state.** `computeDelivery`,
  `computePyramid`, `filterAcceptances`, and the Library filters gain a `product` parameter. Pure
  functions, per the existing `lib/utils` doctrine. An override is then a different argument, not
  a different code path.
- **Surfaces call one resolver hook**, `useEffectiveProduct()`, never the global scope directly.
  Today it returns the global value; the override milestone changes this one function to
  `override ?? global`.
- **The scope is a value, not a boolean.** `null` means "All products" — a real member of the
  domain that every projection handles explicitly, not an absence to special-case.

**Persistence: localStorage, keyed per project — not the URL.** The scope is a mode spanning
every route; a query param would have to be threaded through all of them while fighting the
existing `species` / `panel` param handling in `app/project/[id]/layout.tsx`. The accepted
trade-off is that a shared link does not carry scope, which is fine because a link to a node is
about the node.

**The selector renders only when the project declares products.** A project with no products
shows no new control and no new concept.

### 3. The arity rule — a surface's shape follows its platform count

Every platform-bearing surface reads the scope's effective platform set and picks its shape from
the **count**, never from the global `PLATFORM_IDS` list:

| Arity | Example | Shape |
|---|---|---|
| ≥ 2 | End-user app (web/iOS/Android) | Per-platform columns or rings, plus the aggregate |
| 1 | Admin (web only) | One status, no platform chrome at all |
| 0 | Public API, CLI | One status — rendered identically to arity 1 |

Arity 1 and 0 collapsing to the same shape is deliberate, not a shortcut. RFC decision 2 says "no
platforms → single status", and a single platform is informationally the same view. The two
differ only in editing and validation, both of which are P3 concerns.

This is the rule that answers the original complaint: scoped to the Admin dashboard, the
Acceptances list shows one status column, not three with two permanently empty.

### 4. At arity ≤ 1 the Pyramid shows a bar, not a lone ring

Today `PyramidElementCard` and `PyramidElementRow` both render `PlatformRingSet`: one aggregate
ring whose **center holds `element.acceptanceCount`**, plus three platform rings. At arity ≤ 1 the
aggregate ring and the single platform ring carry identical numbers, so four rings collapse to
one.

A lone ring beside three-ring cards in another scope reads as *data missing* rather than *absent*.
So arity ≤ 1 renders a single bar (the `PlatformGaugeList` idiom, already arity-aware) with the
acceptance count as text beside it. The bar reads unambiguously as "one track", and it gives the
platform-less case a sensible home: a bar with no platform icon.

### 5. Anchorless acceptances are an intake state, and carry stored membership

An acceptance with zero `covers` edges has nothing to derive membership from. These are not
cross-cutting NFRs floating above every app — they are **ideas in intake**, filed before the
flows and views exist, waiting to be decomposed.

- `metadata.product` on an anchorless acceptance is **expected**, not exceptional. A PM filing
  "therapist can export session notes" knows which app it is for before they know which screens
  it needs.
- Absent membership is a **triage state**, not "applies everywhere". It appears under "All
  products" only, and earns a validator warning — an inbox rather than noise duplicated across
  every scope.
- In a project with no products declared there is nothing to assign, and no warning fires.

An acceptance whose *derived* membership spans two products earns a warning too (RFC decision 3),
never an error: the graph stays importable and the matrix shows it under both scopes.

**Unassigned flows and views follow the same rule.** In a project that declares products, a flow
or view with no `metadata.product` belongs to no product: it appears under "All products" only,
and earns an `unassigned-membership` warning. The alternative — silently defaulting to the
first-declared product — was rejected because it manufactures a membership nobody stated, and the
Delivery denominators would then count that node against platforms its assumed product happens to
declare. Triage-by-visibility is the same treatment anchorless acceptances get, so there is one
rule to remember rather than two.

In a project with no products declared, nothing is unassigned and no warning fires.

The acceptance-first authoring workflow itself — file an idea, later attach it to new views and
flows or split it into several — is a separate feature and out of scope. The model does not block
it: an acceptance can carry membership before it carries a single edge.

### 6. Agents author products; the seed proves it

Products are project metadata, so agents write them through the existing MCP and bundle mutation
paths the moment P1 lands. No new UI is needed for the feature to be real.

`seed/pebbles.json` gains a web-only Admin product plus a handful of reassigned views, so the
multi-platform and single-platform paths are both exercised by the example project.
`seed/arkaik-self-map.json` (app + CLI + plugin, a natural platform-less case) stays out — it is
dogfood, and one seed proves the rule.

### 7. All product validation findings are warnings

`validate.ts` warns on *everything* stored under `project.metadata` — including duplicate map ids
— with the stated rationale that "a stale or dangling map must never fail an import or a CI gate"
(`validate.ts:393`). Product findings follow that precedent without exception.

New rules, all warning-severity:

| Rule id | Fires when |
|---|---|
| `product-duplicate-id` | Two definitions share an `id`; resolution is first-wins |
| `product-invalid-id` | `id` is not kebab-case |
| `product-unknown-reference` | `node.metadata.product` names no declared product — **fires regardless of whether the project declares any**, since membership naming a product that does not exist is a dangling reference either way |
| `product-platform-not-in-menu` | `node.platforms ⊄ product.platforms` |
| `product-membership-wrong-species` | Membership on a data model or API endpoint — **fires regardless of whether the project declares any**, since that species derives membership and must never store it |
| `acceptance-product-unassigned` | Anchorless acceptance with no membership, in a project that declares products |
| `unassigned-membership` | Flow or view with no membership, in a project that declares products |
| `acceptance-covers-span-products` | Derived membership spans two products |

The two rules marked above are local authoring mistakes true in *any* project, so they are not
scoped to projects that declare products — the same reasoning that leaves `gherkin-species` and
`values-species` ungated in `validate.ts`. The motivating case is the author who writes
`metadata.product` on a handful of nodes before adding `project.metadata.products`; gating those
two would make exactly that mistake invisible. The remaining rules stay scoped, because
"unassigned" and "out of menu" have no meaning until something is declared. A project with no
`products` key and no `metadata.product` on any node still raises **zero** product findings.

Containment is a warning rather than an error — unlike rule 16, its structural twin — because
rule 16 compares two fields *on the same node*, so a violation is always a local authoring
mistake. Product containment is cross-object and time-dependent: the same node becomes invalid
because someone edited a *different* object. Narrowing Admin from `[web, ios]` to `[web]` is a
product decision, and it must not fail CI. Every projection degrades safely regardless, because
`effectiveNodePlatforms` intersects — an out-of-menu platform simply drops out of the display, so
an error would buy no safety the intersection does not already provide.

Shape faults (`products` not an array, a definition missing `title`) stay where they belong, in
`parse.ts` and the JSON Schema.

### 8. Scope hides unreached system-layer nodes, but never orphans

Scoped to Admin, the Library shows only the data models and endpoints reachable from Admin's
views — that is what answers "what does the Admin app actually touch?".

One guard: a data model with **no incoming edges** belongs to no product, and hiding it per scope
would bury exactly the nodes that most need attention. Orphans are shown in every scope with an
"unattached" marker.

A "used by: End-user, Admin" badge derived from `productsUsingNode` is worth having on every
system-layer card — it is the cross-product traversal the graph exists to answer — but it
annotates, it does not drive visibility.

## Architecture

### New module: `packages/schema/src/products.ts`

Mirrors `maps.ts` in every respect: pure functions, type-only imports, deliberately **zod-free**
so it stays browser-safe and adds nothing to the standalone validator bundle. Membership checks
treat unknown values as opaque strings — they select nothing rather than throwing.

| Function | Contract |
|---|---|
| `resolveProducts(project)` | Stored definitions in order; non-object entries, blank/whitespace-only ids, and duplicate ids skipped, the last resolving first-wins. Same lenient posture as `resolveMaps`. The blank-id skip matches `validate.ts`'s `.trim()` test, so both modules mean the same thing by "declared". |
| `productOf(node)` | Stored membership, or `null`. Meaningful only for flow/view/acceptance. |
| `buildProductUsageIndex(nodes, edges)` | Builds the `nodeId → sorted product ids` index for the system layer, once per snapshot. Walks **forward** from every membership-bearing node along `calls` / `displays` / `queries`, following each edge in its stored direction and hopping only into `api-endpoint` / `data-model` targets. |
| `productsUsingNode(nodeId, index)` | A plain **lookup** into that index — never a traversal. `[]` for an unknown node, or one no product reaches. |
| `productPlatforms(project, productId \| null)` | **The scope's platform menu**, and the sole input to the arity rule. A `productId` returns that product's list; `null` returns the union of all declared products; a project declaring no products returns `PLATFORM_IDS`. Takes the id rather than the definition because that is what the scope holds; an unknown id resolves like `null`. |
| `effectiveNodePlatforms(node, product)` | `node.platforms ∩ product.platforms`, taking the resolved definition. Returns `node.platforms` unchanged when `product` is `null`. What makes the containment warning degrade safely. |

`MapDefinition` gains an optional `product?: string` filter, so "the therapist app map" is a
stored map rather than a parallel mechanism.

### Degenerate case guarantee

A bundle with no `products` key behaves **exactly as today**: one implicit default product
spanning `PLATFORM_IDS`, every node in it, no scope selector, no warnings. No migration runs.
Old readers ignore the new metadata keys, which open-object round-tripping already guarantees.

This is enforced by test, not by intention: every existing suite must pass unchanged with no
product metadata present.

### One primitive owns the arity rule

A `PlatformAvailability` component takes `platforms: PlatformId[]` and picks the shape — arity ≥ 2
renders the aggregate ring plus per-platform rings; arity ≤ 1 renders a single bar with the count
beside it.

`PlatformRingSet` and `PlatformGaugeList` stop importing the global `PLATFORMS` list and receive
the effective set as a prop. Every consumer then inherits the rule by construction, so it cannot
drift between the Pyramid and the Overview.

### Surface changes

| Surface | Change |
|---|---|
| **Acceptances** | Status columns = effective platforms; at arity ≤ 1, one column and no platform filter. The zero-covers bucket is renamed from "product-level" (now actively wrong) to **"Unanchored"**. Unassigned anchorless acceptances appear only under All products. |
| **Pyramid** | Card and row swap rings for a bar + count at arity ≤ 1. |
| **Delivery** | Board narrows to the scope's nodes, platform columns to the effective set. Under All products, per-platform denominators count only nodes whose product declares that platform. |
| **Library** | Flows and views by stored membership; data models and endpoints by reachability, orphans always visible under an "unattached" marker; a "used by" badge from `productsUsingNode`. |
| **Overview** | `PlatformGaugesCard`, `ParityCard`, `PyramidCard`, `DeliverySnapshotCard` inherit via the primitive and the scoped projections. |
| **Node detail panel** | Platform tabs collapse to the effective set; at arity ≤ 1, no tabs — a single status. |
| **Maps / journey** | Journey root resolves `product.root_node_id` → `project.root_node_id`; `MapDefinition.product` filters the subgraph. |
| **Canvas nodes** | `FlowNode` and `PlatformList` chips show effective platforms. |

Eight surfaces is what makes P2 an M rather than an S. If the work wants splitting, the natural
seam is **primitives + Acceptances + Pyramid** first, then **Library + Delivery + Overview +
maps**.

## Testing

Every piece of this design is pure functions over nodes and edges, which suits the repo's
framework-free, database-free `node` test scripts exactly.

**New — `tests/schema/products.test.js`:**

- `resolveProducts` leniency: non-object entries skipped, duplicates resolve first-wins.
- `productOf` returns membership for flow/view/acceptance and `null` elsewhere.
- `productPlatforms` across all three scope cases: a named product, `null` (union), and a project
  declaring no products (`PLATFORM_IDS`).
- `effectiveNodePlatforms` intersection, including the empty result for a platform-less product.
- `buildProductUsageIndex` forward traversal, including a node reached by two products, an orphan
  reached by none, and a model touched only by Admin that must **not** inherit the end-user app
  through a shared neighbour.
- Unassigned flows, views, and anchorless acceptances warn in a project that declares products,
  and stay silent in one that does not.
- One assertion per new validation rule confirming **warning** severity and that
  `validateBundle().valid` stays `true`.

**Extended:**

- `tests/app/pyramid.test.js` — the arity-≤1 shape.
- `tests/app/delivery.test.js` — the honest-denominator case: a web-only product contributes
  nothing to the Android column.
- `tests/app/acceptance-matrix.test.js` — column collapse, the Unanchored bucket, and unassigned
  acceptances appearing only under All products.

**Regression:** `npm run validate:seeds` passes unchanged, and every existing test passes with no
product metadata present.

**Generators:** `npm run generate` regenerates `schema.md`, the JSON Schema, `llms.txt`, and the
standalone validator, so the CLI picks up the new rules without any P4 work.

**Visual verification.** There is no browser driver in this environment. Static verification, then
a hand-off checklist: Pyramid card and row at both arities; Acceptances column collapse; the scope
selector's absence on a product-less project; the Overview cards under a web-only scope.

## Follow-up issues

1. **P3 — product management UI.** Create, rename, set platforms, delete-with-reassign; product
   picker in node forms; bulk "move to product". Acceptance criterion: products are manageable
   without editing JSON.
2. **Per-surface product override.** The end-vision milestone where `useEffectiveProduct` starts
   honoring a local override, most useful when the global scope is "All products".
3. **Acceptance-first intake.** Filing an idea before it has flows or views, then decomposing it
   into views, flows, or several acceptances. The model supports it; nothing implements it.

## Non-goals

- **White-label / brand variants** of one app — same anatomy, different skin.
- **Market or feature-flag availability** ("live in FR, flagged off in DE") — a different axis.
- **Cross-repo federation** — one project per product with a workspace on top.
- **Opening the platform vocabulary** beyond `web` / `ios` / `android`. Separable follow-up;
  nothing here blocks it.
- **P4's CLI and plugin documentation** of product membership rules.

## Process note

This ships something a user notices, so the PR requires a Lab Note per `CLAUDE.md`. The benefit
line writes itself: your admin app stops pretending it is missing on iOS.

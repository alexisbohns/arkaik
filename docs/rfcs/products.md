---
title: "RFC: Products — multi-product projects"
navTitle: "RFC: Products"
order: 91
---

# RFC: Products — multi-product projects and per-product platform availability

> Status: **Decided and shipped through P2.** [Option A](#a-products-as-project-level-definitions-nodes-carry-membership-platforms-constrained-by-product--recommended)
> was adopted as recommended — products as project-level definitions, membership
> stored on flows and views, derived for acceptances and the system layer,
> platform-less products per decision 2, and the degenerate-case guarantee.
> P0 (spec), P1 (schema package) and P2 (every read surface) have shipped, along
> with P4's dogfood half — the Pebbles seed carries a web-only Admin product, and
> the plugin skill teaches the membership rules. **P3 (editing UI) and the
> per-surface override have not**, so products remain authorable only by an agent
> or by hand-editing a bundle.
> Design spec: [`docs/superpowers/specs/2026-08-02-multi-product-projects-design.md`](../superpowers/specs/2026-08-02-multi-product-projects-design.md).
> Implementation plan: [`docs/superpowers/plans/2026-08-02-multi-product-projects.md`](../superpowers/plans/2026-08-02-multi-product-projects.md).
> Normative format: [`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Products;
> model overview: [`docs/graph-model.md`](../graph-model.md) § Products.
>
> **The rest of this document is left as written** — it is the reasoning record,
> rejected options included, and reads as of the decision rather than of today.
> Source: real projects (Pbbls, Oxymore, teale) whose graphs span several
> apps with different platform availability, which the model could not express.

## Problem

A project today is implicitly **one product with up to three platforms**
(`web` / `ios` / `android`, hardcoded in `PLATFORM_IDS`). Real product graphs
are families of apps sharing one substrate:

| Project | Products | Platforms |
|---|---|---|
| Pbbls | End-user app | web, iOS, Android |
| | Admin app | web only — platform availability is *irrelevant*, but it consumes the same data models |
| Oxymore | End-user product | web, iOS, Android |
| | Author product | web today; iOS/Android *may* come — availability could become relevant later |
| teale | End-user app | web, iOS, Android |
| | Therapist app | web, iOS, Android |
| | HR dashboard | web only |
| | Back office | web only |

And beyond user-facing apps: arkaik itself is an app (web) **plus** a CLI
**plus** an agent plugin — products for which "platform" is meaningless but
which touch the same graph. A public API can be a product with no views at all.

The pain concentrates in three places:

1. **Platform tabs and pickers** show iOS/Android for nodes where those can
   never exist (an admin view), polluting parity signals — an admin view reads
   as "missing on iOS" when there is no iOS.
2. **Rollups lie**: Delivery, Pyramid gauges, and the Acceptances matrix
   aggregate per platform across the whole project, so a web-only back office
   drags down "Android delivery" it was never part of.
3. **No grouping**: the Library, Journey map, and boards cannot answer "show
   me the therapist app".

## What "platform" touches today (inventory)

The platform axis is load-bearing in every layer; any design must account for
each of these:

- **Schema**: `PLATFORM_IDS` closed enum (`packages/schema/src/ids.ts`);
  `node.platforms: PlatformId[]` (min 1, validation rule 14);
  `metadata.platformStatuses` / `platformNotes` / `platformScreenshots`
  (keys ⊆ `node.platforms`, rule 16); `Ref.platform`; journal events
  (`node.status_changed.platform`, `release.tagged.platform`).
- **Projections**: `lib/utils/platform-status.ts` (per-platform effective
  status, flow rollups), `lib/utils/delivery.ts` (node × platform board
  items), `lib/utils/pyramid.ts` (per-platform value gauges),
  `lib/utils/acceptance-matrix.ts` (one status column per platform).
- **UI**: platform tabs in `NodeDetailPanel`, platform chips in Library
  cards, platform chip-row filters on Pyramid and Acceptances.
- **Config**: `lib/config/platforms.ts` (labels + icons).

Key observation: the axis conflates two orthogonal dimensions. "Which app is
this screen part of?" (product) and "which runtime does that app ship on?"
(platform). Today product is an implicit singleton, so platform absorbed both
questions.

## Options

### A. Products as project-level definitions; nodes carry membership; platforms constrained by product — *recommended*

Products are **data on the project**, following the exact precedent of maps
(`project.metadata.maps`):

```jsonc
// project.metadata.products
[
  { "id": "app",     "title": "End-user app", "platforms": ["web", "ios", "android"], "root_node_id": "F-onboarding" },
  { "id": "admin",   "title": "Admin",        "platforms": ["web"] },
  { "id": "api",     "title": "Public API",   "platforms": [] }   // platform-less
]
```

Flows and views store membership as `node.metadata.product: <slug>`.
`node.platforms` **stays authoritative** for the node but must be a subset of
its product's `platforms` (new validation rule). Everything downstream —
delivery, pyramid, matrix, tabs, journal — keeps reading `node.platforms`
unchanged; the product adds a *constraint* on editing plus a *grouping/filter*
dimension. That containment is what keeps the migration small.

Membership is **stored** only where it must be, **derived** everywhere it can
be:

| Species | Membership |
|---|---|
| `flow`, `view` | Stored (`metadata.product`), default product when absent |
| `acceptance` | **Derived** from its `covers` anchors; stored only for product-level acceptances (zero covers edges) |
| `data-model`, `api-endpoint` | **Derived**: "used by products" via incoming `displays` / `queries` / `calls` paths — shared substrate by design, never assigned |

The derivation is a feature, not a compromise: an endpoint card can display
"consumed by: End-user, Admin", which is precisely the cross-product
traversal the graph exists to answer.

**Degenerate-case guarantee**: a bundle with no `products` key behaves
exactly as today — one implicit default product spanning all of
`PLATFORM_IDS`, every node in it. No migration required for existing bundles;
old readers ignore the new metadata keys (open-object round-tripping already
guarantees this).

*Pros*: matches the mental model (it's how the problem was stated); two-level
structure keeps parity semantics clean; tiny storage delta; maps precedent;
derivations avoid double-bookkeeping. *Cons*: a second grouping notion to
teach; every platform-filtering surface eventually wants a product filter too
(that cost is inherent to the problem, not to this option).

### B. Flatten to project-defined "targets" (product × platform as one list)

Replace the closed `PlatformId` enum with per-project target definitions:
`app-web`, `app-ios`, `admin-web`, … each `{ id, label, icon, group }`.
Everything keyed by `PlatformId` re-keys by `TargetId` — mechanical, and the
`group` field lets UIs cluster columns.

*Pros*: one dimension everywhere, no inheritance rules, trivially handles
exotic targets (watchOS, TV, kiosk). *Cons*: denormalizes the cross product —
renaming a product means renaming N targets; parity questions ("is this live
on iOS?") lose their natural axis; `node.platforms` arrays balloon; the
closed→open enum change ripples through the schema, validator, journal, and
every existing bundle at once. It buys generality the stated problems don't
need, at the cost of the axis the Acceptances matrix is built on.

### C. Product as a graph species (membership via edges)

A `product` node species; `belongs-to` edges from flows/views. Graph-native,
agents edit it like anything else, renderable on maps.

*Cons that kill it*: platform inheritance through edge traversal makes
validation and rollups non-local (rule 16 would need graph context); every
node needs an edge to a pseudo-node, bloating bundles; a project-level
configuration masquerading as anatomy. A variant (C′) derives membership from
the compose closure of per-product root anchors — zero storage, but
membership then *changes when composition changes*, and shared views become
ambiguous. Fragile as truth; fine as a display heuristic, which Option A's
per-product `root_node_id` already captures.

### D. One project per product, workspace on top

Clean per-product platform config for free, but it severs exactly the
traversals arkaik exists for: therapist view → shared data model would cross
bundle boundaries that the format, journal, local-first storage, and
import/export all assume away. Cross-bundle edges are a federation-sized
project. Rejected for this problem; noteworthy only as a possible far-future
multi-repo story.

### E. Per-project platform configuration only (no product notion)

Let each project declare its platform list. Necessary hygiene eventually, but
insufficient alone: it cannot express *different* availability per app within
one graph, which is the actual ask. Folded into Option A (the product's
`platforms` array **is** the per-scope platform configuration).

## Cross-cutting decisions (apply to whichever option)

1. **Effective platforms** = the product's `platforms` menu, of which
   `node.platforms` is a subset. A web-only product forces `["web"]` — the UI
   shows a single chip and **no tabs**. This directly answers "no platform
   tabs, or just one web?": one chip, zero per-platform machinery.
2. **Platform-less products** (`platforms: []`) mean "availability is not a
   tracked dimension here" — nodes carry a single lifecycle status, exactly
   like data models and API endpoints do today. What is currently a
   per-species special case becomes the general rule: *no platforms → single
   status*. This is how Pbbls Admin can opt out entirely, and how a CLI or
   API product fits.
3. **Single membership per flow/view**, not an array. The decisive argument:
   `platformStatuses` is keyed by platform only — a view in two products with
   overlapping platforms would conflate "live on web in App A" with "in App
   B". Genuinely shared surfaces are duplicated per product (distinct IDs),
   which keeps every status unambiguous and keeps the parity matrix honest.
   Cross-product acceptances get a validator *warning* when their covers span
   products (revisit if real usage demands it).
4. **Platform vocabulary stays global** (`web` / `ios` / `android`) for now;
   products select subsets. Opening the vocabulary (desktop, watch, TV…) is a
   separable follow-up (it is Option B's good half) and nothing in Option A
   blocks it.
5. **Naming**: "product" collides mildly with "the project is a product's
   anatomy" (vision.md), and alternatives exist (app, surface, audience,
   target). "App" fails for API/CLI products; "target" is overloaded by build
   tooling. **Product** matches how PMs actually speak about admin/back
   office/author, and the docs can absorb "a project maps a product family".
6. **Journey anchors**: `product.root_node_id` generalizes
   `project.root_node_id` — each product anchors its own journey traversal,
   and `MapDefinition` gains an optional `product` filter so "the therapist
   app map" is just a stored map. Products slot into "one graph, many maps"
   as first-class scopes rather than a parallel mechanism.

## Non-goals

- **White-label / brand variants** of one app: same anatomy, different skin —
  do not model as products.
- **Market / feature-flag availability** ("live in FR, flagged off in DE"):
  a different axis; out of scope.
- **Cross-repo federation** (Option D's long-term story).

## Recommendation

**Option A**, with derived membership for acceptances and the system layer,
platform-less products per decision 2, and the degenerate-case guarantee. It
solves all three stated projects (and arkaik's own dogfood), keeps
`node.platforms` as the single axis every existing projection reads, and
lands as additive metadata with no bundle-format break.

## Phased plan

Sizes as in vision.md (S/M/L).

- **P0 — Spec (S)**: `docs/spec/bundle-format.md` § products
  (ProductDefinition, `node.metadata.product`, validation: product slugs
  unique + kebab-case, `node.platforms ⊆ product.platforms`, membership only
  on flow/view/acceptance, covers-span warning). Update `docs/graph-model.md`.
- **P1 — Schema package (M)**: zod types, `validateBundle` rules, projections
  (`productOf`, `productsUsingNode`, `effectivePlatforms`), migration no-op +
  implicit default product. Regenerate `schema.md` / JSON Schema / `llms.txt`.
- **P2 — Read surfaces (M)**: detail-panel tabs collapse per effective
  platforms; product badge + filter in Library; product grouping/filter on
  Delivery, Pyramid, Acceptances matrix; `MapDefinition.product` scope;
  per-product journey anchors.
- **P3 — Editing (M)**: product manager in project settings (create, rename,
  set platforms, delete-with-reassign); product picker in node forms; bulk
  "move to product".
- **P4 — Toolchain & dogfood (S)**: CLI surfaces products in `validate`/`log`;
  plugin skill teaches membership rules; seed Pebbles gains an Admin product
  (web-only) so the degenerate and constrained paths are both exercised by
  the example project.

Each phase is independently shippable; P1 alone makes the format expressive
enough for agents to start recording products even before the app renders
them.

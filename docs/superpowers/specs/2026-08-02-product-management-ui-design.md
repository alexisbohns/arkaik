# Product management UI — design

> Status: **approved**, 2026-08-02. Implements
> [`docs/rfcs/products.md`](../../rfcs/products.md) § Phased plan, **P3** —
> the editing half that P0–P2 deliberately left out.
> Issue: [#314](https://github.com/alexisbohns/arkaik/issues/314).
> Predecessor spec: [`2026-08-02-multi-product-projects-design.md`](2026-08-02-multi-product-projects-design.md).

## Problem

Products are already first-class in the schema and honoured by all eight read
surfaces. They are also **unauthorable by a human**: a product definition lives
in `project.metadata.products` and membership in `node.metadata.product`, so
creating one means hand-editing bundle JSON. The Pebbles seed proves an agent
can do it; a person cannot.

The gap has a sharp edge, found while implementing P2 rather than imagined.
Standing under a named product scope, the Library's "Create node" button opens
`components/panels/NewNodeForm.tsx`, whose `NewNodeFormData` is
`{ title, species, status, platforms, metadata? }` — nothing populates
`metadata.product`. The created node has no membership, and per § Decision 5 an
unassigned flow or view appears under "All products" only. **The node vanishes
from the scope the user is standing in**, with no explanation. The same form
serves the Delivery page, the Acceptances page, `JourneyMap` and `SystemMap`.

**Acceptance criterion:** products are manageable without editing JSON.

## Decisions

Each was taken explicitly during brainstorming; the rejected alternative is
recorded because the reasoning is the point.

### D1 — The create form prefills to the current scope, visibly and editably

The picker opens pre-filled with the scoped product, plainly shown, and the user
may change or clear it. Ambient state becomes a **visible default** rather than a
silent stamp.

*Rejected:* leaving it empty and warning on submit adds friction to every create
for a case the default handles. Prefilling and **locking** while scoped is a
simpler mental model but makes it impossible to create an admin view while
looking at the end-user app — a real thing to want, and there is no other way to
do it.

### D2 — `product.id` is auto-slugged on create and immutable thereafter

The id derives from the title (kebab-case, de-duplicated); renaming changes only
`title`. Nothing ever rewrites `metadata.product` across nodes.

*Rejected:* an editable id needs a multi-node membership rewrite that can
half-fail, leaving a graph where some members point at the old key and some at
the new. The id is near-invisible to the user; the title is the thing they read.

### D3 — Deleting a product reassigns in the confirmation dialog

The dialog names how many nodes hold the membership and offers *move them to
‹product›* or *leave unassigned*. Both branches are one computed plan.

*Rejected:* always leaving members unassigned silently drops data the user may
not know they had. Blocking deletion while members exist forces exactly the
tedium the bulk-move tool exists to remove.

### D4 — The node form constrains platform choice to the product's menu

Once a product is chosen, platform toggles outside its `platforms` menu are
unavailable, and switching product prunes a selection that no longer fits. This
prevents *new* violations of the containment rule at the source.

The rule stays a **warning** in the validator, not an error — narrowing a
product's platforms is a product decision and must never fail CI — so the
manager still permits narrowing below what members use, and says so inline.
Existing violations are reported, never rewritten.

*Rejected:* allowing silently means the user watches platforms disappear at
render time (`effectiveNodePlatforms` drops them) with no explanation.

### D5 — An acceptance's picker shows always, and explains when anchors override

Membership for an acceptance is **derived from its `covers` anchors**; the stored
`metadata.product` is the answer only when it covers nothing (the intake case).
The editor therefore always shows the control, but when anchors exist it renders
the derived product(s) as the live answer and marks the stored value as the
fallback it is.

*Rejected:* hiding the control the moment a `covers` edge appears makes a field
materialise and vanish as edges change. Treating it as a plain editable field
lets a user set a value the graph silently ignores — the exact confusion
`productsOfAcceptance` was written to prevent.

### D6 — Library selection is a general mechanism; the move acts on the subset it can

Checkbox multi-select is built as a reusable Library affordance whose first
action is "Move to product". Data models and API endpoints **derive** membership
and cannot be moved, but their checkboxes are not disabled — that would tie a
general selection mechanism to one action. Instead the bar names the subset:
*"moves 3 of 5 selected; data models and endpoints derive their product"*.

The move menu offers every declared product **plus Unassigned**, so pulling nodes
back out of a product is possible without JSON — which the acceptance criterion
implies.

### D7 — The manager edits title, description and platforms only

`root_node_id` is **not** exposed. See § Known gaps.

## Architecture

Rules live in a pure module; components stay thin. This is the doctrine
[`lib/utils/product-scope.ts`](../../../lib/utils/product-scope.ts) already
follows, and it is the only shape unit-testable on a machine with no local
Postgres — the same reason `tests/app/product-scope.test.js` exists.

### 1. `lib/utils/product-editing.ts` — the rules

Pure, React-free, provider-free. Every rule written exactly once.

| Function | Answers |
|---|---|
| `deriveProductId(title, existingIds)` | Kebab-case slug, de-duplicated with a numeric suffix. A blank or non-latin title falls back to `product-N`, because `resolveProducts` **drops blank ids** and a product that cannot be resolved is not a product. |
| `upsertProduct(products, draft)` | The `metadata.products` array in, a new array out. Declaration order is preserved — it is the order `ProductScopeSelector` renders. |
| `removeProduct(products, id)` | Same shape, definition removed. |
| `membersOfProduct(nodes, productId)` | Nodes whose **stored** `metadata.product` names it. Stored, never derived: those are the only nodes a deletion could orphan. |
| `planProductDeletion(products, nodes, id, reassignTo)` | `{ products, reassignments: [{ nodeId, product }] }`. |
| `planProductMove(nodes, ids, productId \| null)` | The same reassignment shape, for the bulk bar. `null` **removes** the key rather than storing an empty string — a blank membership is not a declaration. |
| `platformMenuFor(product)` | The product's `platforms`; all of `PLATFORM_IDS` when the node is unassigned or the project declares no products. |
| `constrainPlatforms(selected, menu)` | `selected ∩ menu`, ordered by `PLATFORM_IDS`. |

Computing a whole plan before any write is what makes the two-store execution a
single reviewable step, and what lets the destructive path be tested without a
DOM or a database.

`platformMenuFor` returning `[]` for a platform-less product is load-bearing: the
node form then shows **no platform toggles at all** and a single status field.
That is RFC decision 2 — *no platforms → single status* — arriving in the editor
the same way it already arrives in the read surfaces.

### 2. `lib/utils/apply-product-plan.ts` — the one two-store write

Takes a plan and executes it against `updateProject` (the definitions) and
`applyMutations` (the memberships). Deletion and bulk move both go through it, so
the ordering and failure handling of a write that spans both stores is written
once rather than twice.

### 3. `components/settings/ProductManagerPanel.tsx`

A third `<section>` in [`app/project/[id]/settings/page.tsx`](../../../app/project/[id]/settings/page.tsx),
above Danger zone. Rows carry title, description, platform chips and member
count, each with Edit and Delete. The empty state explains what a product is and
offers **Add product**.

- **Create / edit dialog** — title, description, platform toggles. The derived
  slug renders as muted secondary text and is fixed after create (D2).
- **Delete dialog** — member count plus *move to ‹product›* / *leave unassigned*
  (D3), executed as one plan.
- **Narrowing platforms** below what members use is permitted and shows an inline
  note naming the affected count (D4).

### 4. `components/panels/ProductPicker.tsx`

One select, three consumers. It **renders only when the project declares
products** and the species stores membership (`PRODUCT_MEMBERSHIP_SPECIES`). A
project that never heard of products sees no new control anywhere — the same
opt-in guarantee `ProductScopeSelector` already keeps, and the reason the
degenerate case stays byte-identical to today.

- **`NewNodeForm`** gains `products` and `defaultProductId`, threaded from
  `scope` at all five call sites. Prefilled to the current scope (D1). Changing
  species away from a membership-bearing one drops `metadata.product` from the
  payload; changing product runs `constrainPlatforms` over the toggles (D4).
- **`NodeDetailPanel`** gets the same picker on its edit path, so membership is
  changeable per node.
- **`AcceptanceEditor`** renders it per D5.

### 5. Library bulk move

Selection state on [`app/project/[id]/library/page.tsx`](../../../app/project/[id]/library/page.tsx),
a checkbox on `NodeCard` and `NodeTable` rows, and a selection bar with the
count, Clear, and **Move to product** (D6). Executed via `applyProductPlan` in
one write.

## Data flow

```
ProductManagerPanel ─┐
LibrarySelectionBar ─┼─► product-editing (pure plan) ─► apply-product-plan ─► updateProject
ProductPicker ───────┘                                                     └► applyMutations
```

No component computes a rule; no rule touches a store.

## Testing

Everything in `product-editing.ts` is unit-tested beside
`tests/app/product-scope.test.js` — DB-free by construction:

- slug derivation, collision suffixing, and the blank-title fallback;
- `planProductDeletion` for both branches, including a product with no members;
- `planProductMove` clearing a key rather than blanking it;
- `constrainPlatforms` at the arity-0 and arity-1 boundaries;
- the degenerate case: with no products declared, no plan changes anything.

Components get static review plus a manual checklist for Alexis — there is no
browser driver in this environment, so a visual pass is handed over rather than
asserted.

## Known gaps

**`root_node_id` stays JSON-only** (D7). `resolveJourneyAnchorId` deliberately
refuses to fall back to `project.root_node_id` under a named scope — handing
Admin the end-user app's front door would walk a foreign compose chain under
Admin's name. So a product created through this UI has **no journey anchor**, and
its Journey page renders the empty state saying so. That is a real hole in
"manageable without editing JSON" and deserves its own follow-up issue: a node
picker for the product's anchor, reusing `NodeSearchCombobox`.

**Per-surface product override** remains deferred, as it was in P2.

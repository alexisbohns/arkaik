# Per-surface product override

**Date:** 2026-08-03
**Status:** Approved, ready for planning
**Issue:** [#315](https://github.com/alexisbohns/arkaik/issues/315)

## Problem

The product scope selector lives in `ProjectSidebar` and is **global**: one value, persisted per
project in localStorage, honoured by every surface under `/project/[id]`. That was the right first
shape — the pain products solve is that rollups aggregate across apps that should not be aggregated,
which is a scope problem rather than a per-surface filter problem
(`2026-08-02-multi-product-projects-design.md` § Decision 2).

What is missing is the ability to **narrow further on one surface**. The motivating case: the global
scope is "All products", and you want the Delivery board on Admin alone without losing the shell-wide
view everywhere else.

Three constraints were put in place during that milestone specifically to keep this one cheap, and
they hold today:

- **Projections take the product as an argument and never read scope state.** `computeDeliveryItems`,
  `computePyramid`, `filterAcceptances` and the Library filters all receive it. An override is a
  different argument, not a different code path.
- **Every surface resolves through one hook** — `useEffectiveProduct` in
  `lib/hooks/useProductScope.ts`. Its own docstring records the contract.
- **The scope is a value, not a boolean.** `null` means "All products", a real member of the domain
  that every projection handles explicitly.

## Intent

A product control on the four surfaces where cross-product aggregation actually distorts what you
read, storing its value in the URL, able to narrow the global scope and never to widen or sidestep
it.

## Decisions record

### 1. Four surfaces: Delivery, Pyramid, Acceptances, Library

Eight surfaces call `useEffectiveProduct`. Four get the control.

The three rollup surfaces — **Delivery**, **Pyramid**, **Acceptances** — are where the aggregation
problem is felt directly, and the issue names them. **Library** joins them because browsing the
catalogue for one app is a real act: "which data models does Admin actually own" is a question you
ask of the catalogue, not of a rollup.

**Overview** and the **maps** are excluded, for different reasons.

Overview is a summary of the project, and a summary that silently describes one app under the
project's name is worse than no control.

The maps already have a per-surface product answer: `mapProductId` (`lib/utils/product-scope.ts`)
resolves a saved map's own stored `product` **ahead of** the global scope, and the reasoning for that
precedence — a map titled "Admin systems" must show admin whatever the sidebar says — is recorded in
that function. Adding a second override control to a map surface would put two per-surface mechanisms
on one screen, and every ordering between them contradicts something already decided.

### 2. Narrow only — the control does not render under a named global scope

When the sidebar says "All products", the control offers All products plus every declared product.
When the sidebar names a product, **the control does not render at all**.

This is the whole of the rule, and it buys three things. There is exactly one direction of travel, so
the sidebar can never lie about what you are looking at — whatever it names is at least as wide as
what you see. There is no tri-state to encode: absent means All products, present means that product.
And there is no "follow the sidebar" option to explain, which is the affordance the alternative
designs all needed and none of them made readable in a select trigger.

The rejected alternatives were **full freedom** (any surface may widen to All products or sidestep to
another product while the sidebar is narrowed) and **any product, no widening**. Both make a surface
show content the shell says you are not looking at, and both require the trigger to visibly announce
that it is overriding — a second piece of chrome to carry a case that has no motivating example.

### 3. The URL, not localStorage

`?product=<id>` on the surface's own route. Absent means All products.

Shareable is the point: "look at Admin's board" is a link, and the per-surface override is exactly the
kind of momentary framing you send to someone. It also survives reload and back/forward for free.

This deliberately differs from the global scope, which is **not** a URL param and for a stated reason
(§ Decision 2 of the products design): the global scope spans every route, so a param would have to be
threaded through all of them while fighting the existing `species` / `panel` handling in
`app/project/[id]/layout.tsx`. The override does not span routes — that is what makes it per-surface —
so the objection does not transfer.

**Navigation drops it for free.** Sidebar nav links carry no query string, and `layout.tsx` preserves
params only for Library when switching projects. So walking from Delivery to Pyramid leaves the
override behind, which is precisely the per-surface behaviour.

localStorage-per-surface was rejected: an override that survives for weeks is an invisible sticky
narrowing, and the only thing on screen to explain a half-empty board is a control the reader has no
reason to look at.

### 4. An undeclared `?product=` is ignored, not applied

An override naming a product the project does not declare falls back to All products.

Two routes make this reachable without anyone doing anything strange: a link shared into a different
project, and Library's own params, which `layout.tsx:76-81` carries across a project switch. Applying
a stale id would filter to nothing, and an empty surface arrived at by someone else's link cannot
explain itself.

**Known asymmetry, deliberately not fixed here.** A stale *localStorage* global scope behaves the
other way: `resolveProductScope` keeps the unrecognised `productId`, so every surface filters to
nothing while `ProductScopeSelector`'s trigger reads "All products" — the selector degrades its own
display but not the scope. That is pre-existing, it changes behaviour on all eight surfaces, and it
is out of scope for this issue. Recorded here so the difference between the two paths is a decision
rather than an accident.

**And it stays in the URL.** After a project switch the param still reads `product=admin` while
the control displays All products, because nothing rewrites it — the same non-healing the
control relies on when the global scope is named. The tail is that a project which *later*
declares a product called `admin` silently narrows on the next load. That is the same trade-off
recorded above for a stale localStorage scope, and it resolves the same way: restoring a choice
the user made is the better failure.

## Architecture

### The rule, as one pure function

`lib/utils/product-scope.ts` gains:

```ts
export function resolveEffectiveProductId(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  globalId: string | null,
  rawOverride: string | null | undefined,
): string | null
```

1. `globalId !== null` → `globalId`. The shell wins; narrow-only means an override cannot exist here.
2. `rawOverride` is not a declared product (absent, blank, unknown, non-string) → `null`.
3. → `rawOverride`.

This resolves to **`global ?? override`**, not the `override ?? global` the issue predicted. That is
what narrow-only means: an override is only ever legitimate when `globalId` is `null`, so the two
formulas agree wherever one exists — and `global ?? override` additionally makes a stale param inert
instead of load-bearing, which is what Decision 4 needs and what makes § "Deliberate non-healing"
below safe.

It is a pure function over the bundle, so `tests/app/product-scope.test.js` pins every branch with no
React, no browser and no database.

A companion predicate answers whether the control renders:

```ts
export function canOverrideProduct(bundle, globalId): boolean
  // globalId === null && productScopeOptions(bundle).length > 0
```

Written next to the rule rather than inside the component, for the same reason
`platformAvailabilityShape` is: it is the degenerate-case guarantee — a project that has never
declared a product shows no new control — and it is worth asserting in a test rather than eyeballing.

### The hooks

`useEffectiveProduct` keeps its signature and reads the param itself:

```ts
const { productId: globalId } = useProductScope(projectId);
const raw = useSearchParams().get("product");
const effectiveId = resolveEffectiveProductId(project, globalId, raw);
const scope = useMemo(() => resolveProductScope(project, effectiveId), [project, effectiveId]);
```

**Reading the URL inside the hook rather than threading an argument is the load-bearing choice here.**
`DeliveryFilterBar.tsx:50`, `AcceptanceFilterBar.tsx:35` and `AcceptanceMatrix.tsx:49` each call
`useEffectiveProduct` themselves rather than taking their page's scope as a prop. An override that
reached the page but not the bar would leave the board filtered to Admin while the bar still offered
the union platform menu — a disagreement with no crash and no visible cause. Reading one URL from one
hook makes divergence unrepresentable. The alternative — an explicit `overrideId` argument — is more
honest about provenance and was rejected on exactly that failure mode: three components must each be
remembered, and forgetting one is silent.

The cost is that a hand-typed `?product=` also applies on Overview and the maps, where no control
offers it. It is reachable only by editing the URL: the param is produced by four controls and dropped
by navigation. On a map it would act as the scope half of `mapProductId`, i.e. as the default for a
map that declares no product of its own — which is that function's documented behaviour for the global
scope already.

A second hook owns the **write**:

```ts
export function useProductOverride(projectId, project): {
  canOverride: boolean;
  overrideId: string | null;
  setOverride: (next: string | null) => void;
}
```

`setOverride` calls `router.replace` with `scroll: false`, rebuilding the query from the current
`searchParams` so `species` and `panel` survive, and **deleting** `product` for All products rather
than writing a sentinel. Only the control calls this hook.

### The control

`components/layout/ProductOverrideSelector.tsx` — renders `null` when `canOverride` is false, which
covers both "no products declared" and "the sidebar is already narrowed" in one condition.

`ProductScopeSelector` and this one are the same select with different chrome, and two things inside
them must not drift: the two-line item rendering (with its `textValue` / `aria-hidden` handling of the
secondary line) and the `__all__` sentinel that stands in for `null`, which exists because Radix
reserves the empty string for "no selection". So the item list is extracted into a shared
`ProductSelect` primitive taking `value`, `onChange`, `options` and the trigger's class names; the
sidebar and the filter bars pass their own chrome. Same reasoning as `productDisplayTitle` being
written once: two copies of a display rule stay in sync exactly until one of them does not.

### Placement — inside each surface's own bar

Not the `PageHeader` `headerExtra` slot: the control composes with the platform, species and search
controls beside it, and the reader who narrows to Admin is mid-filtering, not reframing the app. All
four surfaces have a bar to host it, and it goes first in each:

| Surface     | Host                                  | Props needed           |
| ----------- | ------------------------------------- | ---------------------- |
| Delivery    | `DeliveryFilterBar`                   | already has both       |
| Acceptances | `AcceptanceFilterBar`                 | already has both       |
| Pyramid     | `PyramidToolbar` (in `StickyToolbar`) | `projectId`, `project` |
| Library     | `LibraryFilterBar`                    | `projectId`, `project` |

Pyramid's page currently renders `<PageShell title="Value pyramid">` with no bundle wiring of its own
beyond `useProject`, and Library's bar takes only search and display mode; both gain the two props.

### Deliberate non-healing

Changing the sidebar to a named product while `?product=admin` is set: the control disappears, the
param goes inert, and **nothing rewrites the URL**. Returning to All products restores the surface
override.

This is `ProductScopeSelector`'s own recorded reasoning — restoring a choice the user made is the
better failure, and a control that writes state as a side effect of rendering is worse than a stale
value. It is only safe because rule 1 of `resolveEffectiveProductId` makes the param inert rather than
merely hidden: a design where the control was hidden but the param still applied would show a narrowed
surface with nothing on screen to explain it.

### Pyramid's click-through carries the override

`app/project/[id]/pyramid/page.tsx:126` links each element to
`/project/${id}/acceptances?value=${element.value}`. With an override on Pyramid that link drops it —
narrow to Admin, click through, land on every product's acceptances. The href carries `product` when
the Pyramid has one. It is the one cross-surface link between two surfaces that both own the control,
and the only place where "navigation drops the param" is the wrong answer.

## Testing

`tests/app/product-scope.test.js` (pure, DB-free, runs in CI's fast build job):

- `resolveEffectiveProductId` — named global wins over a valid override; named global wins over a junk
  override; `null` global with a declared override returns it; `null` global with an undeclared,
  blank, `null` or non-string override returns `null`; `null` global with no override returns `null`.
- `canOverrideProduct` — false for a project declaring no products (both global values); false under a
  named global scope; true only for `null` global with declared products.

Components are not test-exercisable in this repo, which is why both rules live in `lib/utils` rather
than inside the control — the same argument `platformAvailabilityShape` records.

## Non-goals

- Widening or sidestepping the global scope from a surface (§ Decision 2).
- The control on Overview or the maps (§ Decision 1).
- Fixing the stale-localStorage global scope asymmetry (§ Decision 4).
- Making the global scope shareable.

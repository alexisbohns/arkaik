# Per-Surface Product Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Delivery, Pyramid, Acceptances and Library a product control that can narrow the global scope — never widen it — stored as `?product=` on the surface's own route.

**Architecture:** One pure function, `resolveEffectiveProductId(bundle, globalId, rawOverride)`, holds the entire rule and resolves to `global ?? override`. `useEffectiveProduct` reads `?product=` itself so a page and its filter bar can never disagree. A second hook, `useProductOverride`, owns the URL write and the "may this surface override?" predicate. The control renders only when the sidebar says All products **and** the project declares products.

**Tech Stack:** Next.js App Router (client components), React 19, TypeScript, Radix `Select` via `components/ui/select`, hand-rolled Node assertion tests (`tests/app/*.test.js`) — no test framework, no browser, no database.

**Spec:** `docs/superpowers/specs/2026-08-03-per-surface-product-override-design.md`

---

## Orientation for someone new to this repo

Read these before starting. They are short and they contain the reasoning the tasks below assume:

- `lib/utils/product-scope.ts` — the pure layer. Every function takes the product as an **argument** and never reads scope state. That is the constraint that makes this milestone cheap; do not break it.
- `lib/hooks/useProductScope.ts` — three hooks. `useProductScope` (the global value, in localStorage), `useEffectiveProduct` (what every surface calls), `useProductList`.
- `components/layout/ProductScopeSelector.tsx` — the sidebar control this milestone gets a sibling for.
- `docs/superpowers/specs/2026-08-03-per-surface-product-override-design.md` — the decisions.

**Testing idiom.** There is no Jest, no Vitest, no component test runner. `tests/app/product-scope.test.js` is a plain Node script: it transpiles the TypeScript modules to CommonJS via `tests/app/load-product-scope.js`, then runs `assert(condition, message)` calls that print `PASS:`/`FAIL:` and `process.exit(1)` if any failed. React components and hooks **cannot** be tested here — that is exactly why the rules in this plan live in `lib/utils` as pure functions rather than inside the control.

**Verification commands** used throughout:

| Command | Purpose | Baseline on a clean tree |
| --- | --- | --- |
| `npm run test:product-scope` | The pure-logic suite | `All product-scope tests passed` |
| `npx tsc --noEmit` | Typecheck (~5s) | no output |
| `npm run lint` | ESLint | `✖ 4 problems (0 errors, 4 warnings)` |
| `npm run build` | Next production build | succeeds |

Those 4 pre-existing lint warnings are not yours. Do not "fix" them; do not add a fifth.

---

## File structure

**Created:**

| File | Responsibility |
| --- | --- |
| `components/layout/ProductSelect.tsx` | The shared select body: `__all__` sentinel, two-line items, `textValue`/`aria-hidden` handling. Chrome comes from props. |
| `components/layout/ProductOverrideSelector.tsx` | The per-surface control. Renders `null` when the surface may not override. |

**Modified:**

| File | Change |
| --- | --- |
| `lib/utils/product-scope.ts` | `+ PRODUCT_OVERRIDE_PARAM`, `+ resolveEffectiveProductId`, `+ canOverrideProduct` |
| `lib/hooks/useProductScope.ts` | `useEffectiveProduct` reads the param; `+ useProductOverride` |
| `components/layout/ProductScopeSelector.tsx` | Rebuilt on `ProductSelect`; no behaviour change |
| `components/delivery/DeliveryFilterBar.tsx` | Hosts the control |
| `components/acceptances/AcceptanceFilterBar.tsx` | Hosts the control |
| `components/pyramid/PyramidToolbar.tsx` | Hosts the control; `+ projectId`, `+ project` props |
| `components/library/LibraryFilterBar.tsx` | Hosts the control; `+ projectId`, `+ project` props |
| `app/project/[id]/pyramid/page.tsx` | Passes the new props; click-through href carries `product` |
| `app/project/[id]/library/page.tsx` | Passes the new props |
| `components/acceptances/acceptance-filters.ts` | Docstring correction |
| `app/project/[id]/delivery/page.tsx` | Comment correction |
| `tests/app/product-scope.test.js` | New assertions |

---

## Task 1: The rule, as a pure function

**Files:**
- Modify: `lib/utils/product-scope.ts` (add after `productScopeOptions`, ~line 179)
- Test: `tests/app/product-scope.test.js`

- [x] **Step 1: Write the failing test**

Open `tests/app/product-scope.test.js`. Add `resolveEffectiveProductId` and `canOverrideProduct` to the destructured import from `loadProductScope()` at the top (the list starting `platformAvailabilityShape,`).

Then add this block **before** the `fs.rmSync(BUILD_DIR, ...)` line near the end of the file. The fixture names `ENDUSER` / `ADMIN` / the bundle already exist above in that file — reuse them; do not redeclare them.

```js
// --- Per-surface override (issue #315) ---------------------------------------
//
// One rule, three branches. The load-bearing one is the first: a named global
// scope wins outright, which is what "narrow only" means and what makes a stale
// `?product=` inert rather than merely hidden.

assert(
  resolveEffectiveProductId(BUNDLE, "admin", "enduser") === "admin",
  "a named global scope wins over an override — narrow only, never sidestep",
);

assert(
  resolveEffectiveProductId(BUNDLE, "admin", "nonsense") === "admin",
  "a named global scope wins over a junk override too",
);

assert(
  resolveEffectiveProductId(BUNDLE, null, "admin") === "admin",
  "under All products, a declared override applies",
);

assert(
  resolveEffectiveProductId(BUNDLE, null, "nonsense") === null,
  "an override naming a product this project does not declare is ignored, not applied",
);

assert(
  resolveEffectiveProductId(BUNDLE, null, null) === null &&
    resolveEffectiveProductId(BUNDLE, null, undefined) === null &&
    resolveEffectiveProductId(BUNDLE, null, "") === null &&
    resolveEffectiveProductId(BUNDLE, null, "   ") === null,
  "absent, empty and blank overrides are all just All products",
);

assert(
  resolveEffectiveProductId(undefined, null, "admin") === null,
  "before the bundle loads nothing is declared, so no override can apply",
);

assert(
  canOverrideProduct(BUNDLE, null) === true,
  "All products over a project with products: the control renders",
);

assert(
  canOverrideProduct(BUNDLE, "admin") === false,
  "a named global scope hides the control — there is nothing it could narrow to",
);

assert(
  canOverrideProduct(NO_PRODUCTS, null) === false && canOverrideProduct(NO_PRODUCTS, "admin") === false,
  "a project declaring no products shows no new control, whatever the scope",
);
```

The two fixtures this block needs. Check whether the file already defines a bundle holding `ENDUSER` and `ADMIN`; if it does, alias it (`const BUNDLE = <existing>;`) rather than building a second one. Add whatever is missing next to the existing fixture block near the top:

```js
const BUNDLE = { project: { metadata: { products: [ENDUSER, ADMIN] } } };
const NO_PRODUCTS = { project: { metadata: {} } };
```

- [x] **Step 2: Run the test and watch it fail**

```bash
npm run test:product-scope
```

Expected: `TypeError: resolveEffectiveProductId is not a function`. If instead you see `FAIL:` lines, the functions already exist and you are on the wrong branch — stop and check.

- [x] **Step 3: Implement**

In `lib/utils/product-scope.ts`, insert after `productScopeOptions` (which ends around line 179, just before the `/** Anchor ids an acceptance covers */` comment):

```ts
/* --- Per-surface override ----------------------------------------------------
 *
 * A surface may narrow the shell's scope and may never widen or sidestep it
 * (docs/superpowers/specs/2026-08-03-per-surface-product-override-design.md
 * § Decision 2). Both rules are pure functions here rather than logic inside the
 * control, because no component in this repo can be exercised by a test.
 */

/** The query param a surface stores its override in. Written once. */
export const PRODUCT_OVERRIDE_PARAM = "product";

/**
 * **The product a surface actually reads through** — the shell's scope, then
 * the surface's own override.
 *
 * This resolves to `global ?? override`, which is the opposite order to the one
 * issue #315 predicted (`override ?? global`), and deliberately. Narrow-only
 * means an override is only ever legitimate while `globalId` is `null`, so the
 * two formulas agree wherever one exists — and this order additionally makes a
 * leftover param **inert** rather than load-bearing. That is what lets the
 * control disappear under a named scope without rewriting the URL: a design
 * where the control was hidden but the param still applied would show a
 * narrowed surface with nothing on screen to explain it.
 *
 * An override naming a product the project does not declare is **ignored**, not
 * applied. Two routes reach that without anyone doing anything strange — a link
 * shared into a different project, and Library's own params, which
 * `app/project/[id]/layout.tsx` carries across a project switch. Applying a
 * stale id would filter to nothing, and an empty surface arrived at by someone
 * else's link cannot explain itself.
 *
 * Note this differs from a stale *localStorage* global scope, which
 * `resolveProductScope` still keeps and still filters by. That asymmetry is
 * pre-existing and out of scope for #315; it is recorded in the spec's
 * § Decision 4 so the difference stays a decision rather than an accident.
 */
export function resolveEffectiveProductId(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  globalId: string | null,
  rawOverride: string | null | undefined,
): string | null {
  if (globalId !== null) return globalId;
  const candidate = declared(rawOverride);
  if (candidate === undefined) return null;
  return resolveProducts(bundle?.project).some((product) => product.id === candidate) ? candidate : null;
}

/**
 * May this surface offer an override at all?
 *
 * Two conditions, one predicate: the shell must be showing All products (there
 * is nothing a named scope could narrow *to* that is not itself), and the
 * project must declare products. The second half is the degenerate-case
 * guarantee — a project that has never declared a product shows no new control
 * and no new concept — and it is `productScopeOptions` rather than a second
 * count of the same thing, so the control cannot render for a project the
 * sidebar selector considers empty.
 */
export function canOverrideProduct(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  globalId: string | null,
): boolean {
  return globalId === null && productScopeOptions(bundle).length > 0;
}
```

`declared()` is the existing private helper further down the file (a value counts only when it is a non-blank string). Function declarations hoist, so calling it from above its definition is fine — this is the same helper the map precedence chain uses, and reusing it is what keeps "blank means absent" one rule.

- [x] **Step 4: Run the test and watch it pass**

```bash
npm run test:product-scope
```

Expected: the ten new `PASS:` lines, then `All product-scope tests passed`.

- [x] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [x] **Step 6: Commit**

```bash
git add lib/utils/product-scope.ts tests/app/product-scope.test.js
git commit -m "feat(products): resolve a surface's effective product, narrow-only (#315)"
```

---

## Task 2: The hooks

**Files:**
- Modify: `lib/hooks/useProductScope.ts`

No test: these are React hooks and this repo has no component runner (`tests/app/load-product-scope.js` says so in its own docstring). Everything testable was extracted in Task 1 for exactly this reason. Verification is typecheck plus lint.

- [x] **Step 1: Rewrite `useEffectiveProduct` to read the param**

Replace the imports at the top of `lib/hooks/useProductScope.ts`:

```ts
"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProductDefinition } from "@arkaik/schema";
import type { ProjectBundle } from "@/lib/data/types";
import {
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
} from "@/lib/utils/product-scope-store";
import {
  canOverrideProduct,
  PRODUCT_OVERRIDE_PARAM,
  resolveEffectiveProductId,
  resolveProductScope,
  type ProductScope,
} from "@/lib/utils/product-scope";
```

Then replace the whole of `useEffectiveProduct` (its docstring included — the old one promises `override ?? global` and is now wrong) with:

```ts
/**
 * What every surface calls — never `useProductScope` directly.
 *
 * The shell's global scope, narrowed by the surface's own `?product=` override
 * when it has one. The precedence and the validation are
 * `resolveEffectiveProductId`'s, written once and testable;
 * nothing about the rule lives here.
 *
 * **It reads the URL itself rather than taking the override as an argument, and
 * that is load-bearing.** `DeliveryFilterBar`, `AcceptanceFilterBar` and
 * `AcceptanceMatrix` each call this hook themselves rather than taking their
 * page's scope as a prop. An override that reached the page but not the bar
 * would leave the board filtered to Admin while the bar still offered the union
 * platform menu — a disagreement with no crash and no visible cause. One URL
 * read from one hook makes that unrepresentable. The cost is that a hand-typed
 * `?product=` also applies on Overview and the maps, where no control offers it;
 * it is reachable only by editing the URL, since the param is produced by four
 * controls and dropped by navigation.
 *
 * Memoized because the result carries a `Map` and feeds the `useMemo`
 * dependency lists of the scoped projections on Acceptances, Pyramid, and
 * Delivery. An object rebuilt every render would defeat every one of them.
 */
export function useEffectiveProduct(
  projectId: string,
  project: ProjectBundle | undefined,
): ProductScope & { setScope: (next: string | null) => void } {
  const { productId: globalId, setScope } = useProductScope(projectId);
  const searchParams = useSearchParams();
  const productId = resolveEffectiveProductId(project, globalId, searchParams.get(PRODUCT_OVERRIDE_PARAM));
  const scope = useMemo(() => resolveProductScope(project, productId), [project, productId]);
  return useMemo(() => ({ ...scope, setScope }), [scope, setScope]);
}
```

`setScope` still sets the **global** scope — the sidebar selector is its only caller and this milestone does not change that.

- [x] **Step 2: Add the write hook**

Append to the same file, after `useEffectiveProduct`:

```ts
/**
 * The per-surface override's **write** side, and the only hook that has one.
 *
 * Read/write split on purpose: every surface reads the override through
 * `useEffectiveProduct` (which is why it cannot diverge), and only the four
 * controls in `ProductOverrideSelector` may move it.
 *
 * `setOverride` rebuilds the query from the live params rather than replacing
 * it, so `species`, `panel` and the acceptance filters survive a scope change;
 * and All products **deletes** the key rather than writing a sentinel, so the
 * absence of an override is the absence of a param. `replace` (not `push`) with
 * `scroll: false`, matching `useAcceptanceFilters` — narrowing a surface is not
 * a navigation and must not eat the back button.
 *
 * `overrideId` is what the control should display. It is `null` — All products —
 * whenever the param is absent, blank, unrecognised, or overruled by a named
 * global scope, because a trigger that echoed a value the surface is not
 * actually using would be the one thing on screen lying about the content
 * beneath it.
 */
export function useProductOverride(
  projectId: string,
  project: ProjectBundle | undefined,
): { canOverride: boolean; overrideId: string | null; setOverride: (next: string | null) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { productId: globalId } = useProductScope(projectId);

  const overrideId = resolveEffectiveProductId(project, globalId, searchParams.get(PRODUCT_OVERRIDE_PARAM));
  const canOverride = canOverrideProduct(project, globalId);

  const setOverride = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === null) params.delete(PRODUCT_OVERRIDE_PARAM);
      else params.set(PRODUCT_OVERRIDE_PARAM, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { canOverride, overrideId, setOverride };
}
```

Note `overrideId` reuses `resolveEffectiveProductId` rather than reading the raw param: under a named global scope that returns the global id, but `canOverride` is then `false` and the control does not render, so the value is never displayed. One function, no second rule.

- [x] **Step 3: Correct the `useProductScope` docstring**

The docstring above `useProductScope` (starting "The global product scope, persisted per project in localStorage") explains why the scope is *not* a URL param. That reasoning is still right for the **global** value and must not be deleted. Append one paragraph to it so the file does not read as if no param exists:

```
 * The per-surface override added in #315 *is* a URL param — `?product=` on the
 * surface's own route — and does not contradict this. The objection above is
 * that the global scope spans every route; the override does not, which is what
 * makes it per-surface. See `resolveEffectiveProductId`.
```

- [x] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output; lint still `✖ 4 problems (0 errors, 4 warnings)`.

- [x] **Step 5: Commit**

```bash
git add lib/hooks/useProductScope.ts
git commit -m "feat(products): surfaces resolve their product through ?product= (#315)"
```

---

## Task 3: Extract the shared select body

Pure refactor: `ProductScopeSelector` must look and behave identically afterwards. No new behaviour in this task.

**Files:**
- Create: `components/layout/ProductSelect.tsx`
- Modify: `components/layout/ProductScopeSelector.tsx`

- [x] **Step 1: Create the shared component**

```tsx
"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductScopeOption } from "@/lib/utils/product-scope";

/**
 * The product select's **body**, shared by the sidebar's global scope selector
 * and the four surfaces' override controls. Chrome — trigger classes, icon,
 * width — comes from props; everything below the trigger is identical by
 * construction.
 *
 * Two things in here must never drift between the two callers, which is the
 * whole reason it exists. The `__all__` sentinel: Radix reserves the empty
 * string for "no selection", so "All products" — a real member of the domain,
 * not an absence — needs a value of its own, and the sentinel must never leave
 * this file. And the two-line item: a stacked option would otherwise announce
 * and match as its two lines run together ("End-user app3 platforms"), so
 * `textValue` seeds Radix's typeahead key (otherwise the item's `textContent`)
 * and `aria-hidden` drops the secondary line from the accessible name (which
 * Radix derives from the whole ItemText subtree via `aria-labelledby`, and which
 * `textValue` does not reach). Two mechanisms, two fixes. The secondary line is
 * decoration — the name is the title.
 *
 * `value` is the product id or `null` for All products; the sentinel conversion
 * happens on both edges here so no caller ever holds it.
 */
const ALL_PRODUCTS = "__all__";

interface ProductSelectProps {
  value: string | null;
  onChange: (next: string | null) => void;
  options: ProductScopeOption[];
  /** Rendered inside the trigger, before the label — an icon, usually. */
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  ariaLabel: string;
  /** Secondary line on the All products row. */
  allProductsHint: string;
}

export function ProductSelect({
  value,
  onChange,
  options,
  triggerIcon,
  triggerClassName,
  contentClassName,
  ariaLabel,
  allProductsHint,
}: ProductSelectProps) {
  // A value pointing at a product this project no longer declares degrades to
  // "All products" in the trigger rather than leaving it blank.
  const selected = options.find((option) => option.id === value) ?? null;

  return (
    <Select
      value={selected ? selected.id : ALL_PRODUCTS}
      onValueChange={(next) => onChange(next === ALL_PRODUCTS ? null : next)}
    >
      <SelectTrigger aria-label={ariaLabel} className={triggerClassName}>
        {triggerIcon}
        {/* Children make Radix render this instead of portaling the selected
            item's text in — so the trigger stays one line while the options
            below carry their second, secondary one. */}
        <SelectValue>
          <span className="truncate">{selected ? selected.label : "All products"}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className={contentClassName}>
        <SelectItem value={ALL_PRODUCTS} textValue="All products">
          <span className="grid text-left leading-tight">
            <span className="truncate">All products</span>
            <span aria-hidden className="truncate text-xs text-muted-foreground">
              {allProductsHint}
            </span>
          </span>
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            <span className="grid text-left leading-tight">
              <span className="truncate">{option.label}</span>
              <span aria-hidden className="truncate text-xs text-muted-foreground">
                {option.platformLabel}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [x] **Step 2: Rebuild `ProductScopeSelector` on it**

Replace the body of `components/layout/ProductScopeSelector.tsx` below its existing file-level docstring. **Keep that docstring** — it records why one control, why nothing renders for a product-less project, and why a stale scope is displayed rather than healed. Delete only the `ALL_PRODUCTS` constant (it moved) and the JSX.

```tsx
"use client";

import { useMemo } from "react";
import { BoxesIcon } from "lucide-react";
import { ProductSelect } from "@/components/layout/ProductSelect";
import type { ProjectBundle } from "@/lib/data/types";
import { useProductScope } from "@/lib/hooks/useProductScope";
import { productScopeOptions } from "@/lib/utils/product-scope";

/* ... keep the existing file-level docstring here, unchanged ... */

interface ProductScopeSelectorProps {
  projectId: string;
  project: ProjectBundle | undefined;
}

export function ProductScopeSelector({ projectId, project }: ProductScopeSelectorProps) {
  const { productId, setScope } = useProductScope(projectId);
  // Products live at `bundle.project.metadata`; `productScopeOptions` drills in
  // itself, which is why it takes the bundle rather than the project.
  const options = useMemo(() => productScopeOptions(project), [project]);

  if (options.length === 0) return null;

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <ProductSelect
        value={productId}
        onChange={setScope}
        options={options}
        ariaLabel="Product"
        allProductsHint="Everything in the project"
        triggerIcon={<BoxesIcon className="size-4 shrink-0 text-sidebar-foreground/70" />}
        triggerClassName="h-8 w-full gap-2 border-sidebar-border bg-sidebar text-sm text-sidebar-foreground shadow-none focus:ring-sidebar-ring"
        contentClassName="min-w-56"
      />
    </div>
  );
}
```

The stale-scope comment that sat above `const selected = ...` moves with the logic: keep the short form now in `ProductSelect`, and leave the long "displayed, not healed" reasoning in `ProductScopeSelector`'s file docstring where it explains the *decision* rather than the line.

- [x] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output; lint unchanged at 0 errors, 4 warnings.

- [x] **Step 4: Verify the sidebar still works**

```bash
npm run dev
```

Open a project with declared products (the `pebbles` seed has them). The sidebar selector must show the same trigger, the same two-line options, and switching must still narrow every surface. Stop the server when done.

- [x] **Step 5: Commit**

```bash
git add components/layout/ProductSelect.tsx components/layout/ProductScopeSelector.tsx
git commit -m "refactor(products): one product select body, two callers (#315)"
```

---

## Task 4: The override control

**Files:**
- Create: `components/layout/ProductOverrideSelector.tsx`

- [x] **Step 1: Write it**

```tsx
"use client";

import { useMemo } from "react";
import { BoxesIcon } from "lucide-react";
import { ProductSelect } from "@/components/layout/ProductSelect";
import type { ProjectBundle } from "@/lib/data/types";
import { useProductOverride } from "@/lib/hooks/useProductScope";
import { productScopeOptions } from "@/lib/utils/product-scope";

/**
 * A surface's own product control — Delivery, Pyramid, Acceptances, Library.
 *
 * **It narrows and never widens.** It renders only while the shell is showing
 * All products, so whatever the sidebar names is always at least as wide as
 * what you are looking at and cannot lie about it. Under a named global scope
 * `canOverride` is false and this returns `null`: there is nothing a named scope
 * could narrow *to* that is not itself, and the alternative — a "follow the
 * sidebar" option — is an affordance no select trigger makes readable.
 *
 * The same `null` covers the degenerate case: a project declaring no products
 * shows no new control here exactly as it shows none in the sidebar, because
 * both ask `productScopeOptions`.
 *
 * It sits **inside** each surface's filter bar rather than in the page header:
 * it composes with the platform, species and search controls beside it, and a
 * reader narrowing to Admin is mid-filtering, not reframing the app.
 *
 * Leaving a surface drops the override, because sidebar nav links carry no query
 * string — that is what makes it per-surface, and it needs no code.
 */
interface ProductOverrideSelectorProps {
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function ProductOverrideSelector({ projectId, project }: ProductOverrideSelectorProps) {
  const { canOverride, overrideId, setOverride } = useProductOverride(projectId, project);
  const options = useMemo(() => productScopeOptions(project), [project]);

  if (!canOverride) return null;

  return (
    <ProductSelect
      value={overrideId}
      onChange={setOverride}
      options={options}
      ariaLabel="Product"
      allProductsHint="Everything in the project"
      triggerIcon={<BoxesIcon className="size-4 shrink-0 text-muted-foreground" />}
      triggerClassName="h-9 w-[11rem] gap-2"
      contentClassName="min-w-56"
    />
  );
}
```

- [x] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output. The new file is not imported yet, so lint may flag nothing — 0 errors, 4 warnings.

- [x] **Step 3: Commit**

```bash
git add components/layout/ProductOverrideSelector.tsx
git commit -m "feat(products): the per-surface product control (#315)"
```

---

## Task 5: Wire Delivery and Acceptances

Both bars already receive `projectId` and `project`, so this is placement only.

**Files:**
- Modify: `components/delivery/DeliveryFilterBar.tsx`
- Modify: `components/acceptances/AcceptanceFilterBar.tsx`
- Modify: `components/acceptances/acceptance-filters.ts` (docstring)

- [x] **Step 1: Delivery**

In `components/delivery/DeliveryFilterBar.tsx`, add the import:

```ts
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
```

In the JSX, the outer structure is:

```tsx
<div className="rounded-xl border bg-card/70 p-3 md:p-4">
  <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {showPlatformFilter && (
```

Insert the control as the **first** child of that innermost `flex flex-wrap` row, immediately before `{showPlatformFilter && (`:

```tsx
      <ProductOverrideSelector projectId={projectId} project={project} />
```

- [x] **Step 2: Acceptances**

In `components/acceptances/AcceptanceFilterBar.tsx`, add the same import. The returned JSX opens:

```tsx
<div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 md:p-4">
  <div className="relative min-w-[12rem] flex-1">
```

Insert the control as the first child, immediately before that search `<div>`:

```tsx
      <ProductOverrideSelector projectId={projectId} project={project} />
```

- [x] **Step 3: Stop the docstring lying**

`components/acceptances/acceptance-filters.ts` has a docstring above `readFilters` saying the scope "is global to the shell and persisted per project in localStorage … not per surface in the URL". Half of that is now false. Replace it with:

```ts
/**
 * `product` is deliberately absent from `KEYS` and always read back as `null`.
 *
 * There *is* a `?product=` param since #315 — the per-surface override — but it
 * is not an acceptance filter and this module must not touch it. Two
 * consequences, both wanted: the page layers the live scope on top of what this
 * returns (`useEffectiveProduct` owns the param), and "Clear filters", which
 * deletes every key in `KEYS`, leaves the override alone. Narrowing to one app
 * is a scope, not a filter, and clearing a search box must not silently widen
 * the surface back out.
 */
```

- [x] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output; 0 errors, 4 warnings.

- [x] **Step 5: Verify in the browser**

```bash
npm run dev
```

On a project with products, sidebar set to **All products**:
1. `/project/<id>/delivery` — the control shows "All products"; pick a product; the URL gains `?product=<id>`; the board narrows; the platform buttons collapse to that product's menu (or vanish at arity ≤ 1).
2. Reload — the narrowing survives.
3. Navigate to Pyramid via the sidebar — the param is gone and Pyramid shows everything.
4. `/project/<id>/acceptances` — same, and typing in the search box keeps `product` in the URL; "Clear" keeps it too.
5. Set the sidebar to a named product — **both controls disappear** and the surfaces follow the sidebar.
6. Set the sidebar back to All products — the earlier override returns (the param was never rewritten).

- [x] **Step 6: Commit**

```bash
git add components/delivery/DeliveryFilterBar.tsx components/acceptances/AcceptanceFilterBar.tsx components/acceptances/acceptance-filters.ts
git commit -m "feat(delivery,acceptances): per-surface product control in the filter bar (#315)"
```

---

## Task 6: Wire Pyramid and Library

Neither bar knows about the project today, so both gain two props.

**Files:**
- Modify: `components/pyramid/PyramidToolbar.tsx`
- Modify: `app/project/[id]/pyramid/page.tsx`
- Modify: `components/library/LibraryFilterBar.tsx`
- Modify: `app/project/[id]/library/page.tsx`

- [x] **Step 1: `PyramidToolbar` takes the props and hosts the control**

Add the imports:

```ts
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import type { ProjectBundle } from "@/lib/data/types";
```

Extend the props interface and the destructure:

```ts
interface PyramidToolbarProps {
  viewMode: PyramidViewMode;
  filterStep: PyramidFilterStep;
  onViewModeChange: (mode: PyramidViewMode) => void;
  onFilterStepChange: (step: PyramidFilterStep) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function PyramidToolbar({
  viewMode,
  filterStep,
  onViewModeChange,
  onFilterStepChange,
  projectId,
  project,
}: PyramidToolbarProps) {
```

Replace the returned JSX with:

```tsx
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProductOverrideSelector projectId={projectId} project={project} />
        <SegmentedControl
          options={FILTER_STEPS}
          value={filterStep}
          onChange={onFilterStepChange}
          ariaLabel="Which value elements to show"
        />
      </div>
      <SegmentedControl
        options={VIEW_MODES}
        value={viewMode}
        onChange={onViewModeChange}
        ariaLabel="Display mode"
      />
    </div>
  );
```

The new wrapper keeps the toolbar's `justify-between` meaningful: the control and the step filter are both "what am I looking at", the view mode is "how", and they stay on opposite ends.

- [x] **Step 2: Pass them from the Pyramid page**

In `app/project/[id]/pyramid/page.tsx`, the render is:

```tsx
<PyramidToolbar
  viewMode={viewMode}
  filterStep={filterStep}
  onViewModeChange={setViewMode}
  onFilterStepChange={setFilterStep}
/>
```

Add the two props. `id` and `projectBundle` are already in scope (`useProject(id)` at the top of the component):

```tsx
<PyramidToolbar
  viewMode={viewMode}
  filterStep={filterStep}
  onViewModeChange={setViewMode}
  onFilterStepChange={setFilterStep}
  projectId={id}
  project={projectBundle}
/>
```

- [x] **Step 3: `LibraryFilterBar` takes the props and hosts the control**

Add the imports:

```ts
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import type { ProjectBundle } from "@/lib/data/types";
```

Extend the interface and destructure:

```ts
interface LibraryFilterBarProps {
  search: string;
  displayMode: LibraryDisplayMode;
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function LibraryFilterBar({
  search,
  displayMode,
  onSearchChange,
  onDisplayModeChange,
  projectId,
  project,
}: LibraryFilterBarProps) {
```

Inside the returned JSX, the left cluster is the search `<div className="relative w-full md:max-w-md">`. Wrap it and the control together so the search box keeps its own width:

```tsx
      <div className="flex w-full flex-1 items-center gap-2 md:max-w-xl">
        <ProductOverrideSelector projectId={projectId} project={project} />
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title or description"
            className="pl-8"
            aria-label="Search nodes"
          />
        </div>
      </div>
```

- [x] **Step 4: Pass them from the Library page**

In `app/project/[id]/library/page.tsx`:

```tsx
<LibraryFilterBar
  search={search}
  displayMode={displayMode}
  onSearchChange={setSearch}
  onDisplayModeChange={setDisplayMode}
  projectId={id}
  project={projectBundle}
/>
```

- [x] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output; 0 errors, 4 warnings.

- [x] **Step 6: Verify in the browser**

```bash
npm run dev
```

Sidebar on All products, project with products:
1. `/project/<id>/pyramid` — control present, narrows the pyramid, `?product=` appears, rings follow the product's platform arity.
2. `/project/<id>/library` — control present beside the search box; narrowing hides other products' flows and views but **keeps unattached data models and endpoints** (`nodeInScope`'s orphan rule — do not "fix" this).
3. Library's `?species=` and `?product=` coexist; changing one keeps the other.
4. Both controls disappear when the sidebar names a product.

- [x] **Step 7: Commit**

```bash
git add components/pyramid/PyramidToolbar.tsx components/library/LibraryFilterBar.tsx "app/project/[id]/pyramid/page.tsx" "app/project/[id]/library/page.tsx"
git commit -m "feat(pyramid,library): per-surface product control in the toolbar (#315)"
```

---

## Task 7: Pyramid's click-through carries the override

**Files:**
- Modify: `app/project/[id]/pyramid/page.tsx:126`

- [x] **Step 1: Build the href from the scope**

The link today is:

```tsx
href={`/project/${id}/acceptances?value=${element.value}`}
```

Above the `visibleTiers.map(...)` (near the other `useMemo`s at the top of the component), add:

```tsx
  // The one cross-surface link between two surfaces that both own the override,
  // and so the one place "navigation drops the param" is the wrong answer:
  // narrow the pyramid to Admin, click an element, and landing on every
  // product's acceptances reads as a bug. `scope.productId` is the *effective*
  // product, so a global scope contributes nothing here — the sidebar already
  // narrows the destination, and writing it into the URL would turn an ambient
  // scope into a surface override on arrival.
  const acceptancesHref = useCallback(
    (value: string) => {
      const params = new URLSearchParams({ value });
      if (overrideId !== null) params.set(PRODUCT_OVERRIDE_PARAM, overrideId);
      return `/project/${id}/acceptances?${params.toString()}`;
    },
    [id, overrideId],
  );
```

`overrideId` comes from the hook the page must now also call, beside its existing `useEffectiveProduct`:

```tsx
  const { overrideId } = useProductOverride(id, projectBundle);
```

Imports to add:

```ts
import { useProductOverride, useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { PRODUCT_OVERRIDE_PARAM } from "@/lib/utils/product-scope";
```

(Merge with the existing `useEffectiveProduct` import line rather than adding a second one.)

Add `useCallback` to the existing `react` import if it is not already there. Then the href becomes:

```tsx
href={acceptancesHref(element.value)}
```

- [x] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no tsc output; 0 errors, 4 warnings.

- [x] **Step 3: Verify in the browser**

```bash
npm run dev
```

Sidebar on All products. On `/project/<id>/pyramid`, narrow to a product, click an addressed element. You land on `/acceptances?product=<id>&value=<value>`, the Acceptances control reads that product, and the list is filtered to it. With no override on the Pyramid, the link carries `value` only, exactly as before.

- [x] **Step 4: Commit**

```bash
git add "app/project/[id]/pyramid/page.tsx"
git commit -m "feat(pyramid): click-through to Acceptances keeps the surface's product (#315)"
```

---

## Task 8: Correct the comments the milestone falsified, and the spec

Several docstrings assert that the scope is never a URL param, or predict the wrong precedence. They were accurate; they are not now.

**Files:**
- Modify: `app/project/[id]/delivery/page.tsx` (~line 64)
- Modify: `app/project/[id]/library/page.tsx` (~line 172)
- Modify: `app/project/[id]/acceptances/page.tsx` (~line 53)
- Modify: `lib/utils/product-scope.ts` (file header, lines 1-11)
- Modify: `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md` (§ Decision 2)

- [x] **Step 1: Delivery page**

Replace the comment above `const scope = useEffectiveProduct(id, projectBundle);` — currently "The shell's scope, never a URL param (§ Decision 2)…" — with:

```ts
  // The shell's scope, narrowed by this surface's own `?product=` when it has
  // one (#315). `projectBundle` is `undefined` until `useProject`'s effect
  // lands, and a scope resolved from nothing declares no products — which
  // resolves to every platform and every node, i.e. today's board. So the first
  // render is already correct and nothing flashes when the bundle arrives, and
  // an override cannot apply before the bundle can validate it.
```

- [x] **Step 2: Library page**

Replace "The shell's scope, never a URL param (§ Decision 2). With no products declared…" with:

```ts
  // The shell's scope, narrowed by this surface's own `?product=` when it has
  // one (#315). With no products declared it resolves to every platform and
  // every node, so a project that has never heard of products gets exactly
  // today's library.
```

- [x] **Step 3: Acceptances page**

Replace "The product scope is not a filter-bar control, so it is layered on here rather than read from the URL…" with:

```ts
  // The product scope *is* read from the URL now (#315), but not by the filter
  // bar's own hook: `useEffectiveProduct` owns `?product=` and
  // `useAcceptanceFilters` deliberately does not list it in `KEYS`, so Clear
  // cannot widen the surface back out. The bar owns what the reader typed; the
  // scope owns which app they are looking at. Membership lives on nodes, so this
  // narrows correctly even before `useProject` has resolved the bundle.
```

- [x] **Step 4: `product-scope.ts` file header**

The header ends "That is what keeps the deferred per-surface-override milestone cheap: an override becomes a different argument, not a different code path." Replace that sentence with:

```
 * Every function here takes the product (or a scope carrying it) as an
 * *argument* and never reads scope state. That is what kept the per-surface
 * override (#315) cheap — it landed as a different argument to the same
 * functions, not a second code path — and it is why it must stay true.
```

- [x] **Step 5: Products design doc**

In `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md`, § Decision 2 says per-surface override "is deferred to a follow-up issue" and predicts `override ?? global`. Append to that section:

```markdown
**Shipped in #315**, with two amendments to the prediction above. The override is
**narrow-only** — the control renders only while the global scope is All products — so the
resolution is `global ?? override`, not `override ?? global`; the two agree wherever an
override is legitimate, and this order makes a leftover param inert. And it landed on **four**
surfaces (Delivery, Pyramid, Acceptances, Library), not all eight: Overview is a project
summary, and the maps already resolve a per-surface product through `mapProductId`. See
`2026-08-03-per-surface-product-override-design.md`.
```

- [x] **Step 6: Full verification**

```bash
npm run test:product-scope && npx tsc --noEmit && npm run lint && npm run build
```

Expected: `All product-scope tests passed`; no tsc output; `✖ 4 problems (0 errors, 4 warnings)`; build succeeds.

- [x] **Step 7: Commit**

```bash
git add "app/project/[id]/delivery/page.tsx" "app/project/[id]/library/page.tsx" "app/project/[id]/acceptances/page.tsx" lib/utils/product-scope.ts docs/superpowers/specs/2026-08-02-multi-product-projects-design.md
git commit -m "docs(products): record the shipped override precedence and surfaces (#315)"
```

---

## Task 9: Open the PR

- [x] **Step 1: Push**

```bash
git push -u origin per-surface-product-override
```

- [x] **Step 2: Open the PR with a Lab Note**

This is a user-facing change, so `CLAUDE.md`'s Lab Note gate applies: the body **must** carry a `## Lab Note` section with exactly one ```yaml fence, `en.title` and `en.summary` required, every title and summary double-quoted, `suggested.molecule: arkaik`.

```bash
gh pr create --title "A product filter on the surfaces that need one (#315)" --body "$(cat <<'EOF'
Closes #315.

Delivery, Pyramid, Acceptances and Library each get a product control that narrows
the sidebar's scope for that surface alone, stored as `?product=` so the view is
shareable.

**Narrow only.** The control renders only while the sidebar says All products — so
whatever the sidebar names is always at least as wide as what you are looking at,
and it can never lie about the content beneath it.

Overview and the maps are excluded: Overview is a project summary, and a saved map
already resolves its own product through `mapProductId`.

Spec: `docs/superpowers/specs/2026-08-03-per-surface-product-override-design.md`

## Lab Note

```yaml
en:
  title: "Zoom in on one app, one page at a time"
  summary: "Delivery, Pyramid, Acceptances and Library each have their own product picker now. Narrow one page to a single app without changing what you see everywhere else — and the link you share carries it with you."
fr:
  title: "Zoome sur une seule app, page par page"
  summary: "Delivery, Pyramid, Acceptances et Library ont chacune leur sélecteur de produit. Tu peux te concentrer sur une seule app sur une page, sans rien changer ailleurs — et le lien que tu partages garde ce réglage."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [x] **Step 3: Read the PR's own comments**

`CLAUDE.md` is explicit: after opening, read the comments rather than assuming the note is fine. The advisory reminder posts problems as a PR comment and clears it once the body is fixed.

```bash
sleep 30 && gh pr view --comments
```

If the reminder flags the note, fix it with `gh pr edit --body ...` and re-read. Posting is idempotent.

---

## Self-review notes

**Spec coverage.** Decision 1 (four surfaces) → Tasks 5, 6. Decision 2 (narrow-only) → Task 1 `canOverrideProduct`, Task 4's early return. Decision 3 (URL) → Tasks 1-2. Decision 4 (stale param ignored) → Task 1, branch 2. Architecture § "rule as one pure function" → Task 1. § "the hooks" → Task 2. § "the control" incl. shared primitive → Tasks 3-4. § placement table → Tasks 5-6. § deliberate non-healing → verified in Task 5 Step 5.6. § Pyramid click-through → Task 7. Testing § → Task 1 Step 1. No gap.

**Naming consistency.** `resolveEffectiveProductId`, `canOverrideProduct`, `PRODUCT_OVERRIDE_PARAM`, `useProductOverride`, `ProductSelect`, `ProductOverrideSelector` — each spelled identically in every task that mentions it. `overrideId` / `canOverride` / `setOverride` are the hook's three fields throughout.

**Known risk.** `useEffectiveProduct` now calls `useSearchParams()`, which in the App Router forces client-side rendering for statically prerendered pages and errors without a Suspense boundary. Every affected route lives under the dynamic `app/project/[id]` segment with no `generateStaticParams`, so none is prerendered and none needs a boundary — `app/project/[id]/layout.tsx:47` already calls the same hook today. Task 8 Step 6 runs `npm run build` to prove it.

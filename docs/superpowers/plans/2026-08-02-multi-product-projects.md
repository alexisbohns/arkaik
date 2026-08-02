# Multi-Product Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one arkaik project describe a *family* of products (end-user app, admin, public API) that share a graph but not a platform list, so every rollup, tab, and board tells the truth about the app it belongs to.

**Architecture:** Products are project metadata (`project.metadata.products`), exactly like stored maps. Flows, views, and acceptances carry `metadata.product`; data models and API endpoints derive membership from consumer traversal. `node.platforms` stays authoritative — the product supplies a *menu* that surfaces intersect against. A single global scope in the shell feeds a product id into every projection as an argument, and one `PlatformAvailability` primitive picks each surface's shape from the number of effective platforms (≥2 → rings/columns, ≤1 → a single bar/column).

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript, Tailwind CSS v4, Radix UI, lucide-react, zod (schema package only). Tests are plain Node scripts run via `npm run test:*` — there is **no** React test runner in this repo, so component tasks are verified with `npx tsc --noEmit`, `npm run lint`, and reading the rendered page.

**Spec:** [`docs/superpowers/specs/2026-08-02-multi-product-projects-design.md`](../specs/2026-08-02-multi-product-projects-design.md)
**Source RFC:** [`docs/rfcs/products.md`](../../rfcs/products.md)

---

## Ground rules for every task

1. **`npm run lint` already fails on `main`** with ~19 pre-existing `react-hooks` problems, and CI does not gate on it. Never plan for "lint clean". The bar is: **your change adds no new problems**. Compare counts before and after if in doubt.
2. **There is no local Postgres.** `tests/services/**` no-ops on this machine. Every test this plan adds is pure logic over nodes and edges, run by plain `node`.
3. **There is no browser driver.** UI tasks are verified statically (`npx tsc --noEmit`, `npm run lint`) and handed to Alexis with a checklist at the end.
4. **Commit after every task.** Message style follows the repo: lowercase `feat:` / `fix:` / `docs:` / `chore:`, benefit-first where it is user-facing.
5. **Never edit generated files by hand.** `docs/arkaik-skill/references/schema.md`, `public/schema/*.json`, `app/llms-full.txt`, `docs/arkaik-skill/scripts/validate-bundle.js` and the plugin channel are all outputs of `npm run generate`.
6. **Rendering a lucide icon the tree has never used before requires `npm run generate`, and the two wobble artifacts must be committed with it.** `scripts/generate` scans every lucide import and writes `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`; `.github/workflows/ci.yml:28` then gates on `git diff --exit-code` over both. So a new icon is a **red CI run**, and until the registry knows it, that one icon renders flat while every other icon in the app wobbles. Tasks 8 and 11-17 all add icons. The check is: `npm run generate && git status --short` — clean, or stage what moved.

---

## File Structure

### Schema package (P0 + P1)

| File | Responsibility | Action |
|---|---|---|
| `packages/schema/src/products.ts` | Product definitions, membership, platform menus, usage index — zod-free, browser-safe | Create |
| `packages/schema/src/bundle.ts` | `ProductDefinitionSchema`, `ProjectMetadata.products`, `NodeMetadata.product` | Modify |
| `packages/schema/src/maps.ts` | `MapDefinition.product` optional filter | Modify |
| `packages/schema/src/validate.ts` | Seven new warning-severity rules | Modify |
| `packages/schema/src/index.ts` | Re-export `./products` | Modify |
| `tests/schema/products.test.js` | Every projection + every new rule | Create |
| `package.json` | `test:products` script | Modify |

### App plumbing and primitives

| File | Responsibility | Action |
|---|---|---|
| `lib/utils/product-scope-store.ts` | The one shared scope value, persisted per project; `useSyncExternalStore` store | Create |
| `lib/hooks/useProductScope.ts` | Binds that store to React; `useEffectiveProduct` resolver | Create |
| `components/layout/ProductScopeSelector.tsx` | The shell control; renders nothing when no products | Create |
| `components/layout/ProjectSidebar.tsx` | Mounts the selector under `ProjectSwitcher` | Modify |
| `components/graph/nodes/PlatformAvailability.tsx` | **Owns the arity rule** — rings at ≥2, bar + count at ≤1 | Create |
| `components/graph/nodes/PlatformRingSet.tsx` | Takes `platforms` prop instead of the global list | Modify |
| `components/graph/nodes/PlatformGaugeList.tsx` | Takes an explicit platform list; loses the `PLATFORMS` import | Modify |

### Surfaces (P2)

| File | Responsibility | Action |
|---|---|---|
| `lib/utils/acceptance-matrix.ts` | `product` filter; `Unanchored` rename | Modify |
| `components/acceptances/AcceptanceMatrix.tsx` | Columns from effective platforms | Modify |
| `components/acceptances/AcceptanceFilterBar.tsx` | Platform filter hidden at arity ≤ 1 | Modify |
| `lib/utils/pyramid.ts` | `product` scope parameter | Modify |
| `components/pyramid/PyramidElementCard.tsx` | Adopts `PlatformAvailability` | Modify |
| `components/pyramid/PyramidElementRow.tsx` | Adopts `PlatformAvailability` | Modify |
| `lib/utils/delivery.ts` | Scope-narrowed items, honest denominators | Modify |
| `components/delivery/DeliveryFilterBar.tsx` | Platform options from effective set | Modify |
| `lib/utils/product-scope.ts` | App-side scope helpers built on the schema projections | Create |
| `components/library/NodeCard.tsx` | Product badge, "used by" badge | Modify |
| `components/library/NodeTable.tsx` | Product column | Modify |
| `components/library/LibraryFilterBar.tsx` | Scope-aware node list | Modify |
| `components/overview/*.tsx` (4 cards) | Inherit via primitive + scoped projections | Modify |
| `components/panels/NodeDetailPanel.tsx` | Tabs collapse at arity ≤ 1 | Modify |
| `components/graph/nodes/PlatformList.tsx` | Effective platforms | Modify |
| `lib/utils/journey-graph.ts` | Per-product root anchor | Modify |

### Docs, seed, follow-ups

| File | Responsibility | Action |
|---|---|---|
| `docs/spec/bundle-format.md` | § Products — the normative definition | Modify |
| `docs/spec/maps.md` | `MapDefinition.product` | Modify |
| `docs/graph-model.md` | § Products; § Platforms rewritten around arity; taxonomy checklist entry | Modify |
| `docs/arkaik-skill/skill.md` | Membership rules for agents | Modify |
| `docs/rfcs/products.md` | Status line: P0–P2 shipped | Modify |
| `seed/pebbles.json` | Web-only Admin product | Modify |
| `docs/articles/2026-08-02-one-graph-many-products.md` | The essay | Create |

---

## Phase A — Schema package (P0 + P1)

### Task 1: `resolveProducts` and `productOf`

**Files:**
- Create: `packages/schema/src/products.ts`
- Create: `tests/schema/products.test.js`
- Modify: `packages/schema/src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `tests/schema/products.test.js`:

```js
#!/usr/bin/env node

/**
 * Products — definition resolution, membership, platform menus, the usage
 * index, and the warning-severity validation rules
 * (docs/spec/bundle-format.md § Products).
 */

const { loadSchema } = require("./load-schema");

const {
  resolveProducts,
  productOf,
} = loadSchema();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- resolveProducts -------------------------------------------------------
const project = {
  id: "p",
  title: "P",
  metadata: {
    products: [
      { id: "app", title: "End-user app", platforms: ["web", "ios", "android"] },
      { id: "admin", title: "Admin", platforms: ["web"] },
      { id: "api", title: "Public API", platforms: [] },
    ],
  },
};

assert(resolveProducts(project).length === 3, "resolveProducts returns every stored definition");
assert(resolveProducts(project)[1].id === "admin", "resolveProducts preserves stored order");
assert(resolveProducts(undefined).length === 0, "resolveProducts tolerates a missing project");
assert(resolveProducts({ id: "p", title: "P" }).length === 0, "resolveProducts returns [] with no metadata");

const messy = {
  id: "p",
  title: "P",
  metadata: { products: [null, "nope", { id: "app", title: "A", platforms: ["web"] }, ["x"]] },
};
assert(resolveProducts(messy).length === 1, "resolveProducts skips non-object entries");

const dupes = {
  id: "p",
  title: "P",
  metadata: {
    products: [
      { id: "app", title: "First", platforms: ["web"] },
      { id: "app", title: "Second", platforms: ["ios"] },
    ],
  },
};
assert(resolveProducts(dupes).length === 1, "resolveProducts drops duplicate ids");
assert(resolveProducts(dupes)[0].title === "First", "duplicate ids resolve first-wins");

// --- productOf -------------------------------------------------------------
assert(
  productOf({ species: "view", metadata: { product: "admin" } }) === "admin",
  "productOf reads stored membership on a view",
);
assert(productOf({ species: "flow", metadata: { product: "app" } }) === "app", "productOf works on a flow");
assert(
  productOf({ species: "acceptance", metadata: { product: "admin" } }) === "admin",
  "productOf works on an acceptance",
);
assert(productOf({ species: "view", metadata: {} }) === null, "productOf returns null with no membership");
assert(productOf({ species: "view" }) === null, "productOf returns null with no metadata");
assert(
  productOf({ species: "data-model", metadata: { product: "admin" } }) === null,
  "productOf ignores membership on a data model — theirs is derived",
);
assert(
  productOf({ species: "api-endpoint", metadata: { product: "admin" } }) === null,
  "productOf ignores membership on an API endpoint",
);
assert(
  productOf({ species: "view", metadata: { product: 42 } }) === null,
  "productOf ignores a non-string membership",
);

process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/schema/products.test.js`
Expected: a `TypeError: resolveProducts is not a function`, because the module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/schema/src/products.ts`:

```ts
/**
 * Products — a project describes a *family* of apps that share one graph
 * (docs/spec/bundle-format.md § Products). A product names an app and the
 * platforms it can ship on; flows, views, and acceptances store membership,
 * while data models and API endpoints derive it from who consumes them.
 *
 * Same doctrine as {@link ./maps}: pure functions, minimal `Pick<>` inputs,
 * immutable, deliberately **zod-free** (type-only imports) so the module stays
 * browser-safe and adds nothing to the standalone validator bundle.
 *
 * Everything here is lenient. A stale or malformed product definition must
 * never fail an import or a CI gate — `validateBundle()` reports those as
 * warnings, exactly as it does for stored maps.
 */

import type { Node, Project } from "./bundle";
import type { PlatformId, SpeciesId } from "./ids";

/**
 * A product: one app in the family. `platforms` is a *menu*, not a claim — a
 * node's own `platforms` is the authoritative list and must be a subset of it.
 * An empty menu means "availability is not a tracked dimension here" (a CLI, a
 * public API), and every surface collapses to a single lifecycle status.
 */
export interface ProductDefinition extends Record<string, unknown> {
  /** Kebab-case, unique within the project. */
  id: string;
  title: string;
  description?: string;
  platforms: PlatformId[];
  /** This product's journey anchor; generalizes `project.root_node_id`. */
  root_node_id?: string;
}

/** The species that *store* membership. Every other species derives it. */
export const PRODUCT_MEMBERSHIP_SPECIES: readonly SpeciesId[] = ["flow", "view", "acceptance"];

/**
 * Stored definitions in order, with non-objects and duplicate ids dropped.
 * Duplicates resolve **first-wins** so that `productOf` is deterministic even
 * for a bundle `validateBundle()` has already warned about.
 */
export function resolveProducts(project: Pick<Project, "metadata"> | undefined | null): ProductDefinition[] {
  const stored = project?.metadata?.products;
  if (!Array.isArray(stored)) return [];

  const seen = new Set<string>();
  const products: ProductDefinition[] = [];

  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    products.push(candidate as unknown as ProductDefinition);
  }

  return products;
}

/** Stored membership, or `null` — including for the species that never store it. */
export function productOf(node: Pick<Node, "species" | "metadata">): string | null {
  if (!PRODUCT_MEMBERSHIP_SPECIES.includes(node.species)) return null;
  const product = node.metadata?.product;
  return typeof product === "string" ? product : null;
}
```

Add to `packages/schema/src/index.ts`, alongside the existing `export * from "./maps";`:

```ts
export * from "./products";
```

Add to `package.json` scripts, after `"test:maps"`:

```json
"test:products": "node tests/schema/products.test.js",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/schema/products.test.js`
Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/products.ts packages/schema/src/index.ts tests/schema/products.test.js package.json
git commit -m "feat: product definitions and stored membership in the schema package"
```

---

### Task 2: `productPlatforms` and `effectiveNodePlatforms`

The two functions that drive the arity rule. `productPlatforms` takes an **id**, because an id is what the scope holds.

**Files:**
- Modify: `packages/schema/src/products.ts`
- Modify: `tests/schema/products.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/schema/products.test.js`, above the `process.exit` line, and extend the destructured import at the top to `{ resolveProducts, productOf, productPlatforms, effectiveNodePlatforms }`:

```js
// --- productPlatforms ------------------------------------------------------
assert(
  JSON.stringify(productPlatforms(project, "admin")) === JSON.stringify(["web"]),
  "productPlatforms returns a named product's menu",
);
assert(
  JSON.stringify(productPlatforms(project, "api")) === JSON.stringify([]),
  "productPlatforms returns an empty menu for a platform-less product",
);
assert(
  JSON.stringify(productPlatforms(project, null)) === JSON.stringify(["web", "ios", "android"]),
  "productPlatforms with null scope returns the union of every declared product, in PLATFORM_IDS order",
);
assert(
  JSON.stringify(productPlatforms(project, "nope")) === JSON.stringify(["web", "ios", "android"]),
  "an unknown product id resolves like the null scope",
);

const noProducts = { id: "p", title: "P" };
assert(
  JSON.stringify(productPlatforms(noProducts, null)) === JSON.stringify(["web", "ios", "android"]),
  "a project declaring no products falls back to PLATFORM_IDS — the degenerate case",
);

const webOnlyProject = {
  id: "p",
  title: "P",
  metadata: { products: [{ id: "admin", title: "Admin", platforms: ["web"] }] },
};
assert(
  JSON.stringify(productPlatforms(webOnlyProject, null)) === JSON.stringify(["web"]),
  "the null-scope union of one web-only product is just web",
);

// --- effectiveNodePlatforms ------------------------------------------------
const adminProduct = { id: "admin", title: "Admin", platforms: ["web"] };
const appProduct = { id: "app", title: "App", platforms: ["web", "ios", "android"] };
const apiProduct = { id: "api", title: "API", platforms: [] };

const view = { species: "view", platforms: ["web", "ios"], metadata: { product: "admin" } };
assert(
  JSON.stringify(effectiveNodePlatforms(view, adminProduct)) === JSON.stringify(["web"]),
  "effectiveNodePlatforms intersects the node against the product menu",
);
assert(
  JSON.stringify(effectiveNodePlatforms(view, appProduct)) === JSON.stringify(["web", "ios"]),
  "a node fully inside the menu is returned unchanged",
);
assert(
  JSON.stringify(effectiveNodePlatforms(view, apiProduct)) === JSON.stringify([]),
  "a platform-less product yields no effective platforms",
);
assert(
  JSON.stringify(effectiveNodePlatforms(view, null)) === JSON.stringify(["web", "ios"]),
  "a null product returns node.platforms unchanged",
);
assert(
  JSON.stringify(effectiveNodePlatforms({ species: "view" }, appProduct)) === JSON.stringify([]),
  "a node with no platforms array yields []",
);

// The PLATFORM_IDS ordering guarantee is load-bearing for UI columns and
// rings, and every other fixture here happens to store platforms already in
// canonical order — so assert it against deliberately reversed input.
const reorderedProject = {
  id: "p",
  title: "P",
  metadata: { products: [{ id: "app", title: "App", platforms: ["android", "web"] }] },
};
assert(
  JSON.stringify(productPlatforms(reorderedProject, "app")) === JSON.stringify(["web", "android"]),
  "productPlatforms returns PLATFORM_IDS order, not stored order",
);
assert(
  JSON.stringify(
    effectiveNodePlatforms(
      { species: "view", platforms: ["android", "web"] },
      { id: "app", title: "App", platforms: ["android", "ios", "web"] },
    ),
  ) === JSON.stringify(["web", "android"]),
  "effectiveNodePlatforms returns PLATFORM_IDS order, not stored order",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/schema/products.test.js`
Expected: `FAIL` lines for the new assertions (or a `TypeError` on the first `productPlatforms` call), exit code 1.

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/schema/src/products.ts`, and change the import line to `import { PLATFORM_IDS, type PlatformId, type SpeciesId } from "./ids";` (`PLATFORM_IDS` is a value, so it is a real import, not type-only — `ids.ts` has no zod dependency, so the module stays validator-safe). Because this makes the import a mix of value and type-only, also reword the module header's stale "deliberately **zod-free** (type-only imports)" parenthetical to "deliberately **zod-free** (`./ids` carries no runtime dependencies of its own)" — still zod-free, the old wording just no longer describes the import:

```ts
/**
 * The scope's platform **menu** — the sole input to the arity rule that every
 * surface reads (docs/superpowers/specs/2026-08-02-multi-product-projects-design.md § 3).
 *
 * - a known `productId` → that product's own list;
 * - `null` (All products) → the union of every declared product's list;
 * - an unknown id → same as `null`, because a stale scope must degrade, not throw;
 * - a project declaring no products → `PLATFORM_IDS`, the degenerate case that
 *   makes today's behavior fall out unchanged.
 *
 * The result is always ordered by `PLATFORM_IDS` so that columns, tabs, and
 * rings never reorder themselves when the scope changes.
 */
export function productPlatforms(
  project: Pick<Project, "metadata"> | undefined | null,
  productId: string | null,
): PlatformId[] {
  const products = resolveProducts(project);
  if (products.length === 0) return [...PLATFORM_IDS];

  const named = productId === null ? undefined : products.find((product) => product.id === productId);
  const contributing = named ? [named] : products;

  const union = new Set<string>();
  for (const product of contributing) {
    if (!Array.isArray(product.platforms)) continue;
    for (const platform of product.platforms) union.add(platform as string);
  }

  return PLATFORM_IDS.filter((platform) => union.has(platform));
}

/**
 * `node.platforms ∩ product.platforms`, ordered by `PLATFORM_IDS`.
 *
 * This intersection is why the containment rule can be a *warning*: a platform
 * outside the product's menu simply drops out of the display rather than
 * corrupting it. A `null` product means "no menu to intersect against" and
 * returns the node's own list unchanged.
 */
export function effectiveNodePlatforms(
  node: Pick<Node, "platforms">,
  product: ProductDefinition | null | undefined,
): PlatformId[] {
  const own = Array.isArray(node.platforms) ? node.platforms : [];
  if (!product || !Array.isArray(product.platforms)) {
    return PLATFORM_IDS.filter((platform) => own.includes(platform));
  }

  const menu = new Set<string>(product.platforms as string[]);
  return PLATFORM_IDS.filter((platform) => own.includes(platform) && menu.has(platform));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/schema/products.test.js`
Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/products.ts tests/schema/products.test.js
git commit -m "feat: platform menus and node intersection for product scopes"
```

---

### Task 3: The product usage index for the system layer

Data models and API endpoints never store membership. Membership is *derived* from who consumes them, and the traversal has one subtlety that a naive implementation gets wrong.

**The algorithm.** From every flow/view that stores membership, walk **outgoing** `calls` / `displays` / `queries` edges, but only into `api-endpoint` and `data-model` targets. Continue from those targets. Every node reached is used by that product.

**Why not undirected reachability.** `calls` edges also run API → View (the inbound/read affordance, `docs/graph-model.md` § Edge Types), so an undirected walk climbs back up into another product's views. Worse, undirected reachability inside a connected component is all-pairs: a data model touched only by Admin would report "used by End-user" merely because both products share *some other* data model. Restricting hops to system-layer targets fixes both. There is a test for exactly this.

**Files:**
- Modify: `packages/schema/src/products.ts`
- Modify: `tests/schema/products.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/schema/products.test.js` above `process.exit`, extending the destructured import with `buildProductUsageIndex, productsUsingNode`:

```js
// --- productsUsingNode -----------------------------------------------------
// V-admin (admin) --displays--> DM-shared <--displays-- V-user (app)
// V-admin --displays--> DM-adminonly           (must NOT read as used by app)
// V-user  --calls--> API-x --queries--> DM-deep (two hops from a view)
// DM-orphan has no edges at all.
// API-x --calls--> V-user is the inbound affordance and must not climb back up.
const usageNodes = [
  { id: "V-admin", species: "view", platforms: ["web"], metadata: { product: "admin" } },
  { id: "V-user", species: "view", platforms: ["web"], metadata: { product: "app" } },
  { id: "V-loose", species: "view", platforms: ["web"] },
  { id: "DM-shared", species: "data-model", platforms: ["web"] },
  { id: "DM-adminonly", species: "data-model", platforms: ["web"] },
  { id: "DM-deep", species: "data-model", platforms: ["web"] },
  { id: "DM-orphan", species: "data-model", platforms: ["web"] },
  { id: "API-x", species: "api-endpoint", platforms: ["web"] },
];
const usageEdges = [
  { id: "e1", edge_type: "displays", source_id: "V-admin", target_id: "DM-shared" },
  { id: "e2", edge_type: "displays", source_id: "V-user", target_id: "DM-shared" },
  { id: "e3", edge_type: "displays", source_id: "V-admin", target_id: "DM-adminonly" },
  { id: "e4", edge_type: "calls", source_id: "V-user", target_id: "API-x" },
  { id: "e5", edge_type: "queries", source_id: "API-x", target_id: "DM-deep" },
  { id: "e6", edge_type: "calls", source_id: "API-x", target_id: "V-user" },
];

const usage = buildProductUsageIndex(usageNodes, usageEdges);
const using = (id) => productsUsingNode(id, usage);

assert(JSON.stringify(using("DM-shared")) === JSON.stringify(["admin", "app"]), "a shared data model lists both products, sorted");
assert(
  JSON.stringify(using("DM-adminonly")) === JSON.stringify(["admin"]),
  "a data model touched only by admin does NOT inherit app through a shared neighbour",
);
assert(JSON.stringify(using("DM-deep")) === JSON.stringify(["app"]), "usage traverses view -> api -> data model");
assert(JSON.stringify(using("API-x")) === JSON.stringify(["app"]), "an endpoint is used by its caller's product");
assert(JSON.stringify(using("DM-orphan")) === JSON.stringify([]), "an orphan data model is used by no product");
assert(JSON.stringify(using("V-user")) === JSON.stringify([]), "the index covers the system layer only, not views");
assert(JSON.stringify(using("nope")) === JSON.stringify([]), "an unknown node id yields []");

const looseEdges = [{ id: "e7", edge_type: "displays", source_id: "V-loose", target_id: "DM-orphan" }];
const looseUsage = buildProductUsageIndex(usageNodes, looseEdges);
assert(
  JSON.stringify(productsUsingNode("DM-orphan", looseUsage)) === JSON.stringify([]),
  "a consumer with no membership contributes no product",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/schema/products.test.js`
Expected: `TypeError: buildProductUsageIndex is not a function`, exit code 1.

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/schema/src/products.ts`, and add `Edge` to the existing type import from `./bundle` (`import type { Edge, Node, Project } from "./bundle";`) — `buildProductUsageIndex`'s edges parameter is typed `Pick<Edge, ...>`, matching this file's "minimal `Pick<>` inputs" doctrine and `maps.ts`'s `computeMapSubgraph` precedent, rather than an ad hoc inline object type:

```ts
/** Species whose membership is derived from consumers rather than stored. */
const SYSTEM_LAYER_SPECIES: readonly SpeciesId[] = ["api-endpoint", "data-model"];

/** Edge types along which a consumer reaches the system layer. */
const USAGE_EDGE_TYPES = new Set<string>(["calls", "displays", "queries"]);

/**
 * `nodeId → sorted product ids`, covering the system layer only. Built once per
 * snapshot; {@link productsUsingNode} is a lookup, never a traversal.
 */
export type ProductUsageIndex = ReadonlyMap<string, string[]>;

/**
 * Walk outward from every membership-bearing flow/view along `calls` /
 * `displays` / `queries`, following each edge **in its stored direction** and
 * only into `api-endpoint` / `data-model` targets.
 *
 * The species restriction is load-bearing twice over. `calls` also runs
 * API → View (the inbound/read affordance, docs/graph-model.md § Edge Types),
 * so an unrestricted walk climbs back into another product's views. And any
 * *undirected* formulation is all-pairs within a connected component, which
 * would make a data model that only Admin touches report "used by End-user"
 * purely because the two products share some other model.
 */
export function buildProductUsageIndex(
  nodes: readonly Pick<Node, "id" | "species" | "metadata">[],
  edges: readonly Pick<Edge, "edge_type" | "source_id" | "target_id">[],
): ProductUsageIndex {
  const speciesById = new Map<string, SpeciesId>();
  for (const node of nodes) speciesById.set(node.id, node.species);

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!USAGE_EDGE_TYPES.has(edge.edge_type)) continue;
    const targetSpecies = speciesById.get(edge.target_id);
    if (targetSpecies === undefined || !SYSTEM_LAYER_SPECIES.includes(targetSpecies)) continue;
    const list = outgoing.get(edge.source_id) ?? [];
    list.push(edge.target_id);
    outgoing.set(edge.source_id, list);
  }

  // One seed set per distinct product, not per membership-bearing node — a
  // product spread across many views walks the downstream graph once.
  const seedsByProduct = new Map<string, Set<string>>();
  for (const node of nodes) {
    const product = productOf(node);
    if (product === null) continue;
    const seeds = seedsByProduct.get(product) ?? new Set<string>();
    for (const next of outgoing.get(node.id) ?? []) seeds.add(next);
    seedsByProduct.set(product, seeds);
  }

  const byNode = new Map<string, Set<string>>();

  for (const [product, seeds] of seedsByProduct) {
    const visited = new Set<string>(seeds);
    let frontier = [...seeds];

    while (frontier.length > 0) {
      const next: string[] = [];
      for (const current of frontier) {
        const products = byNode.get(current) ?? new Set<string>();
        products.add(product);
        byNode.set(current, products);

        for (const neighbor of outgoing.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  }

  const index = new Map<string, string[]>();
  for (const [nodeId, products] of byNode) index.set(nodeId, [...products].sort());
  return index;
}

/** Products that reach this node, or `[]`. A lookup into {@link buildProductUsageIndex}. */
export function productsUsingNode(nodeId: string, index: ProductUsageIndex): string[] {
  return index.get(nodeId) ?? [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/schema/products.test.js`
Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/products.ts tests/schema/products.test.js
git commit -m "feat: derive which products consume a data model or endpoint"
```

---

### Task 4: Zod schemas and the `MapDefinition.product` filter

**Files:**
- Modify: `packages/schema/src/bundle.ts:102-131` (`NodeMetadata`), `:212-225` (`ProjectMetadata`)
- Modify: `packages/schema/src/maps.ts:47-62` (`MapDefinition`)

- [ ] **Step 1: Add the product definition schema to `bundle.ts`**

Insert above `ProjectMetadata` (near the existing `MapDefinitionSchema`):

```ts
/**
 * A product definition (docs/spec/bundle-format.md § Products). Deliberately
 * lenient, exactly like `MapDefinitionSchema`: unknown keys round-trip, and the
 * cross-checks against the graph live in `validate.ts` as warnings. The
 * zod-free types and projections live in `./products`.
 */
export const ProductDefinitionSchema: z.ZodType<ProductDefinition> = z
  .object({
    id: z.string().meta({ description: "Kebab-case, unique within the project." }),
    title: z.string().meta({ description: "Display title." }),
    description: z.string().optional().meta({ description: "What this product is." }),
    platforms: z.array(PlatformSchema).meta({
      description: "The platforms this product can ship on; empty means availability is not tracked.",
    }),
    root_node_id: z.string().optional().meta({ description: "This product's journey anchor." }),
  })
  .catchall(z.unknown())
  .meta({ id: "ProductDefinition", description: "A product definition (docs/spec/bundle-format.md § Products)." });
```

Note: `MapDefinitionSchema` in this repo actually builds leniency via
`.object({...}).catchall(z.unknown())`, not `z.looseObject(...)` — even though
`z.looseObject` exists in this zod version. They're equivalent (`looseObject()`
constructs exactly `ZodObject` with `catchall: unknown()`), so match the
`.catchall` form the neighboring schemas use.

Add the type import at the top of `bundle.ts`, beside the existing `import type { MapDefinition } from "./maps";`:

```ts
import type { ProductDefinition } from "./products";
```

- [ ] **Step 2: Wire it into `ProjectMetadata`**

In the `ProjectMetadata` interface, beside `maps?: MapDefinition[];`:

```ts
  products?: ProductDefinition[];
```

And in `ProjectMetadataSchema`, beside the `maps` entry:

```ts
    products: z.array(ProductDefinitionSchema).optional().meta({
      description: "Product definitions (docs/spec/bundle-format.md § Products) — additive; unknown fields preserved.",
    }),
```

- [ ] **Step 3: Add membership to `NodeMetadata`**

In the `NodeMetadata` interface, beside `platformStatuses`:

```ts
  /** Product membership; meaningful on flow, view, and acceptance only. */
  product?: string;
```

And in `NodeMetadataSchema`:

```ts
    product: z.string().optional().meta({
      description: "Product membership (docs/spec/bundle-format.md § Products); flow, view, and acceptance only.",
    }),
```

- [ ] **Step 4: Add the map filter**

In `packages/schema/src/maps.ts`, inside the `MapDefinition` interface, after `root_node_id`:

```ts
  /** Product scope; absent = every product (docs/spec/bundle-format.md § Products). */
  product?: string;
```

And in `MapDefinitionSchema` in `bundle.ts`, beside `root_node_id`:

```ts
    product: z.string().optional().meta({ description: "Product scope; absent = every product." }),
```

- [ ] **Step 5: Verify types compile and nothing regressed**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test:products && npm run test:maps && npm run test:schema && npm run test:fixtures`
Expected: all `PASS`, exit code 0 for each.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/bundle.ts packages/schema/src/maps.ts
git commit -m "feat: product definitions, node membership, and map product scope in the bundle schema"
```

---

### Task 5: Validation rules — all warning-severity

**Files:**
- Modify: `packages/schema/src/validate.ts` (new block after the stored-maps block at `:392`)
- Modify: `tests/schema/products.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/schema/products.test.js` above `process.exit`, extending the destructured import with `validateBundle`:

```js
// --- validation: every product finding is a warning -------------------------
function findingsFor(bundle) {
  const result = validateBundle(bundle);
  return { result, rules: result.findings.map((f) => f.rule) };
}

const node = (over) => ({
  id: "V-1",
  project_id: "p",
  species: "view",
  title: "V",
  status: "live",
  platforms: ["web"],
  ...over,
});

// Timestamps are required at error severity, so every fixture here carries
// them: the whole point of the block is asserting `valid === true` while
// product findings pile up, and a missing created_at would mask that.
const bundleWith = (products, nodes, edges = []) => ({
  version: "2",
  project: {
    id: "p",
    title: "P",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    metadata: { products },
  },
  nodes,
  edges,
});

// Duplicate + malformed ids
const idsBundle = bundleWith(
  [
    { id: "app", title: "A", platforms: ["web"] },
    { id: "app", title: "B", platforms: ["web"] },
    { id: "Not Kebab", title: "C", platforms: ["web"] },
  ],
  [node({ metadata: { product: "app" } })],
);
const ids = findingsFor(idsBundle);
assert(ids.rules.includes("product-duplicate-id"), "a duplicate product id is reported");
assert(ids.rules.includes("product-invalid-id"), "a non-kebab-case product id is reported");
assert(ids.result.valid === true, "product id problems never invalidate the bundle");

// A clean, unique, kebab-case set says nothing.
const cleanIds = findingsFor(
  bundleWith(
    [
      { id: "app", title: "A", platforms: ["web"] },
      { id: "admin-dashboard", title: "B", platforms: ["web"] },
    ],
    [node({ metadata: { product: "app" } })],
  ),
);
assert(
  !cleanIds.rules.includes("product-duplicate-id") && !cleanIds.rules.includes("product-invalid-id"),
  "a well-formed unique product set raises no id findings",
);

// A blank id is one finding, not a project-wide cascade: it must not count as
// a declaration and switch the membership rules on.
const blankId = findingsFor(
  bundleWith([{ id: "", title: "Blank", platforms: ["web"] }], [node({ metadata: {} })]),
);
assert(blankId.rules.includes("product-invalid-id"), "a blank product id is reported");
assert(
  !blankId.rules.includes("unassigned-membership"),
  "a blank product id is not a declaration — it does not switch on the membership rules",
);

// Unknown reference
const unknown = findingsFor(
  bundleWith([{ id: "app", title: "A", platforms: ["web"] }], [node({ metadata: { product: "ghost" } })]),
);
assert(unknown.rules.includes("product-unknown-reference"), "membership naming no declared product is reported");
assert(unknown.result.valid === true, "an unknown product reference never invalidates the bundle");
assert(
  !cleanIds.rules.includes("product-unknown-reference"),
  "membership naming a declared product is not reported",
);

// Membership is a local authoring mistake in *any* project: a node naming a
// product before `project.metadata.products` exists is still a dangling
// reference, and a data model never stores membership at all.
const undeclared = findingsFor({
  version: "2",
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [
    node({ metadata: { product: "app" } }),
    node({ id: "DM-2", species: "data-model", metadata: { product: "app" } }),
  ],
  edges: [],
});
assert(
  undeclared.rules.includes("product-unknown-reference"),
  "membership is reported even when the project declares no products",
);
assert(
  undeclared.rules.includes("product-membership-wrong-species"),
  "membership on a data model is reported even when the project declares no products",
);
assert(
  !undeclared.rules.includes("unassigned-membership") &&
    !undeclared.rules.includes("acceptance-product-unassigned"),
  "the unassigned rules stay silent until the project declares products",
);

// Containment
const containment = findingsFor(
  bundleWith(
    [{ id: "admin", title: "Admin", platforms: ["web"] }],
    [node({ platforms: ["web", "ios"], metadata: { product: "admin" } })],
  ),
);
assert(
  containment.rules.includes("product-platform-not-in-menu"),
  "a node platform outside its product's menu is reported",
);
assert(containment.result.valid === true, "containment is a warning, never an error");
assert(
  !cleanIds.rules.includes("product-platform-not-in-menu"),
  "a node fully inside its product's menu is not reported",
);

// Membership on the wrong species
const wrongSpecies = findingsFor(
  bundleWith(
    [{ id: "app", title: "A", platforms: ["web"] }],
    [node({ id: "DM-1", species: "data-model", metadata: { product: "app" } })],
  ),
);
assert(
  wrongSpecies.rules.includes("product-membership-wrong-species"),
  "membership on a data model is reported",
);
assert(
  wrongSpecies.result.findings.some((f) => f.message.includes("data-model membership is derived")),
  "the wrong-species message names the species",
);

// A flow stores membership like any other member species.
const flowMembership = findingsFor(
  bundleWith(
    [{ id: "app", title: "A", platforms: ["web"] }],
    [
      node({
        id: "F-1",
        species: "flow",
        metadata: { product: "app", playlist: { entries: [] } },
      }),
    ],
  ),
);
assert(
  !flowMembership.rules.includes("product-membership-wrong-species"),
  "a flow storing membership is not reported as the wrong species",
);

// A node with no species at all must not produce an "undefined membership"
// message — it falls back rather than interpolating the missing value.
const noSpecies = findingsFor(
  bundleWith([{ id: "app", title: "A", platforms: ["web"] }], [node({ species: undefined, metadata: { product: "app" } })]),
);
assert(
  noSpecies.result.findings.some(
    (f) =>
      f.rule === "product-membership-wrong-species" &&
      f.message.includes("only meaningful on flow, view, and acceptance nodes"),
  ),
  "a node with no species gets the fallback wrong-species message, not \"undefined membership\"",
);

// Unassigned flow/view
const unassigned = findingsFor(
  bundleWith([{ id: "app", title: "A", platforms: ["web"] }], [node({ metadata: {} })]),
);
assert(unassigned.rules.includes("unassigned-membership"), "an unassigned view is reported when products exist");

// Unassigned anchorless acceptance
const anchorless = findingsFor(
  bundleWith(
    [{ id: "app", title: "A", platforms: ["web"] }],
    [node({ id: "AC-1", species: "acceptance", metadata: {} })],
  ),
);
assert(
  anchorless.rules.includes("acceptance-product-unassigned"),
  "an anchorless acceptance with no membership is reported",
);

// Covers spanning two products
const spanning = findingsFor(
  bundleWith(
    [
      { id: "app", title: "A", platforms: ["web"] },
      { id: "admin", title: "B", platforms: ["web"] },
    ],
    [
      node({ id: "V-a", metadata: { product: "app" } }),
      node({ id: "V-b", metadata: { product: "admin" } }),
      node({ id: "AC-1", species: "acceptance", metadata: {} }),
    ],
    [
      { id: "e1", project_id: "p", edge_type: "covers", source_id: "AC-1", target_id: "V-a" },
      { id: "e2", project_id: "p", edge_type: "covers", source_id: "AC-1", target_id: "V-b" },
    ],
  ),
);
assert(
  spanning.rules.includes("acceptance-covers-span-products"),
  "an acceptance covering two products is reported",
);
assert(
  !spanning.rules.includes("acceptance-product-unassigned"),
  "an acceptance that covers something derives membership and is not reported unassigned",
);

// One acceptance, two anchors, one product — derived membership does not span.
const oneProduct = findingsFor(
  bundleWith(
    [{ id: "app", title: "A", platforms: ["web"] }],
    [
      node({ id: "V-a", metadata: { product: "app" } }),
      node({ id: "V-b", metadata: { product: "app" } }),
      node({ id: "AC-1", species: "acceptance", metadata: {} }),
    ],
    [
      { id: "e1", project_id: "p", edge_type: "covers", source_id: "AC-1", target_id: "V-a" },
      { id: "e2", project_id: "p", edge_type: "covers", source_id: "AC-1", target_id: "V-b" },
    ],
  ),
);
assert(
  !oneProduct.rules.includes("acceptance-covers-span-products"),
  "an acceptance whose anchors all sit in one product is not reported as spanning",
);

// The degenerate case is silent
const PRODUCT_RULES = [
  "product-duplicate-id",
  "product-invalid-id",
  "product-unknown-reference",
  "product-platform-not-in-menu",
  "product-membership-wrong-species",
  "unassigned-membership",
  "acceptance-product-unassigned",
  "acceptance-covers-span-products",
];

const silent = validateBundle({
  version: "2",
  project: {
    id: "p",
    title: "P",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  nodes: [node({ metadata: {} })],
  edges: [],
});
assert(
  silent.findings.every((f) => !PRODUCT_RULES.includes(f.rule)),
  "a project declaring no products raises no product findings",
);

// The degenerate-case guarantee, asserted across every species rather than
// inferred from the one-view fixture above: no `products` key and no
// `metadata.product` anywhere means not one product finding. Two of the rules
// fire regardless of whether products are declared, so this is what keeps them
// honest — every project that has never heard of products stays silent.
const untouched = validateBundle({
  version: "2",
  project: {
    id: "p",
    title: "P",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  nodes: [
    node({ metadata: {} }),
    node({ id: "F-1", species: "flow", metadata: { playlist: { entries: [] } } }),
    node({ id: "DM-1", species: "data-model", metadata: {} }),
    node({ id: "API-1", species: "api-endpoint", metadata: {} }),
    node({ id: "AC-1", species: "acceptance", metadata: {} }),
  ],
  edges: [],
});
assert(
  untouched.findings.filter((f) => PRODUCT_RULES.includes(f.rule)).length === 0,
  "a bundle with no product metadata anywhere raises zero product findings, across every species",
);

// Every product finding across every fixture above is a warning.
const everyResult = [
  ids,
  cleanIds,
  blankId,
  unknown,
  undeclared,
  containment,
  wrongSpecies,
  flowMembership,
  noSpecies,
  unassigned,
  anchorless,
  spanning,
  oneProduct,
];
assert(
  everyResult
    .flatMap((entry) => entry.result.findings)
    .filter((f) => PRODUCT_RULES.includes(f.rule))
    .every((f) => f.severity === "warning"),
  "every product finding is warning severity",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/schema/products.test.js`
Expected: `FAIL` lines for the new assertions, exit code 1.

- [ ] **Step 3: Write the implementation**

In `packages/schema/src/validate.ts`, add the import beside the existing `import { isBuiltInMapId } from "./maps";`:

```ts
import { PRODUCT_MEMBERSHIP_SPECIES, resolveProducts } from "./products";
```

Then insert this block immediately after the stored-maps block:

```ts
  // --- Products (docs/spec/bundle-format.md § Products) ---
  // Warning severity only, matching the stored-maps block above. Containment
  // here is cross-object and time-dependent — narrowing a product's platform
  // menu would retroactively invalidate every node in it — so an error would
  // fail CI on what is a product decision, not a corruption. Every projection
  // degrades safely anyway: `effectiveNodePlatforms` intersects.
  const storedProducts = projectMetadata?.products;
  const declaredProductIds = new Set<string>();

  if (Array.isArray(storedProducts)) {
    const seenProductIds = new Set<string>();
    storedProducts.forEach((definition, index) => {
      if (typeof definition !== "object" || definition === null || Array.isArray(definition)) return;
      const product = definition as Record<string, unknown>;
      const path = `project.metadata.products[${index}]`;
      const productId = typeof product.id === "string" ? product.id : undefined;
      if (productId === undefined) return;

      if (seenProductIds.has(productId)) {
        warn(`${path}.id`, "product-duplicate-id", `Duplicate product id "${productId}" — the first wins`);
      } else {
        seenProductIds.add(productId);
        // A blank id still warns below, but must not count as a *declaration*:
        // it would switch the membership rules on and bury the real problem
        // under one `unassigned-membership` per flow, view, and acceptance.
        if (productId.trim() !== "") declaredProductIds.add(productId);
      }

      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(productId)) {
        warn(`${path}.id`, "product-invalid-id", `Product id "${productId}" is not kebab-case`);
      }
    });
  }

  const hasProducts = declaredProductIds.size > 0;

  // `acceptanceId → covers targets`, built once and read twice: the unassigned
  // rule asks only whether an acceptance covers anything, the span rule needs
  // the targets. A covers edge with a non-string endpoint is left out of both —
  // it is already a shape error, and an anchor that cannot be resolved is no
  // evidence that an acceptance derives its membership from somewhere.
  const anchorsByAcceptance = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "covers") continue;
    const source = typeof edge.source_id === "string" ? edge.source_id : undefined;
    const target = typeof edge.target_id === "string" ? edge.target_id : undefined;
    if (source === undefined || target === undefined) continue;
    const list = anchorsByAcceptance.get(source) ?? [];
    list.push(target);
    anchorsByAcceptance.set(source, list);
  }

  const menuByProduct = new Map<string, Set<string>>();
  if (hasProducts) {
    for (const definition of resolveProducts({ metadata: projectMetadata })) {
      menuByProduct.set(
        definition.id,
        new Set<string>(Array.isArray(definition.platforms) ? (definition.platforms as string[]) : []),
      );
    }
  }

  const productByNodeId = new Map<string, string>();
  const indexByNodeId = new Map<string, number>();

  // This loop runs whether or not the project declares products. Membership
  // stored on a species that *derives* it, and membership naming a product that
  // does not exist, are local authoring mistakes in any project — the same
  // reasoning that leaves `gherkin-species` / `values-species` above ungated,
  // and the motivating case is exactly the author who wrote `metadata.product`
  // on a few nodes before adding `project.metadata.products`. Only the two
  // "unassigned" rules need a declared product to mean anything.
  nodes.forEach((node, index) => {
    const nodeId = typeof node.id === "string" ? node.id : `#${index}`;
    const species = node.species as string | undefined;
    const base = `nodes[${index}]`;
    indexByNodeId.set(nodeId, index);
    const metadata = (node.metadata ?? {}) as Record<string, unknown>;
    const membership = typeof metadata.product === "string" ? metadata.product : undefined;
    const storesMembership =
      species !== undefined && (PRODUCT_MEMBERSHIP_SPECIES as readonly string[]).includes(species);

    if (membership !== undefined && !storesMembership) {
      // `storesMembership` inverts a three-species allowlist, so "not a
      // flow/view/acceptance" also catches a missing or bogus species (already
      // a `valid-species` error). Name the species only when it is a real one.
      const detail = SPECIES_IDS.includes(species as SpeciesId)
        ? `${species} membership is derived from consumers and must not be stored`
        : "metadata.product is only meaningful on flow, view, and acceptance nodes";
      warn(`${base}.metadata.product`, "product-membership-wrong-species", `Node ${nodeId}: ${detail}`);
      return;
    }

    if (!storesMembership) return;

    if (membership === undefined) {
      // Nothing to say about assignment until the project declares products.
      if (!hasProducts) return;
      if (species === "acceptance") {
        // An acceptance that covers something derives its membership from the
        // anchor, so only an anchorless one is genuinely unassigned.
        if (!anchorsByAcceptance.has(nodeId)) {
          warn(
            `${base}.metadata.product`,
            "acceptance-product-unassigned",
            `Acceptance ${nodeId} covers nothing and names no product — it will show only under "All products"`,
          );
        }
      } else {
        warn(
          `${base}.metadata.product`,
          "unassigned-membership",
          `Node ${nodeId}: no product membership — it will show only under "All products"`,
        );
      }
      return;
    }

    productByNodeId.set(nodeId, membership);

    if (!declaredProductIds.has(membership)) {
      warn(
        `${base}.metadata.product`,
        "product-unknown-reference",
        `Node ${nodeId}: product "${membership}" is not declared on the project`,
      );
      return;
    }

    const menu = menuByProduct.get(membership);
    const nodePlatforms = Array.isArray(node.platforms) ? (node.platforms as unknown[]) : [];
    if (menu) {
      for (const platform of nodePlatforms) {
        if (typeof platform === "string" && !menu.has(platform)) {
          warn(
            `${base}.platforms`,
            "product-platform-not-in-menu",
            `Node ${nodeId}: platform "${platform}" is not in product "${membership}"'s menu`,
          );
        }
      }
    }
  });

  // An acceptance whose covers anchors span two products (RFC decision 3). Left
  // inside the gate: with nothing declared, every anchor already reported
  // `product-unknown-reference` and a span finding would only repeat it.
  if (hasProducts) {
    for (const [acceptanceId, anchors] of anchorsByAcceptance) {
      // A dangling source is already a `dangling-edge` error; without a node
      // index there is no honest path to hang this warning on, so skip it.
      const acceptanceIndex = indexByNodeId.get(acceptanceId);
      if (acceptanceIndex === undefined) continue;
      const spanned = new Set(anchors.map((id) => productByNodeId.get(id)).filter((id): id is string => Boolean(id)));
      if (spanned.size > 1) {
        warn(
          `nodes[${acceptanceIndex}].metadata.product`,
          "acceptance-covers-span-products",
          `Acceptance ${acceptanceId} covers anchors in ${[...spanned].sort().join(" and ")} — statuses may conflate products`,
        );
      }
    }
  }
```

The blocks above are the code as shipped, reconciled with `validate.ts` after review. Two points worth keeping in view when reading them:

- **Not every rule is scoped to projects that declare products.** `product-membership-wrong-species` and `product-unknown-reference` sit *above* the `hasProducts` gate, because both are local authoring mistakes true in any project — the motivating case is the author who writes `metadata.product` on a few nodes before adding `project.metadata.products`, which a gate would hide. The other rules stay inside the gate: "unassigned" and "out of menu" mean nothing until something is declared. The invariant that survives either way, and that the test block asserts across every species: a bundle with no `products` key and no `metadata.product` anywhere raises **zero** product findings.
- **Do not introduce helpers or restructure `validateBundle`.** It is long, and the products block is the cleanest extraction seam in it, but that is a follow-up, not this task.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/schema/products.test.js`
Expected: every line `PASS:`, exit code 0 (63 assertions).

- [ ] **Step 5: Verify nothing else regressed**

Run: `npx tsc --noEmit && npm run test:schema && npm run test:fixtures && npm run test:maps && npm run test:acceptance && npm run validate:seeds`
Expected: all pass. `validate:seeds` matters most — the seeds declare no products, so **not one product finding may appear**.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/validate.ts tests/schema/products.test.js
git commit -m "feat: warn on product membership problems without failing a bundle"
```

---

### Task 6: Regenerate contract artifacts and write the spec section

**Files:**
- Modify: `docs/spec/bundle-format.md`
- Modify: `docs/spec/maps.md`
- Generated (do not hand-edit): `docs/arkaik-skill/references/schema.md`, `public/schema/*.json`, `app/llms-full.txt`, `docs/arkaik-skill/scripts/validate-bundle.js`, the plugin channel

- [ ] **Step 1: Write § Products in `docs/spec/bundle-format.md`**

Insert a new `## Products` section immediately after `## Project Additions`. It must state, in the file's existing voice:

- The `ProductDefinition` shape, as the TypeScript interface from `packages/schema/src/products.ts`, in a `ts` code block.
- That definitions live at `project.metadata.products`, following the `project.metadata.maps` precedent.
- That `node.metadata.product` stores membership on **flow, view, and acceptance only**, and that `data-model` / `api-endpoint` membership is derived from `calls` / `displays` / `queries` consumers.
- That `node.platforms` remains authoritative and **should** be a subset of its product's `platforms`; violations warn, never error, with the one-sentence reason (the menu is edited independently of the node).
- That `platforms: []` means availability is not a tracked dimension, and such a product carries a single lifecycle status.
- The degenerate-case guarantee: no `products` key → one implicit product spanning `PLATFORM_IDS`, every node in it, no warnings, no migration.
- The full validation table from the spec's decision 7, with every rule marked `warning`.

- [ ] **Step 2: Document the map filter in `docs/spec/maps.md`**

In the `MapDefinition` section, document `product?: string` — "scopes the map to one product; absent selects every product" — and note it composes with `root_node_id` (the product's own `root_node_id` is the fallback anchor when the map does not set one).

- [ ] **Step 3: Regenerate**

Run: `npm run generate`
Expected: exits 0 and produces a diff in the generated files listed above.

- [ ] **Step 4: Verify the regeneration is coherent**

Run: `npm run validate:seeds && npm run test:fixtures && npx tsc --noEmit`
Expected: all pass.

Then confirm `ProductDefinition` actually reached the JSON Schema:

Run: `grep -c "ProductDefinition" public/schema/*.json docs/arkaik-skill/references/schema.md`
Expected: a non-zero count in each file.

- [ ] **Step 5: Commit**

```bash
git add docs/spec/bundle-format.md docs/spec/maps.md docs/arkaik-skill public/schema app/llms-full.txt plugin
git commit -m "docs: specify products in the bundle format and regenerate contracts"
```

---

## Phase B — App plumbing

### Task 7: The scope hooks

`useProductScope` owns the value; `useEffectiveProduct` is what surfaces call. The indirection exists so the deferred per-surface-override milestone changes one function, not five components.

**Files:**
- Create: `lib/hooks/useProductScope.ts`
- Create: `lib/utils/product-scope.ts`

- [ ] **Step 1: Write the app-side helpers**

Create `lib/utils/product-scope.ts`:

```ts
/**
 * App-side helpers over the schema's product projections. The schema package
 * owns the semantics (packages/schema/src/products.ts); this module owns the
 * shapes the React surfaces want — chiefly the arity that decides whether a
 * surface renders per-platform or single-status.
 */

import type { PlatformId } from "@/lib/config/platforms";
import type { Node, Project } from "@/lib/data/types";
import {
  effectiveNodePlatforms,
  productOf,
  productPlatforms,
  resolveProducts,
  type ProductDefinition,
} from "@arkaik/schema";

/** Everything a surface needs to pick its shape and filter its nodes. */
export interface ProductScope {
  /** `null` = All products. */
  productId: string | null;
  product: ProductDefinition | null;
  /** The platform menu — the sole input to the arity rule. */
  platforms: PlatformId[];
  /** True when the surface renders per-platform columns/rings. */
  isMultiPlatform: boolean;
  /** Every declared product by id, so per-node lookups cost nothing. */
  productsById: Map<string, ProductDefinition>;
}

// Products live on `bundle.project.metadata` — `ProjectBundle` has no
// `metadata` of its own, so this takes the bundle and drills in itself.
export function resolveProductScope(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  productId: string | null,
): ProductScope {
  const project = bundle?.project;
  const products = resolveProducts(project);
  const productsById = new Map(products.map((candidate) => [candidate.id, candidate]));
  const product = productId === null ? null : productsById.get(productId) ?? null;
  const platforms = productPlatforms(project, productId);
  return { productId, product, platforms, isMultiPlatform: platforms.length >= 2, productsById };
}

/**
 * Does this node belong in the scope? Flows, views, and acceptances match by
 * stored membership; `null` scope matches everything. A node with no membership
 * is in triage and shows only under "All products".
 */
export function nodeInScope(node: Pick<Node, "species" | "metadata">, scope: ProductScope): boolean {
  if (scope.productId === null) return true;
  return productOf(node) === scope.productId;
}

/**
 * The platforms this node actually has, given the scope.
 *
 * The **node's own product menu governs**, not the scope's platform list. That
 * distinction is the whole delivery fix: under "All products" the scope's list
 * is the union of every product, so intersecting against it would leave a
 * web-only admin view contributing to the Android column exactly as it does
 * today. Falling back to `scope.product` covers the node that stores no
 * membership while a single product is scoped.
 */
export function scopedPlatforms(
  node: Pick<Node, "species" | "platforms" | "metadata">,
  scope: ProductScope,
): PlatformId[] {
  const ownId = productOf(node);
  const own = ownId === null ? null : scope.productsById.get(ownId) ?? null;
  return effectiveNodePlatforms(node, own ?? scope.product);
}
```

- [ ] **Step 2: Write the shared store**

The scope value must live in **one** place. Two independent callers read it —
the Task 8 selector and every surface via `useEffectiveProduct` — so a
`useState` inside the hook would give each its own copy, and picking a product
would relabel the selector and change nothing else. A same-tab
`localStorage.setItem` fires no `storage` event, so persistence does not
propagate either.

Create `lib/utils/product-scope-store.ts`: a module-level
`Map<projectId, string | null>` lazily hydrated from
`localStorage` (guard `typeof window === "undefined"`, and wrap the access in
try/catch for private-mode browsers), plus a `Set` of listeners. Export
`getProductScopeId(projectId)`, `setProductScopeId(projectId, next)` (a no-op
when the value is unchanged, so re-selecting causes no render storm),
`subscribeProductScope(listener)` returning an unsubscribe, and
`resetProductScopeStore()` as a test seam. This mirrors
`lib/sync/sync-manager.ts:176`, the repo's existing `useSyncExternalStore`
store.

- [ ] **Step 3: Write the hooks**

Create `lib/hooks/useProductScope.ts`:

```ts
"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ProjectBundle } from "@/lib/data/types";
import {
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
} from "@/lib/utils/product-scope-store";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";

/**
 * The global product scope, persisted per project in localStorage.
 *
 * Not a URL param on purpose: the scope spans every route under
 * /project/[id], so a query param would have to be threaded through all of
 * them while fighting the existing `species` / `panel` param handling in
 * app/project/[id]/layout.tsx. The trade-off — a shared link does not carry
 * scope — is fine, because a link to a node is about the node.
 *
 * The value lives in the store, not in this hook, so the selector and every
 * surface see the same one.
 *
 * `getServerSnapshot` is `null` because localStorage does not exist during SSR.
 * React renders that during hydration and re-reads the store immediately after,
 * so there is no mismatch. Nothing visibly flashes either, for a reason
 * external to this hook: `useProject` loads the bundle in an effect, so
 * `project` is `undefined` on the server *and* on the client's first render,
 * and with no products declared `productPlatforms` short-circuits to every
 * platform — every field of the resolved scope except `productId` is identical
 * across that boundary whatever localStorage held.
 */
export function useProductScope(projectId: string) {
  const productId = useSyncExternalStore(
    subscribeProductScope,
    () => getProductScopeId(projectId),
    () => null,
  );

  const setScope = useCallback((next: string | null) => setProductScopeId(projectId, next), [projectId]);

  return { productId, setScope };
}

/**
 * What every surface calls — never `useProductScope` directly.
 *
 * Today this is the global scope, resolved against the project. The deferred
 * per-surface override milestone changes exactly this function to
 * `override ?? global`, which is why no surface may read the global value
 * itself.
 *
 * Memoized because the result carries a `Map` and feeds the `useMemo`
 * dependency lists of the scoped projections in Tasks 11-13. An object rebuilt
 * every render would defeat every one of them.
 */
export function useEffectiveProduct(
  projectId: string,
  project: ProjectBundle | undefined,
): ProductScope & { setScope: (next: string | null) => void } {
  const { productId, setScope } = useProductScope(projectId);
  const scope = useMemo(() => resolveProductScope(project, productId), [project, productId]);
  return useMemo(() => ({ ...scope, setScope }), [scope, setScope]);
}
```

- [ ] **Step 4: Test the pure parts**

`lib/utils/product-scope.ts` and `lib/utils/product-scope-store.ts` are both
loadable in plain Node; the hook is not (no React test runner here). Create
`tests/app/product-scope.test.js` + `tests/app/load-product-scope.js` on the
`tests/app/load-pyramid.js` pattern, register `test:product-scope` in
`package.json`, and add a step to the fast-tests job in
`.github/workflows/ci.yml` beside its siblings.

Two assertions carry the task. First: under "All products", a web-only
product's view with a stale three-platform `platforms` array yields `["web"]`,
not the union — the fixture needs a second, multi-platform product or the union
is not genuinely wider and the assertion is decorative. Second: subscribe two
listeners to the store, set once, and assert both fire and both snapshots
agree — that is the sharing the whole feature rests on.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useProductScope.ts lib/utils/product-scope.ts lib/utils/product-scope-store.ts \
  tests/app/product-scope.test.js tests/app/load-product-scope.js package.json .github/workflows/ci.yml
git commit -m "feat: a per-project product scope every surface resolves through one hook"
```

---

### Task 8: The scope selector in the shell

**Files:**
- Create: `components/layout/ProductScopeSelector.tsx`
- Modify: `components/layout/ProjectSidebar.tsx:86-110`

- [ ] **Step 1: Build the selector**

Create `components/layout/ProductScopeSelector.tsx`. Requirements:

- Props: `{ projectId: string; project: ProjectBundle | undefined }`.
- Calls `resolveProducts(project?.project)` — products live on `bundle.project.metadata`, and passing the bundle itself is a hard `TS2345`. **If the list is empty, return `null`** — a project with no products shows no new control and no new concept.
- Otherwise renders a `Select` from `components/ui/select.tsx` (read that file for the exact primitive names before writing) with an "All products" option plus one option per product, each showing the product title and its platform count as secondary text (`Web only`, `3 platforms`, `No platforms`).
- Reads and writes through `useProductScope(projectId)`.
- Sits inside `SidebarHeader`, directly beneath `ProjectSwitcher`, and matches its width and typography.

- [ ] **Step 2: Mount it**

In `components/layout/ProjectSidebar.tsx`, inside `SidebarHeader` after the `<ProjectSwitcher … />` element, render `<ProductScopeSelector projectId={…} project={…} />`. Read the component's existing props to find the project id and bundle it already receives; add a prop only if neither is available.

- [ ] **Step 3: Verify**

Run: `npm run generate && git status --short`
Expected: no unstaged generated files. The selector's leading icon is a lucide
icon the tree has not used before, so `lib/wobble/wobble-registry.generated.ts`
and `app/wobble.generated.css` both move and both must be committed — see
Ground rule 6. This is the same trap as the commit immediately preceding this
branch ("regenerate the wobble registry for the new toolbar icons").

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint 2>&1 | tail -5`
Expected: the same problem count as before this task (see Ground rule 1).

- [ ] **Step 4: Commit**

```bash
git add components/layout/ProductScopeSelector.tsx components/layout/ProjectSidebar.tsx \
  lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "feat: switch between the products in a project from the sidebar"
```

---

## Phase C — The arity primitive

### Task 9: `PlatformRingSet` and `PlatformGaugeList` take an explicit platform list

Both components currently import the global `PLATFORMS` array, which is exactly the hardcoding this feature removes.

**Files:**
- Modify: `components/graph/nodes/PlatformRingSet.tsx:13-18, 55-…`
- Modify: `components/graph/nodes/PlatformGaugeList.tsx:11-27`
- Modify: every call site (`PyramidElementCard`, `PyramidElementRow`, `FlowNode`, `NodeDetailPanel`, `NodeCard`, `PlatformGaugesCard`)

- [ ] **Step 1: Add the prop to `PlatformRingSet`**

Add `platforms?: PlatformId[]` to `PlatformRingSetProps`. Replace the module-level `RING_PLATFORMS` constant with a value computed inside the component:

```tsx
  const ringPlatforms = (platforms ?? PLATFORMS.map((platform) => platform.id))
    .slice()
    .sort((left, right) => rank(left) - rank(right));
```

Render one `StatusRing` per entry of `ringPlatforms`, looking each label and icon up from `PLATFORM_LABELS` / `PLATFORM_ICONS`. **Keep `RING_ORDER` and `rank` exactly as they are** — the Web → Android → iOS ring order is a deliberate visual decision documented in that file's comment.

Leave the default (`platforms` omitted) behaving exactly as today, so untouched call sites do not change.

- [ ] **Step 2: Make `PlatformGaugeList`'s list authoritative**

`PlatformGaugeList` already computes `activePlatforms` by unioning its `platforms` prop with any platform present in the rollup. That union is now wrong: a rollup can carry a platform the scope excludes. Change it to:

```tsx
  const activePlatforms = PLATFORMS.filter((platform) => platforms.includes(platform.id));
```

Then update every call site that relied on the union to pass an explicit list.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any call site the compiler flags.

Run: `npm run test:pyramid && npm run test:delivery && npm run test:acceptance-matrix`
Expected: all pass — these are pure-logic suites and must be untouched by this task.

- [ ] **Step 4: Commit**

```bash
git add components/graph/nodes/PlatformRingSet.tsx components/graph/nodes/PlatformGaugeList.tsx components/graph/nodes components/pyramid components/overview components/panels components/library
git commit -m "refactor: rings and gauges render the platforms they are given"
```

---

### Task 10: `PlatformAvailability` — the one place the arity rule lives

**Files:**
- Create: `components/graph/nodes/PlatformAvailability.tsx`

- [ ] **Step 1: Build it**

Create `components/graph/nodes/PlatformAvailability.tsx`:

**The shape decision is extracted, not inlined.** There is no React test runner
here, so a rule eight surfaces inherit would otherwise be unpinned — and the
2-platform boundary is the one an off-by-one breaks silently. Put
`platformAvailabilityShape(platforms): "rings" | "bar"` in
`lib/utils/product-scope.ts` (already the app-side arity module, already loadable
by `tests/app/load-product-scope.js`), have `resolveProductScope`'s
`isMultiPlatform` **derive** from it rather than re-compare, and make the
component a thin switch over it. Assert arity 3/2/1/0 in
`tests/app/product-scope.test.js`.

**The bar carries no platform icon — at arity 1 as well as arity 0** (spec § 4).
So it is *not* a `PlatformGaugeList` call: that component's empty guard returns
`null` at arity 0, stranding the count beside a phantom gap, and delegating only
at arity 1 would leave two markup paths to keep identical by hand. Render the
track directly, one path for both arities:

```tsx
"use client";

import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup, StatusSegment } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments, getRollupTotalSegments } from "@/lib/utils/platform-status";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { STATUS_LABELS, STATUS_STYLES } from "./node-styles";
import { PlatformRingSet } from "./PlatformRingSet";
import type { StatusRingSize } from "./StatusRing";

/** All-zero segments — the track at arity 0, where nothing can be counted. */
const NOTHING_COUNTED = getRollupTotalSegments({ counts: {}, totals: {} });

/** The bar's accessible name; the icon that used to carry it is gone by design. */
function describeTrack(segments: readonly StatusSegment[]): string {
  const present = segments.filter((segment) => segment.count > 0);
  if (present.length === 0) return "Status: nothing counted yet";
  const parts = present.map((segment) => `${segment.count} ${STATUS_LABELS[segment.status].toLowerCase()}`);
  return `Status: ${parts.join(", ")}`;
}

interface PlatformAvailabilityProps {
  rollup: PlatformStatusRollup;
  /** The scope's effective platforms — the sole input to the arity rule. */
  platforms: PlatformId[];
  count: number;
  size?: StatusRingSize;
  /** Defaults to `PlatformRingSet`'s own default: in the bar the count is visible text. */
  countLabel?: string;
  platformCountLabel?: string;
}

/**
 * **The arity rule lives here and nowhere else.**
 *
 * Two or more effective platforms → the aggregate ring plus one ring per
 * platform, as before. One or zero → a single bar with the count beside it: at
 * arity 1 the aggregate ring and the platform ring carry identical numbers, and
 * a lone ring beside three-ring cards in another scope reads as *data missing*
 * rather than *absent*.
 *
 * **The bar carries no platform icon at either arity, so 1 and 0 render
 * identically — that is the invariant, not a coincidence.** Nothing below may
 * grow an arity-dependent branch.
 *
 * Every platform-bearing surface composes this rather than choosing a shape
 * itself, so the Pyramid and the Overview can never disagree.
 */
export function PlatformAvailability({
  rollup,
  platforms,
  count,
  size = "sm",
  countLabel = "acceptances",
  platformCountLabel,
}: PlatformAvailabilityProps) {
  if (platformAvailabilityShape(platforms) === "rings") {
    return (
      <PlatformRingSet
        rollup={rollup}
        platforms={platforms}
        count={count}
        size={size}
        countLabel={countLabel}
        platformCountLabel={platformCountLabel}
      />
    );
  }

  // Destructured, not length-tested: `only` is the platform in scope, and its
  // absence at arity 0 means nothing to count — not a second case to render.
  const [only] = platforms;
  const segments = only ? getPlatformRollupSegments(rollup, only) : NOTHING_COUNTED;
  const counted = segments.some((segment) => segment.count > 0);

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 sm:w-32">
        <div className="flex h-2 overflow-hidden rounded-md bg-muted" role="img" aria-label={describeTrack(segments)}>
          {counted ? (
            segments.map((segment) => {
              if (segment.count === 0) return null;
              return (
                <div
                  key={segment.status}
                  className={STATUS_STYLES[segment.status].dot}
                  style={{ width: `${segment.ratio * 100}%` }}
                  title={`${segment.status}: ${segment.percentage}%`}
                />
              );
            })
          ) : (
            <div className="h-full w-full bg-muted-foreground/25" title="No counted statuses" />
          )}
        </div>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
        {countLabel ? ` ${countLabel}` : ""}
      </span>
    </div>
  );
}
```

This aligns with **Task 11** by construction, not by coincidence: the acceptances
matrix renders "a single status column headed `Status` with no platform icon" at
arity ≤ 1, and the Pyramid's bar drops its icon for the same reason. One rule,
two surfaces.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test:product-scope`
Expected: all `PASS`. Then prove the boundary assertions discriminate: mutate the
threshold in `platformAvailabilityShape` from `>= 2` to `> 2`, re-run, confirm
**exactly one** failure (the arity-2 assertion), restore, confirm green.

- [ ] **Step 3: Commit**

```bash
git add components/graph/nodes/PlatformAvailability.tsx lib/utils/product-scope.ts tests/app/product-scope.test.js
git commit -m "feat: one primitive decides whether availability reads as rings or a bar"
```

---

## Phase D — Surfaces

> **Carried forward from Task 11, for every task after it:**
>
> - **`filterAcceptances` now takes four arguments** — `(acceptances, edges, nodesById, filters)`. `nodesById` sits beside `edges` (matching `groupAcceptancesByAnchor`) because resolving an acceptance's product means resolving its anchors. A new call site that passes three will fail to typecheck rather than silently mis-scope, but knowing beats discovering.
> - **The product scope is never a URL param.** It is the shell's, persisted per project in localStorage (§ Decision 2); each surface layers `scope.productId` onto its own filters at the page. Tasks 13 and 14 have their own filter bars and must do the same.
> - **An acceptance's product comes from its anchors** when it has any, from stored `metadata.product` only when it has none (§ Decision 5). Any later task that derives acceptance membership must use the same precedence, or two surfaces will disagree about the same node.
>
> **Carried forward from Task 13, for every task after it:**
>
> - **`productsOfNode(node, graph)` in `lib/utils/product-scope.ts` is the single entry point** for "which products does this node belong to?", for *every* species: stored membership for flows and views, anchors-first for acceptances, the usage index for data models and endpoints. Tasks 15-17 must call it rather than re-deriving membership — three surfaces asked the question three ways before it existed, and two disagreed about the same acceptance. `productsOfAcceptance` moved here from `lib/utils/acceptance-matrix.ts` (which now re-exports it); there is one copy.
> - **`nodeInScope(node, scope, graph?)` takes an optional third argument.** With a `graph` it delegates to `productsOfNode`; without one it degrades to stored membership, which is all a caller holding no edges can honestly answer. Pass the graph.
> - **`ProductGraph` is `{ edges, nodesById, usageIndex }`**, assembled once per snapshot at the page with `useMemo`. `buildProductUsageIndex` is a traversal — never build it per node. Any surface passing one must already gate on `edgesLoading`.
> - **An empty product set means two different things, and `nodeInScope` resolves both.** For a flow, view, or acceptance it is *triage* — nobody has assigned it — so it is **out** of every named scope. For a data model or endpoint it is an *orphan* — nothing in the graph reaches it — so it is **in** every named scope, because hiding it would bury exactly the node that needs attention.
>
> **Carried forward from Task 16, for every task after it:**
>
> - **Shape decisions read `scope.platforms`; per-node facts read `scopedPlatforms(node, scope)`.** *How many platform columns/rings/tabs does this surface show* is the scope's question — `AcceptanceMatrix`, `PlatformAvailability`, and the detail panel's tab strip all read the **menu**, so they cannot disagree. *What does this node ship on* is the node's — chips (`PlatformList`, `NodeCard`) read `scopedPlatforms`. Getting the two the wrong way round is not a style choice: with no products declared `scopedPlatforms` answers `node.platforms`, so a shape driven by it collapses for any node narrower than the menu, in a project that has never heard of products. That is the **degenerate case guarantee** broken (spec § Degenerate case guarantee) — `seed/pebbles.json` has ten single-platform views that would show it.
> - **A flow's gauges clamp, they never drop the widening.** `scopedRollupPlatforms(declared, rollup, scope.platforms)` at every gauge site, and `flowGaugePlatforms` where an empty `declared` needs the scope's menu as its fallback. Both live in `lib/utils/platform-status.ts`; neither should be re-inlined.

### Task 11: Acceptances — scoped filter, collapsing columns, the Unanchored rename

**Files:**
- Modify: `lib/utils/acceptance-matrix.ts:17-30, 62-75, 76-95`
- Modify: `components/acceptances/AcceptanceMatrix.tsx`
- Modify: `components/acceptances/AcceptanceFilterBar.tsx`
- Modify: `tests/app/acceptance-matrix.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/app/acceptance-matrix.test.js` (follow the file's existing fixture and `assert` style — read it first):

- `filterAcceptances` with `{ product: "admin" }` keeps acceptances whose **anchors** are in `admin`, **plus** anchorless acceptances whose stored membership is `admin`.
- `filterAcceptances` with `{ product: "admin" }` drops an anchorless acceptance with **no** membership.
- `filterAcceptances` with `{ product: null }` keeps everything, including unassigned ones.
- An acceptance with covers anchors is scoped by the *anchor's* product, not its own metadata. Build a fixture where the two **disagree** — an acceptance storing `end-user` that covers an `admin` view — or the assertion is vacuous.
- An acceptance whose anchors span two products appears under both scopes.
- An acceptance anchored only to an *unassigned* view is dropped from every product scope, even though it stores one — the anchors-first consequence in § Decision 5.
- `groupAcceptancesByAnchor` returns the anchorless bucket with `anchorId: null` as before — assert the bucket still comes last, and that any user-facing label constant now reads `Unanchored`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:acceptance-matrix`
Expected: `FAIL` lines for the new assertions.

- [ ] **Step 3: Implement**

In `lib/utils/acceptance-matrix.ts`:

- Add `product: string | null` to `AcceptanceFilters` and `product: null` to `EMPTY_FILTERS`.
- Add a `productsOfAcceptance(acceptance, edges, nodesById)` helper returning the set of products an acceptance belongs to. **Anchors win:** when it covers one or more resolvable anchors, the set is `productOf(anchor)` across them; stored `metadata.product` is read **only** when it covers nothing. Membership is a property of what an acceptance covers, and a stored key that out-voted the graph could claim a product none of its anchors belong to (spec § Decision 5, RFC decision 3).
- In `filterAcceptances`, when `filters.product !== null`, keep an acceptance only when its resolved product set contains the scope. An acceptance with an **empty** resolved set is dropped — it belongs to triage, visible only under All products. That covers two cases and needs no branch for either: anchorless-and-unassigned, and anchored only to views or flows that are themselves unassigned.
- `product` stays **out** of the URL `KEYS` in `components/acceptances/acceptance-filters.ts`, and `readFilters` always returns `product: null`; the page layers the live scope on top. The scope is the shell's, persisted per project in localStorage (§ Decision 2), and giving it a second home in the query string is two values that can disagree. **The same holds for Tasks 13 and 14**, which have their own filter bars.
- Rename the user-facing label of the `anchorId: null` bucket to `Unanchored` wherever it is rendered. The `AnchorGroup.anchorId === null` contract does not change; only the label and the doc comment do. Update the comment at `:78` — "null = product-level (0 covers edges)" now means the wrong thing.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:acceptance-matrix`
Expected: all `PASS`.

- [ ] **Step 5: Collapse the columns**

In `AcceptanceMatrix.tsx`: take the scope's `platforms` and render one status column per entry. At `platforms.length <= 1`, render a **single** status column headed `Status` with no platform icon.

In `AcceptanceFilterBar.tsx`: build the platform options from the scope's platforms, and **hide the platform filter entirely** when `platforms.length <= 1`. When hidden, force `filters.platform` back to `"all"` so a stale filter cannot silently empty the list.

Both read the scope via `useEffectiveProduct` — never `useProductScope`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run test:acceptance-matrix`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/acceptance-matrix.ts components/acceptances tests/app/acceptance-matrix.test.js
git commit -m "feat: the acceptances matrix shows one status column for a single-platform product"
```

---

### Task 12: Pyramid — rings or a bar, by arity

**Files:**
- Modify: `lib/utils/pyramid.ts:38-70`
- Modify: `components/pyramid/PyramidElementCard.tsx`
- Modify: `components/pyramid/PyramidElementRow.tsx`
- Modify: `app/project/[id]/pyramid/page.tsx`
- Modify: `tests/app/pyramid.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/app/pyramid.test.js` (match the file's existing style):

- `computePyramidAggregation(acceptances, { platforms: ["web"] })` counts only web statuses into each element's rollup, even when the acceptances carry iOS statuses.
- `computePyramidAggregation(acceptances, { platforms: ["web", "ios", "android"] })` matches today's output for the same fixture — the degenerate case, asserted rather than assumed.
- `acceptanceCount` is unchanged by the platform menu; it counts acceptances, not platform statuses.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:pyramid`
Expected: `FAIL` lines for the new assertions.

- [ ] **Step 3: Implement**

Change `computePyramidAggregation`'s second parameter from `platform?: PlatformId` to `options?: { platforms?: PlatformId[] }`, keeping the single-platform behavior expressible as `{ platforms: [p] }`. Inside the loop, replace the `platform !== undefined && platformId !== platform` guard with a menu membership check. Update every existing call site the compiler flags.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:pyramid`
Expected: all `PASS`.

- [ ] **Step 5: Swap the component**

In `PyramidElementCard.tsx` and `PyramidElementRow.tsx`, replace `<PlatformRingSet rollup={…} count={…} size={…} />` with `<PlatformAvailability rollup={…} platforms={…} count={…} size={…} />`, threading `platforms` down from the page through `PyramidElementViewProps` and `PyramidTierGroup`. The page reads it from `useEffectiveProduct`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run test:pyramid`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/pyramid.ts components/pyramid app/project/\[id\]/pyramid tests/app/pyramid.test.js
git commit -m "feat: the pyramid reads as one bar when a product ships on one platform"
```

---

### Task 13: Delivery — honest denominators

**Files:**
- Modify: `lib/utils/delivery.ts:30-52`
- Modify: `lib/utils/product-scope.ts` — the resolver, see Step 3b
- Modify: `lib/utils/acceptance-matrix.ts` — `productsOfAcceptance` moves out
- Modify: `components/delivery/DeliveryFilterBar.tsx`
- Modify: `app/project/[id]/delivery/page.tsx`
- Modify: `tests/app/delivery.test.js`

**Delivery renders acceptances too.** `SPECIES_OPTIONS` in `DeliveryFilterBar` offers Views, Acceptances, API Endpoints, and Data Models, and the existing suite asserts acceptance expansion. So this surface is the third to need node→product resolution, and Step 3b unifies it.

- [ ] **Step 1: Write the failing test**

Add to `tests/app/delivery.test.js`. The fixture is the RFC's headline complaint, stated as an assertion:

- Two products: `app` (`["web", "ios", "android"]`) and `admin` (`["web"]`).
- A view in `admin` with `platforms: ["web"]`, and a view in `app` with `platforms: ["web", "ios", "android"]`.
- `computeDeliveryItems(nodes, species, { scope: allProducts })` yields **no** item pairing the admin view with `ios` or `android`.
- `computeDeliveryItems(nodes, species, { scope: adminScope })` yields items for the admin view only.
- `computeDeliveryItems(nodes, species)` with no options matches today's output exactly — the degenerate case.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:delivery`
Expected: `FAIL` lines for the new assertions.

- [ ] **Step 3: Implement**

Give `computeDeliveryItems` a third parameter `options?: { scope?: ProductScope }`. When a scope is present:

- Skip nodes where `nodeInScope(node, scope)` is false.
- Expand each surviving node over `scopedPlatforms(node, scope)` rather than `node.platforms`.

`scopedPlatforms` already does the right thing: it intersects against the **node's own product** menu (looked up in `scope.productsById`), not the scope's platform union. That is the whole fix — under All products the union is `["web", "ios", "android"]`, so intersecting against *that* would leave the admin view in the Android column exactly as it is today. Do not add a second helper; if the lookup seems to be missing, re-read `lib/utils/product-scope.ts` from Task 7.

**Keep the flow exclusion exactly as it is** — the comment at `delivery.ts:19-27` explains why flows are dropped regardless of the species filter, and that reasoning is unchanged.

- [ ] **Step 3b: Promote one resolver into `lib/utils/product-scope.ts`**

Delivery is the third surface needing node→product resolution, so unify it here rather than adding a third spelling. Add:

```ts
productsOfNode(node, { edges, nodesById, usageIndex }): Set<string>
```

- `flow` / `view` — stored `metadata.product`; empty set when absent.
- `acceptance` — **anchors-first** (§ Decision 5). Move `productsOfAcceptance` and its private `coveredAnchorIds` out of `lib/utils/acceptance-matrix.ts` into `product-scope.ts`; the matrix imports and re-exports them. The dependency runs one way only — `product-scope.ts` must never import the matrix — so there is no cycle.
- `data-model` / `api-endpoint` — `productsUsingNode(node.id, usageIndex)` from `@arkaik/schema`.

Then `nodeInScope(node, scope, graph?)` delegates to it, keeping the 2-arg form working (it degrades to stored membership). **An empty set means two different things**: triage for the species that store membership (out of every named scope), an orphan for the system layer (in every named scope — hiding it would bury exactly the node needing attention, and Task 14 gives Library the same rule).

`computeDeliveryItems` takes `graph` alongside `scope` in its options; the page builds `usageIndex` with one `useMemo` per snapshot and already gates on `edgesLoading`.

This is what makes an acceptance covering an `admin` view scope identically on Delivery and Acceptances whatever its stored key says — structurally, not by convention.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:delivery`
Expected: all `PASS`.

- [ ] **Step 5: Scope the filter bar**

`DeliveryFilterBar.tsx` builds its platform options from the scope's platforms and hides the platform control at arity ≤ 1, resetting the filter to `"all"` on hide — same rule as Task 11 Step 5.

The board's empty state must stop saying "widen the platform filter" under a named scope, where that control is hidden and the product is what is actually narrowing the board. Offer "try another product" instead.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run test:delivery`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/delivery.ts lib/utils/product-scope.ts components/delivery app/project/\[id\]/delivery tests/app/delivery.test.js
git commit -m "feat: a web-only product stops dragging down the Android delivery numbers"
```

---

### Task 14: Library — scoped list, product badge, "used by" badge

**Files:**
- Modify: `components/library/NodeCard.tsx`
- Modify: `components/library/NodeTable.tsx`
- Modify: `components/library/LibraryFilterBar.tsx`
- Modify: `app/project/[id]/library/page.tsx`

- [ ] **Step 1: Filter the list**

**Task 13 already built this — do not write a second membership rule.** `nodeInScope(node, scope, graph)` in `lib/utils/product-scope.ts` implements every bullet below, for every species, via `productsOfNode`. Call it:

```tsx
const usageIndex = useMemo(() => buildProductUsageIndex(nodes, edges), [nodes, edges]);
const graph = useMemo(() => ({ edges, nodesById, usageIndex }), [edges, nodesById, usageIndex]);
// …
nodes.filter((node) => nodeInScope(node, scope, graph))
```

What that gives you, for reference — the behaviour is already implemented and tested in `tests/app/delivery.test.js`:

- `flow` / `view` — stored membership; unassigned nodes are triage, visible under All products only.
- `acceptance` — anchors-first, stored key only when it covers nothing (§ Decision 5).
- `data-model` / `api-endpoint` — kept when `productsUsingNode(node.id, usageIndex)` includes the scope, **or** when that list is empty. An orphan belongs to no product and must stay visible in every scope; hiding it would bury exactly the node that needs attention.

Build the usage index once per snapshot with `useMemo(() => buildProductUsageIndex(nodes, edges), [nodes, edges])` — never per card. Gate on `edgesLoading` before passing the graph.

- [ ] **Step 2: Badge the cards**

`NodeCard.tsx`: for flows/views/acceptances show the product title as a badge when the project declares products; for data models and endpoints show `Used by: A, B`, or `Unattached` when the list is empty. `NodeTable.tsx` gets the same as a column. Use the existing badge primitive in `components/ui/` — read it first rather than inventing a style.

- [ ] **Step 3: Scope the platform chips**

Any platform chips rendered on library cards use `scopedPlatforms(node, scope)`.

**The flow gauge is the exception — clamp, do not drop the widening.** `NodeCard.tsx`'s
`PlatformGaugeList` passes `withRollupPlatforms(node.platforms, flowRollup)` (Task 9),
because a flow's rollup is aggregated from descendant views and can count a platform the
flow itself never declares. Scoping it is a **filter on top of** that widening, not a
replacement for it:

```tsx
withRollupPlatforms(node.platforms, flowRollup).filter((p) => scope.platforms.includes(p))
```

Under "All products" the menu is the union of every declared product, so the widened
platform is in it and the bar still shows — today's behavior, exactly preserved. Under a
web-only scope the menu is `["web"]` and the widened android bar clamps out. Passing
`scopedPlatforms(node, scope)` straight through instead would silently drop counted work
in the unscoped case, which is the common one. Same rule, same reasoning, at Task 16 Step 2.

**The data smell this rests on is real — do not "fix" it.** The seed's `F-swap-glyph`
declares web/ios while its descendant `V-glyphs-list` declares android, which is arguably
a seed authoring bug. It is nonetheless real data the code must handle, and it is what
makes the widening load-bearing rather than hypothetical. Leave `seed/pebbles.json` alone.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint 2>&1 | tail -5`
Expected: no new problems.

- [ ] **Step 5: Commit**

```bash
git add components/library app/project/\[id\]/library
git commit -m "feat: the library shows what a product owns and what it borrows"
```

---

### Task 15: Overview cards

**Files:**
- Modify: `components/overview/PlatformGaugesCard.tsx`
- Modify: `components/overview/ParityCard.tsx`
- Modify: `components/overview/PyramidCard.tsx`
- Modify: `components/overview/DeliverySnapshotCard.tsx`
- Modify: `app/project/[id]/overview/page.tsx`

- [ ] **Step 1: Thread the scope**

The overview page resolves the scope once via `useEffectiveProduct` and passes `platforms` plus the scope object into the four cards. Each card:

- passes `platforms` to `PlatformAvailability` / `PlatformGaugeList` / `PlatformRingSet`;
- passes the scope into `computeDeliveryItems` and `computePyramidAggregation`.

`ParityCard` needs care: parity across one platform is meaningless. At arity ≤ 1, render the card's empty/NA state rather than a 100% figure — a single platform is never "at parity" or "behind", the question does not apply. Read the card first and use its existing empty treatment.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint 2>&1 | tail -5`
Expected: no new problems.

- [ ] **Step 3: Commit**

```bash
git add components/overview app/project/\[id\]/overview
git commit -m "feat: overview cards report the product you are looking at"
```

---

### Task 16: Node detail panel and canvas chips

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `components/graph/nodes/PlatformList.tsx`
- Modify: `components/graph/nodes/FlowNode.tsx`
- Modify: `components/panels/AcceptanceEditor.tsx`

- [ ] **Step 0: Finish the Unanchored rename**

`components/panels/AcceptanceEditor.tsx:100` still reads `Product-level (covers nothing).` — the
last survivor of the rename Task 11 did on the matrix. Make it read **`Unanchored (covers
nothing).`**

Not cosmetic: with products in the model, "product-level" reads as *belongs to a product*, which
is the exact opposite of what the string describes. An acceptance covering nothing belongs to no
product by derivation — it is in intake, and it is the one kind of acceptance whose stored
`metadata.product` is even consulted (§ Decision 5). Leaving the old wording in the editor where
that key is set is the most confusing possible place to leave it.

- [ ] **Step 1: Collapse the tabs**

In `NodeDetailPanel.tsx`, build the platform tab strip from **`scope.platforms`** — the scope's menu. Render it only when the menu has **two or more** entries. At one or zero, render a single status with no tabs and no platform icon — this is the "no platform tabs, or just one web?" question answered: one status, zero per-platform machinery.

**Not `scopedPlatforms(node, scope)`.** How many platform columns a surface shows is a *shape* decision, and shape decisions read the menu — the same input `AcceptanceMatrix` reads for its status columns and `PlatformAvailability` for its rings. `scopedPlatforms` degrades to `node.platforms` when no product is declared, so using it here would collapse a web-only view's strip from three tabs to one in a project that has never heard of products — ten views in `seed/pebbles.json` alone. That breaks the degenerate case guarantee. See the rule carried forward in the Phase D preamble.

Per-platform notes and screenshots for a platform outside the effective set are **not deleted and not rendered**; they round-trip untouched. Add a one-line comment saying so, because a future reader will otherwise assume the data was lost.

- [ ] **Step 2: Scope the chips**

`PlatformList.tsx` and `FlowNode.tsx` render chips for `scopedPlatforms(node, scope)` — chips are a *per-node fact* ("what does this node ship on"), which is the other half of the distinction Step 1 draws. Where a canvas node has no access to the scope, pass it down from the canvas rather than reading a global.

**Both gauge call sites here clamp rather than drop the widening**, exactly as at Task 14
Step 3. `FlowNode.tsx` and `NodeDetailPanel.tsx`'s `ComputedPlatformStatusSection` both pass
`withRollupPlatforms(...)` (Task 9), because a flow's rollup can count a platform the flow
itself never declares (`F-swap-glyph` in the seed). Scope them by filtering that result:

```tsx
withRollupPlatforms(declared, rollup).filter((p) => scope.platforms.includes(p))
```

"All products" is the union of every menu, so the widened bar survives it unchanged; a
web-only scope clamps it out. Replacing the widening with `scopedPlatforms(node, scope)`
would lose counted work in the unscoped case. Note `FlowNode`'s existing empty-`platforms`
branch (`platforms.length > 0 ? … : PLATFORMS.map(…)`) needs the scope's menu as its
fallback rather than every platform.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -5`
Expected: no type errors, no new lint problems.

- [ ] **Step 4: Commit**

```bash
git add components/panels/NodeDetailPanel.tsx components/panels/AcceptanceEditor.tsx components/graph/nodes
git commit -m "feat: an admin view stops showing iOS tabs it can never have"
```

---

### Task 17: Journey anchors and map product scope

**Files:**
- Modify: `lib/utils/journey-graph.ts`
- Modify: `app/project/[id]/maps/[mapId]/page.tsx`

- [ ] **Step 1: Resolve the anchor**

The journey root resolves in order: the map's own `root_node_id`, then the scoped product's `root_node_id`, then `project.root_node_id`. Write the fallback chain as a single expression with a comment naming the order, so it cannot be reordered by accident.

- [ ] **Step 2: Apply the map filter**

When a `MapDefinition` carries `product`, restrict the subgraph to nodes in that product before the existing selection algorithm runs — species and edge filters compose on top, unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run test:journey-graph && npm run test:maps`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/journey-graph.ts app/project/\[id\]/maps
git commit -m "feat: each product anchors its own journey"
```

---

## Phase E — Seed and documentation

### Task 18: Give Pebbles an Admin product

**Files:**
- Modify: `seed/pebbles.json`

- [ ] **Step 1: Declare the products**

Add to `project.metadata`:

```json
"products": [
  { "id": "app", "title": "Pebbles", "platforms": ["web", "ios", "android"] },
  { "id": "admin", "title": "Admin", "platforms": ["web"] }
]
```

Set `root_node_id` on the `app` product to whatever `project.root_node_id` currently holds, so the journey anchor survives.

- [ ] **Step 2: Assign membership**

Give **every** flow and view a `metadata.product`. Move a small, coherent set — three or four back-office views — to `admin`, and set their `platforms` to `["web"]` so the containment rule is satisfied rather than merely warned about. Everything else is `app`. Give every acceptance either a membership or a covers edge.

The point of the seed is that both paths are live: `admin` exercises arity 1 (single status column, a bar on the Pyramid, no platform tabs), `app` exercises arity 3.

- [ ] **Step 3: Verify the seed is clean**

Run: `npm run validate:seeds`
Expected: exits 0.

Then confirm there are genuinely no product warnings:

Run: `node docs/arkaik-skill/scripts/validate-bundle.js seed/pebbles.json | grep -i product`
Expected: no output. If anything appears, fix the seed — a warning here means the example teaches the wrong thing.

- [ ] **Step 4: Commit**

```bash
git add seed/pebbles.json
git commit -m "feat: the Pebbles example ships a web-only admin product"
```

---

### Task 19: Documentation

**Files:**
- Modify: `docs/graph-model.md:130-140` (§ Platforms), `:195-205` (taxonomy checklist)
- Modify: `docs/arkaik-skill/skill.md`
- Modify: `docs/rfcs/products.md:9-12` (status block)
- Modify: `docs/README.md` if it indexes spec sections

- [ ] **Step 1: `docs/graph-model.md`**

Add a `## Products` section before `## Platforms` covering: what a product is, where definitions live, which species store membership and which derive it, and the per-product journey anchor. Link to `docs/spec/bundle-format.md § Products` for the normative text and to `packages/schema/src/products.ts` for the projections.

Rewrite `## Platforms` around the arity rule — a product supplies a menu, `node.platforms` is authoritative, surfaces pick their shape from the count. State the arity table (≥2 / 1 / 0) explicitly.

Append a dated entry to `## Taxonomy Update Checklist` in the style of the existing 2026-07-19 note: what steps this change completed (config, seed, this document) and what it deferred (the P3 editing UI, per-surface override).

- [ ] **Step 2: `docs/arkaik-skill/skill.md`**

Teach agents the membership rules, because agents are the only authors until P3 lands: store `metadata.product` on flows, views, and acceptances; never on data models or endpoints; keep `node.platforms` inside the product's menu; an anchorless acceptance should name its product.

- [ ] **Step 3: `docs/rfcs/products.md`**

Update the status block: the RFC is no longer an open decision. State that Option A was adopted, that P0–P2 shipped, and link to the design spec and this plan. Leave the rest of the RFC intact — it is the reasoning record.

- [ ] **Step 4: Verify links resolve**

Run: `npm run generate && npm run validate:seeds && npx tsc --noEmit`
Expected: all pass, and `npm run generate` produces no unexpected diff beyond the doc edits.

- [ ] **Step 5: Commit**

```bash
git add docs/graph-model.md docs/arkaik-skill docs/rfcs/products.md docs/README.md
git commit -m "docs: products in the graph model, the agent skill, and the RFC status"
```

---

## Phase F — Follow-ups and the article

### Task 20: Open the three follow-up issues

**Files:** none — this task runs `gh`.

- [ ] **Step 1: Check the repo's issue conventions**

Run: `gh issue list --limit 5 --json number,title,labels`
Expected: a list. Match the existing title style and reuse existing labels; do not invent new ones.

- [ ] **Step 2: Open the P3 issue**

```bash
gh issue create --title "Product management UI (RFC products P3)" --body "$(cat <<'EOF'
P0–P2 shipped: products are a first-class scope in the schema and every read surface respects them. They are still only authorable by an agent or by hand-editing a bundle.

**Scope**
- Product manager in project settings: create, rename, set platforms, delete-with-reassign.
- Product picker in the node create/edit forms (flow, view, acceptance only).
- Bulk "move to product".

**Acceptance criterion:** products are manageable without editing JSON.

Design: `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md`
RFC: `docs/rfcs/products.md` § Phased plan, P3
EOF
)"
```

- [ ] **Step 3: Open the per-surface override issue**

```bash
gh issue create --title "Per-surface product override" --body "$(cat <<'EOF'
The global product scope in the sidebar is the default; a surface should be able to narrow further, most usefully when the global scope is "All products".

**The work is deliberately small by construction.** Projections already take the product as an argument and never read scope state, and every surface already resolves through `useEffectiveProduct` in `lib/hooks/useProductScope.ts`. This milestone changes that one function to `override ?? global` and adds the per-surface control.

Design: `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md` § Decision 2
EOF
)"
```

- [ ] **Step 4: Open the acceptance-intake issue**

```bash
gh issue create --title "Acceptance-first intake: file an idea before it has flows or views" --body "$(cat <<'EOF'
An acceptance with no `covers` edges is an idea in intake, not a cross-cutting NFR — filed by a PM before the flows and views exist, waiting to be decomposed.

**The model already supports it:** an acceptance can carry `metadata.product` before it carries a single edge, and unassigned anchorless acceptances surface under "All products" as a triage inbox with a validator warning. Nothing implements the workflow.

**Scope**
- File an acceptance against a product with no anchor.
- Later attach it to new or existing views and flows.
- Split one acceptance into several, preserving the product.

Design: `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md` § Decision 5
EOF
)"
```

- [ ] **Step 5: Record the numbers**

Run: `gh issue list --limit 5 --json number,title`
Expected: the three new issues. Note their numbers — the article and the PR body reference them.

---

### Task 21: Write the article

**Files:**
- Create: `docs/articles/2026-08-02-one-graph-many-products.md`

This is a standalone essay for **product builders** — people who ship products and hold the product, design, and engineering questions in one head. It is not documentation and not a changelog.

- [ ] **Step 1: Read the source material**

Read, in order: `docs/rfcs/products.md`, `docs/superpowers/specs/2026-08-02-multi-product-projects-design.md`, and `docs/vision.md`. The essay's authority comes from the reasoning already recorded there — do not invent new rationale.

- [ ] **Step 2: Write it**

**Length:** 1,200–1,800 words.

**Voice:** first person, humble, sharing what was learned. Someone thinking out loud about a modelling problem they got wrong once and then got right. No hooks, no "here's why everyone is doing X wrong", no rhetorical questions as section openers, no numbered listicle framing, no calls to action, no emoji.

**Arc:**

1. **The symptom, concretely.** An admin dashboard reading as "missing on iOS" when there is no iOS. Two or three real cases (Pbbls, Oxymore, teale — anonymize or keep the names, author's choice) showing this is a shape problem, not a bug.
2. **The diagnosis.** One axis was quietly doing two jobs: *which app is this part of* and *which runtime does that app ship on*. Because there was only ever one product, "platform" absorbed both questions and nobody noticed until there were two products. This is the essay's central idea — the most transferable lesson is that a conflated dimension is invisible while the second dimension has only one value.
3. **The options, honestly.** Show that flattening into per-project "targets" and making products a graph species were both real candidates, and say plainly what killed each — denormalizing a cross product, and making validation non-local. Credibility comes from the rejected options, not the chosen one.
4. **The choice and why it stayed small.** Products as project metadata; membership stored only where it must be and derived everywhere it can be; the node's own platform list stays authoritative so every existing projection keeps working. Name the containment discipline: a new dimension that *constrains* an existing one is far cheaper than one that replaces it.
5. **Where product, design, and engineering met.** The arity rule is the payoff and deserves the most space: the count of platforms decides the *shape* of the interface, not just its contents. Two or more → per-platform columns and rings. One or zero → a single status. A lone ring beside three-ring cards reads as *data missing* rather than *absent* — a design observation that became an engineering rule, expressed in one component so two surfaces cannot disagree.
6. **The judgement calls.** Two, briefly: warnings over errors (a constraint that spans two objects a user edits independently must not fail CI), and the deferred editing UI (shipping a model agents can author before humans can, and being honest that this is a bet on who the first author is).
7. **What is still open.** The per-surface override, the intake workflow, whether "product" is even the right word.

**Illustrative code only.** At most two short blocks. The product definition JSON is worth showing. The arity rule is worth showing as three lines of pseudo-code — `platforms.length >= 2 ? rings : bar` — not as the real component. No imports, no types, no test code.

**What not to do:** do not claim the design is finished or validated by usage; it is not. Do not present the phasing as a methodology. Do not name-drop patterns for their own sake.

- [ ] **Step 3: Read it back once**

Check it against the brief: is any sentence performing expertise rather than explaining something? Cut it. Does the arity section earn its length? If not, cut around it, not into it.

- [ ] **Step 4: Commit**

```bash
git add docs/articles/2026-08-02-one-graph-many-products.md
git commit -m "docs: an essay on splitting the product axis from the platform axis"
```

---

## Final verification

- [ ] **Run everything**

```bash
npx tsc --noEmit
npm run test:products
npm run test:schema
npm run test:maps
npm run test:acceptance
npm run test:fixtures
npm run test:pyramid
npm run test:delivery
npm run test:acceptance-matrix
npm run test:journey-graph
npm run validate:seeds
npm run generate
git status --short
```

Expected: every command exits 0, and `git status --short` is **empty** after `npm run generate` — a diff there means a generated artifact was not committed, which fails CI.

- [ ] **Confirm the degenerate case by experiment**

Run: `node -e "const b=require('./seed/arkaik-self-map.json'); console.log(JSON.stringify(b.project.metadata?.products ?? null))"`
Expected: `null`. That bundle declares no products, so it must still validate clean and render exactly as before.

Run: `node docs/arkaik-skill/scripts/validate-bundle.js seed/arkaik-self-map.json`
Expected: exits 0 with no product findings.

- [ ] **Hand off the visual pass**

There is no browser driver here. Give Alexis this checklist:

1. Pyramid, scoped to Pebbles — four rings per card, as today.
2. Pyramid, scoped to Admin — one bar plus the count, on both the card and the list row.
3. Acceptances, scoped to Admin — a single `Status` column, no platform filter in the bar.
4. Delivery, All products — the admin views appear in no Android column.
5. A node detail panel for an admin view — no platform tabs, one status.
6. `seed/arkaik-self-map.json` opened as a project — no scope selector anywhere in the sidebar.
7. Library, scoped to Admin — shared data models still listed, each badged with who uses them; an orphan data model still visible.

- [ ] **Open the PR with a Lab Note**

`CLAUDE.md` requires one, because this is user-facing. Draft:

```yaml
en:
  title: "One project, several apps — each with its own platforms"
  summary: "Your admin dashboard stops pretending it is missing on iOS. Tell Arkaik which apps live in your project and which platforms each one ships on, and every ring, board, and tab reports the app you are actually looking at."
fr:
  title: "Un projet, plusieurs apps — chacune avec ses plateformes"
  summary: "Ton back-office arrête de se plaindre qu'il manque sur iOS. Indique à Arkaik quelles apps composent ton projet et sur quelles plateformes chacune tourne : les jauges, les tableaux et les onglets parlent enfin de l'app que tu regardes."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```

After opening the PR, **read its comments** — the advisory reminder posts there and clears itself once the body is valid.

---

## Self-review notes

Checked against the spec, section by section:

- Decisions 1–8 → Tasks 1–5 (model, validation), 7–8 (scope), 10 (arity), 11–17 (surfaces), 14 (system layer visibility).
- The unassigned flow/view rule added during spec self-review → Task 5 (`unassigned-membership`) and Task 11 (filtering).
- Degenerate-case guarantee → asserted in Tasks 2, 12, 13, and again in Final verification.
- `productPlatforms(project, productId)` and `effectiveNodePlatforms(node, product)` signatures are used identically in Tasks 2, 7, 13, and 16.
- The `productsUsingNode(nodeId, index)` two-argument form is consistent across Tasks 3 and 14; the index is always built by `buildProductUsageIndex`.

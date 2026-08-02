# Product Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make products creatable, editable, deletable and assignable from the UI, so a human never has to edit bundle JSON to use them.

**Architecture:** A pure rules module (`lib/utils/product-editing.ts`) owns every product-editing rule and returns *plans*; one thin async executor (`lib/utils/apply-product-plan.ts`) runs a plan against the two stores; three UI surfaces (settings manager, node-form picker, Library bulk bar) compute nothing. This mirrors `lib/utils/product-scope.ts`, and is what makes the logic testable on a machine with no local Postgres.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind + shadcn/Radix primitives, `@arkaik/schema` workspace package, plain-Node test scripts (`node tests/app/*.test.js`) with a TypeScript-transpiling loader.

**Spec:** [`docs/superpowers/specs/2026-08-02-product-management-ui-design.md`](../specs/2026-08-02-product-management-ui-design.md). Decisions are referenced as **D1**–**D7** throughout.

---

## Background the engineer needs

**What a product is.** A project can describe a family of apps sharing one graph. Definitions live in `project.metadata.products` as `ProductDefinition[]` (`{ id, title, description?, platforms: PlatformId[], root_node_id? }`). Membership lives on the node as `node.metadata.product: string`.

**Only three species store membership** — `flow`, `view`, `acceptance` (the constant `PRODUCT_MEMBERSHIP_SPECIES` in `packages/schema/src/products.ts`). Data models and API endpoints *derive* theirs from who consumes them and must never be offered the control.

**Everything is lenient.** `resolveProducts()` drops blank and duplicate ids rather than throwing. The validator emits *warnings*, never errors, for product problems. Nothing in this plan may make a malformed product fail anything.

**The degenerate-case guarantee.** A project that declares no products must look and behave exactly as it did before products existed. Every new control in this plan is therefore conditional on `products.length > 0`. This is asserted, not eyeballed.

**Reading order before you start:** `packages/schema/src/products.ts`, then `lib/utils/product-scope.ts`, then `tests/app/product-scope.test.js` and its loader `tests/app/load-product-scope.js`.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `lib/utils/product-editing.ts` | Every product-editing rule, pure. Slugs, upsert/remove, plans, platform menus. No React, no provider, no zod. |
| `lib/utils/apply-product-plan.ts` | The one write that spans `updateProject` and `applyMutations`. |
| `tests/app/load-product-editing.js` | Transpiles the two modules above into a plain Node process. |
| `tests/app/product-editing.test.js` | The DB-free suite for the rules. |
| `components/panels/ProductPicker.tsx` | One product `<Select>`, used by three forms. |
| `components/settings/ProductManagerPanel.tsx` | The Products section of project settings: list, create, edit, delete. |
| `components/settings/ProductFormDialog.tsx` | Create/edit dialog (title, description, platforms). |
| `components/settings/ProductDeleteDialog.tsx` | Delete-with-reassign confirmation. |
| `components/library/LibrarySelectionBar.tsx` | The bulk action bar. |

**Modify:**

| Path | Change |
|---|---|
| `components/panels/NewNodeForm.tsx` | Product field + platform constraint (D1, D4). |
| `app/project/[id]/library/page.tsx` | Thread products into the form; selection state; bulk bar. |
| `app/project/[id]/delivery/page.tsx`, `app/project/[id]/acceptances/page.tsx`, `components/maps/JourneyMap.tsx`, `components/maps/SystemMap.tsx` | Thread `products` / `defaultProductId` into `NewNodeForm`. |
| `components/panels/NodeDetailPanel.tsx` | Product picker on the edit path. |
| `components/panels/AcceptanceEditor.tsx` | Product picker with anchor explanation (D5). |
| `components/library/NodeCard.tsx`, `components/library/NodeTable.tsx` | Optional selection checkbox. |
| `app/project/[id]/settings/page.tsx` | Render `ProductManagerPanel`. |
| `package.json`, `.github/workflows/ci.yml` | Wire `test:product-editing`. |
| `docs/rfcs/products.md` | Mark P3 shipped. |

---

## Task 1: The rules module

**Files:**
- Create: `lib/utils/product-editing.ts`
- Create: `tests/app/load-product-editing.js`
- Create: `tests/app/product-editing.test.js`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the test loader**

Create `tests/app/load-product-editing.js`. This follows the `tests/app/load-*.js` idiom exactly — transpile TypeScript to CommonJS, rewrite the `@/` alias, point `@arkaik/schema` at the schema package's own test build.

```js
/**
 * Loads lib/utils/product-editing.ts and lib/utils/apply-product-plan.ts into a
 * plain Node process, following the tests/app/load-*.js idiom.
 *
 * Both modules are deliberately React-free and provider-free, which is the
 * whole reason the product-editing rules live there rather than inside the
 * components that call them: this repo has no component test runner, and a rule
 * inside a dialog is a rule nothing can assert.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-product-editing");

const MODULES = [
  // PLATFORMS is imported as a *value* (it is the canonical platform order), so
  // the config module has to exist on disk for the require to resolve.
  ["lib/config/platforms.ts", "platforms"],
  ["lib/utils/product-editing.ts", "product-editing"],
  ["lib/utils/apply-product-plan.ts", "apply-product-plan"],
];

function loadProductEditing() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });

    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/config\/platforms\1\)/g, `require("./platforms.js")`)
      .replace(/require\((['"])\.\/product-editing\1\)/g, `require("./product-editing.js")`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  return {
    ...require(path.join(BUILD_DIR, "product-editing.js")),
    ...require(path.join(BUILD_DIR, "apply-product-plan.js")),
  };
}

module.exports = { loadProductEditing, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

Create `tests/app/product-editing.test.js`. Match the house style of `tests/app/product-scope.test.js`: a `#!/usr/bin/env node` shebang, a doc comment explaining what is load-bearing, `node:assert/strict`, and a small `test()` harness. Copy the harness shape from the existing file — read it first.

```js
#!/usr/bin/env node

/**
 * Product editing rules (lib/utils/product-editing.ts).
 *
 * The load-bearing assertions are the two that a component could not be made to
 * make: that `planProductMove` silently skips the species which *derive*
 * membership (moving a data model would write a key every read surface ignores),
 * and that with no products declared no plan changes anything — the degenerate
 * case guarantee, which is the whole reason products stayed opt-in.
 */

const assert = require("node:assert/strict");
const { loadProductEditing } = require("./load-product-editing");

const {
  deriveProductId,
  upsertProduct,
  removeProduct,
  membersOfProduct,
  planProductDeletion,
  planProductMove,
  planToOps,
  platformMenuFor,
  constrainPlatforms,
  withProductMembership,
} = loadProductEditing();

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  not ok - ${name}`);
    console.error(`    ${err.message}`);
  }
}

const PRODUCTS = [
  { id: "app", title: "End-user app", platforms: ["web", "ios", "android"], root_node_id: "F-onboarding" },
  { id: "admin", title: "Admin", platforms: ["web"] },
  { id: "api", title: "Public API", platforms: [] },
];

const NODES = [
  { id: "V-home", species: "view", metadata: { product: "admin", note: "keep me" } },
  { id: "V-list", species: "view", metadata: { product: "admin" } },
  { id: "F-signup", species: "flow", metadata: { product: "app" } },
  { id: "D-user", species: "data-model", metadata: {} },
  { id: "A-loads", species: "acceptance", metadata: {} },
];

console.log("product-editing");

test("deriveProductId slugifies a title", () => {
  assert.equal(deriveProductId("Admin dashboard", []), "admin-dashboard");
});

test("deriveProductId strips accents and punctuation", () => {
  assert.equal(deriveProductId("Créateur (bêta)!", []), "createur-beta");
});

test("deriveProductId suffixes a collision rather than colliding", () => {
  assert.equal(deriveProductId("Admin", ["admin"]), "admin-2");
  assert.equal(deriveProductId("Admin", ["admin", "admin-2"]), "admin-3");
});

test("deriveProductId never returns a blank id", () => {
  // resolveProducts DROPS blank ids, so a blank slug is not a product at all.
  assert.equal(deriveProductId("!!!", []), "product");
  assert.equal(deriveProductId("", ["product"]), "product-2");
});

test("upsertProduct appends a new product in declaration order", () => {
  const next = upsertProduct(PRODUCTS, { id: "cli", title: "CLI", platforms: [] });
  assert.deepEqual(next.map((p) => p.id), ["app", "admin", "api", "cli"]);
});

test("upsertProduct edits in place and preserves root_node_id", () => {
  // D7 does not expose the anchor, which makes destroying it the live risk.
  const next = upsertProduct(PRODUCTS, { id: "app", title: "The app", platforms: ["web"] });
  assert.deepEqual(next.map((p) => p.id), ["app", "admin", "api"]);
  assert.equal(next[0].title, "The app");
  assert.equal(next[0].root_node_id, "F-onboarding");
  assert.deepEqual(next[0].platforms, ["web"]);
});

test("upsertProduct orders platforms canonically and drops a blank description", () => {
  const next = upsertProduct([], { id: "x", title: "X", description: "   ", platforms: ["android", "web"] });
  assert.deepEqual(next[0].platforms, ["web", "android"]);
  assert.equal("description" in next[0], false);
});

test("membersOfProduct sees stored membership only", () => {
  assert.deepEqual(membersOfProduct(NODES, "admin").map((n) => n.id), ["V-home", "V-list"]);
});

test("planProductDeletion reassigns every member", () => {
  const plan = planProductDeletion(PRODUCTS, NODES, "admin", "app");
  assert.deepEqual(plan.products.map((p) => p.id), ["app", "api"]);
  assert.deepEqual(plan.reassignments, [
    { nodeId: "V-home", product: "app" },
    { nodeId: "V-list", product: "app" },
  ]);
});

test("planProductDeletion can leave members unassigned", () => {
  const plan = planProductDeletion(PRODUCTS, NODES, "admin", null);
  assert.deepEqual(plan.reassignments.map((r) => r.product), [null, null]);
});

test("planProductDeletion of an empty product touches no node", () => {
  const plan = planProductDeletion(PRODUCTS, NODES, "api", null);
  assert.deepEqual(plan.reassignments, []);
});

test("planProductMove skips the species that derive membership", () => {
  const plan = planProductMove(NODES, ["V-home", "D-user", "A-loads"], "app");
  assert.deepEqual(plan.reassignments, [
    { nodeId: "V-home", product: "app" },
    { nodeId: "A-loads", product: "app" },
  ]);
  assert.equal(plan.products, null);
});

test("planProductMove skips nodes already in the target", () => {
  const plan = planProductMove(NODES, ["V-home", "V-list", "F-signup"], "admin");
  assert.deepEqual(plan.reassignments, [{ nodeId: "F-signup", product: "admin" }]);
});

test("planProductMove to null unassigns", () => {
  const plan = planProductMove(NODES, ["V-home"], null);
  assert.deepEqual(plan.reassignments, [{ nodeId: "V-home", product: null }]);
});

test("withProductMembership removes the key rather than blanking it", () => {
  assert.deepEqual(withProductMembership({ product: "admin", note: "keep me" }, null), { note: "keep me" });
  assert.deepEqual(withProductMembership(undefined, "app"), { product: "app" });
});

test("planToOps patches metadata and preserves the rest of it", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));
  const ops = planToOps(planProductMove(NODES, ["V-home"], null), nodesById);
  assert.deepEqual(ops, [
    { op: "update_node", node_id: "V-home", patch: { metadata: { note: "keep me" } } },
  ]);
});

test("platformMenuFor: a product's own menu, canonically ordered", () => {
  assert.deepEqual(platformMenuFor({ id: "a", title: "A", platforms: ["android", "web"] }), ["web", "android"]);
});

test("platformMenuFor: a platform-less product has an empty menu", () => {
  // Arity 0 — availability is not a tracked dimension. The form shows no toggles.
  assert.deepEqual(platformMenuFor(PRODUCTS[2]), []);
});

test("platformMenuFor: unassigned means every platform", () => {
  assert.deepEqual(platformMenuFor(null), ["web", "ios", "android"]);
  assert.deepEqual(platformMenuFor({ id: "junk", title: "Junk" }), ["web", "ios", "android"]);
});

test("constrainPlatforms prunes a selection the product forbids", () => {
  assert.deepEqual(constrainPlatforms(["web", "ios"], ["web"]), ["web"]);
  assert.deepEqual(constrainPlatforms(["ios", "web"], ["web", "ios", "android"]), ["web", "ios"]);
  assert.deepEqual(constrainPlatforms(["web"], []), []);
});

test("degenerate case: with no products declared, no plan changes anything", () => {
  const plan = planProductDeletion([], NODES, "nope", null);
  assert.deepEqual(plan.products, []);
  assert.deepEqual(plan.reassignments, []);
  assert.deepEqual(planToOps(plan, new Map()), []);
});

console.log(failures === 0 ? "\nAll product-editing tests passed" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node tests/app/product-editing.test.js`
Expected: FAIL — `Cannot find module` for `lib/utils/product-editing.ts`, because the module does not exist yet.

- [ ] **Step 4: Write `lib/utils/product-editing.ts`**

```ts
/**
 * The rules for *editing* products, as pure functions over plain data.
 *
 * The read side already works this way (lib/utils/product-scope.ts) and this is
 * its mirror: the schema package owns what a product *means*, this module owns
 * what an edit to one *does*, and no component here computes either.
 *
 * Every destructive operation returns a **plan** rather than performing itself.
 * That is not ceremony — a product deletion touches the project's metadata and
 * an arbitrary number of nodes across two different stores, and a plan is the
 * only form of that operation which can be asserted on a machine with no
 * database and no component test runner.
 *
 * Deliberately React-free and provider-free for the same reason.
 */

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { Node, NodeMetadata } from "@/lib/data/types";
import {
  PRODUCT_MEMBERSHIP_SPECIES,
  productOf,
  type ProductDefinition,
} from "@arkaik/schema";

/** The canonical platform order, which every list this module emits follows. */
const PLATFORM_ORDER: readonly PlatformId[] = PLATFORMS.map((platform) => platform.id);

/** The minimum shape this module needs of a node — never the whole thing. */
type NodeLike = Pick<Node, "id" | "species" | "metadata">;

/**
 * Kebab-case, ASCII, no leading or trailing dash. Accents are folded rather
 * than dropped so that "Créateur" becomes "createur" and not "cr-ateur".
 */
export function slugifyProductTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The durable key a product is known by, derived once at create time and never
 * changed afterwards (§ D2).
 *
 * **It can never be blank.** `resolveProducts` treats a blank id as *not a
 * declaration* and drops the entry, so a title of "!!!" slugging to "" would
 * produce a product that the app cannot see and the user cannot delete. The
 * `product` fallback is what keeps that unreachable.
 */
export function deriveProductId(title: string, existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  const base = slugifyProductTitle(title) || "product";
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** What the create/edit dialog collects. The id is derived, never typed. */
export interface ProductDraft {
  id: string;
  title: string;
  description?: string;
  platforms: PlatformId[];
}

/**
 * The draft written into the definitions array — appended when new, replaced in
 * place when it already exists, so declaration order (which is the order the
 * scope selector renders) never shuffles under an edit.
 *
 * The existing definition is **spread first**, which is what preserves
 * `root_node_id`. The manager does not expose the journey anchor (§ D7), so an
 * edit that dropped it would silently un-anchor a product's journey and the user
 * would have no way to tell, let alone put it back.
 */
export function upsertProduct(
  products: readonly ProductDefinition[],
  draft: ProductDraft,
): ProductDefinition[] {
  const existing = products.find((product) => product.id === draft.id);
  const description = draft.description?.trim();

  const next: ProductDefinition = {
    ...(existing ?? {}),
    id: draft.id,
    title: draft.title.trim(),
    platforms: PLATFORM_ORDER.filter((platform) => draft.platforms.includes(platform)),
  };

  if (description) next.description = description;
  else delete next.description;

  if (!existing) return [...products, next];
  return products.map((product) => (product.id === draft.id ? next : product));
}

/** The definitions without this one. Membership is {@link planProductDeletion}'s job. */
export function removeProduct(
  products: readonly ProductDefinition[],
  id: string,
): ProductDefinition[] {
  return products.filter((product) => product.id !== id);
}

/**
 * Nodes whose **stored** `metadata.product` names this product.
 *
 * Stored, never derived, and the distinction matters: an acceptance covering an
 * admin view *reads* as admin everywhere, but its membership is its anchors'
 * and deleting the product cannot orphan a key it never had. Only a stored key
 * can go stale, so only stored keys are what a deletion has to answer for.
 */
export function membersOfProduct<N extends NodeLike>(
  nodes: readonly N[],
  productId: string,
): N[] {
  return nodes.filter((node) => productOf(node) === productId);
}

/** One node's membership changing. `null` means "unassign". */
export interface ProductReassignment {
  nodeId: string;
  product: string | null;
}

/**
 * A complete product edit, computed before anything is written.
 *
 * `products: null` means "the definitions are unchanged" — a bulk move touches
 * memberships only, and passing the unchanged array would make the executor
 * write the project for no reason.
 */
export interface ProductPlan {
  products: ProductDefinition[] | null;
  reassignments: ProductReassignment[];
}

/** Delete a product and say what happens to its members (§ D3). */
export function planProductDeletion(
  products: readonly ProductDefinition[],
  nodes: readonly NodeLike[],
  id: string,
  reassignTo: string | null,
): ProductPlan {
  return {
    products: removeProduct(products, id),
    reassignments: membersOfProduct(nodes, id).map((node) => ({ nodeId: node.id, product: reassignTo })),
  };
}

/**
 * Move the selected nodes into a product, or out of every product (§ D6).
 *
 * Two filters, both load-bearing. Species that **derive** membership are
 * skipped, because writing `metadata.product` on a data model produces a key
 * every read surface ignores and the validator warns about
 * (`product-membership-wrong-species`) — the bulk bar tells the user how many of
 * their selection this drops. Nodes already in the target are skipped so a
 * re-application is a no-op rather than a pile of empty writes.
 */
export function planProductMove(
  nodes: readonly NodeLike[],
  nodeIds: readonly string[],
  productId: string | null,
): ProductPlan {
  const wanted = new Set(nodeIds);
  return {
    products: null,
    reassignments: nodes
      .filter((node) => wanted.has(node.id))
      .filter((node) => PRODUCT_MEMBERSHIP_SPECIES.includes(node.species))
      .filter((node) => productOf(node) !== productId)
      .map((node) => ({ nodeId: node.id, product: productId })),
  };
}

/**
 * This node's metadata with its membership set, or **removed**.
 *
 * Removed rather than blanked: `productOf` reads any string, so `product: ""`
 * would be a membership naming a product that cannot exist, and
 * `resolveProducts` would never match it. Unassigned has to mean *absent*.
 *
 * The rest of the metadata is carried through untouched — `platformStatuses`,
 * notes and screenshots all live in the same object, and a patch that replaced
 * it wholesale would take a view's per-platform statuses with it.
 */
export function withProductMembership(
  metadata: NodeMetadata | undefined,
  product: string | null,
): NodeMetadata {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  if (product === null) delete next.product;
  else next.product = product;
  return next as NodeMetadata;
}

/**
 * A plan's reassignments as mutation ops, so the whole membership half commits
 * as one atomic write (`applyMutations`) rather than as N racing patches.
 *
 * Pure, and here rather than in the executor deliberately: this is where the
 * "preserve the rest of the metadata" rule is actually applied, and it is worth
 * an assertion.
 */
export function planToOps(
  plan: ProductPlan,
  nodesById: ReadonlyMap<string, NodeLike>,
): { op: "update_node"; node_id: string; patch: { metadata: NodeMetadata } }[] {
  return plan.reassignments.map(({ nodeId, product }) => ({
    op: "update_node" as const,
    node_id: nodeId,
    patch: { metadata: withProductMembership(nodesById.get(nodeId)?.metadata, product) },
  }));
}

/**
 * The platforms a node in this product may claim — the containment rule as the
 * node form enforces it (§ D4).
 *
 * Three distinct answers, and the empty one is not an error. A product with
 * `platforms: []` says availability is not a tracked dimension here (a CLI, a
 * public API), so the form shows no platform toggles at all and a single
 * lifecycle status — RFC decision 2, arriving in the editor exactly as it
 * already arrives in the read surfaces. `null` — unassigned, or a project that
 * declares no products — means every platform, which is today's behaviour
 * unchanged.
 *
 * An unrecognised or malformed definition degrades to every platform rather than
 * to none: `resolveProducts` is lenient by contract, and a stored product with
 * no `platforms` array must never leave a user unable to tick anything.
 */
export function platformMenuFor(product: ProductDefinition | null | undefined): PlatformId[] {
  if (!product || !Array.isArray(product.platforms)) return [...PLATFORM_ORDER];
  const menu = new Set<string>(product.platforms as string[]);
  return PLATFORM_ORDER.filter((platform) => menu.has(platform));
}

/** `selected ∩ menu`, canonically ordered — what a product change prunes to. */
export function constrainPlatforms(
  selected: readonly PlatformId[],
  menu: readonly PlatformId[],
): PlatformId[] {
  return PLATFORM_ORDER.filter((platform) => selected.includes(platform) && menu.includes(platform));
}
```

- [ ] **Step 5: Write `lib/utils/apply-product-plan.ts`**

```ts
/**
 * The one write in the app that spans both stores.
 *
 * Product definitions live on the project (`updateProject`) and memberships live
 * on nodes (`applyMutations`), so every product edit that touches members is two
 * writes that cannot be made one. Both callers — the delete dialog and the
 * Library's bulk bar — go through here so the ordering below is decided once.
 *
 * Takes its stores as arguments rather than calling hooks, which keeps it a
 * plain async function the test suite can drive with two spies.
 */

import type { NodeMetadata, ProjectMetadata } from "@/lib/data/types";
import { planToOps, type ProductPlan } from "./product-editing";

type UpdateNodeOp = { op: "update_node"; node_id: string; patch: { metadata: NodeMetadata } };

export interface ProductPlanStores {
  nodesById: ReadonlyMap<string, { id: string; metadata?: NodeMetadata }>;
  projectMetadata: ProjectMetadata | undefined;
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
  applyMutations: (ops: UpdateNodeOp[]) => Promise<unknown>;
}

/**
 * Memberships first, definitions second — and if the second write fails the
 * result is a product that still exists whose members have already moved out of
 * it. That is a *visible* half-state the user can finish by hand.
 *
 * The other order fails worse: deleting the definition first and then losing the
 * membership write leaves nodes pointing at a product nobody declares. Every
 * read surface survives that (a stale key resolves to unassigned), which is
 * precisely the problem — nothing would tell the user it happened.
 *
 * `products: null` means the definitions are untouched, so the project write is
 * skipped entirely rather than saved unchanged.
 */
export async function applyProductPlan(plan: ProductPlan, stores: ProductPlanStores): Promise<void> {
  const ops = planToOps(plan, stores.nodesById as ReadonlyMap<string, never>) as UpdateNodeOp[];

  if (ops.length > 0) await stores.applyMutations(ops);

  if (plan.products !== null) {
    await stores.updateProject({
      metadata: { ...(stores.projectMetadata ?? {}), products: plan.products },
    });
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/app/product-editing.test.js`
Expected: PASS — every line prints `ok - …` and the script exits `0` with `All product-editing tests passed`.

If `planToOps`'s cast in `apply-product-plan.ts` fights the type checker, fix it by widening `ProductPlanStores["nodesById"]` to `ReadonlyMap<string, Pick<Node, "id" | "species" | "metadata">>` and importing `Node` — do not weaken `planToOps`.

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors introduced by the two new files. (Pre-existing errors elsewhere, if any, are not yours — compare against `git stash` output if unsure.)

- [ ] **Step 8: Wire the suite into npm and CI**

In `package.json`, add directly after the `"test:product-scope"` line:

```json
    "test:product-editing": "node tests/app/product-editing.test.js",
```

In `.github/workflows/ci.yml`, find the step running `npm run test:product-scope` (around line 119) and add an identically-shaped step immediately after it, matching the surrounding `- name:` / `run:` formatting exactly:

```yaml
      - name: Product editing tests
        run: npm run test:product-editing
```

- [ ] **Step 9: Verify the npm script works**

Run: `npm run test:product-editing`
Expected: PASS, same output as Step 6.

- [ ] **Step 10: Commit**

```bash
git add lib/utils/product-editing.ts lib/utils/apply-product-plan.ts \
        tests/app/load-product-editing.js tests/app/product-editing.test.js \
        package.json .github/workflows/ci.yml
git commit -m "feat: the rules for editing products, as pure plans"
```

Note: `tests/app/.test-build-product-editing/` is a build artefact. Check `.gitignore` covers `tests/app/.test-build-*` — the existing `.test-build-product-scope` directory is already handled, so match whatever pattern covers it. If it is not covered, add `tests/app/.test-build-*/` to `.gitignore` in this commit.

---

## Task 2: The product picker component

**Files:**
- Create: `components/panels/ProductPicker.tsx`

There is no component test runner in this repo, so this task has no automated test. Verification is `npx tsc --noEmit` plus the manual checklist in Task 9.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { ProductDefinition } from "@arkaik/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The one control that assigns a node to a product.
 *
 * One component, three forms (the create form, the node detail panel, the
 * acceptance editor), for the same reason `ProductScopeSelector` is one
 * control: the rules about what "unassigned" means are subtle enough that three
 * copies would diverge, and the third copy would be the one that stored `""`.
 *
 * **The caller decides whether to render it at all.** This component does not
 * check whether the project declares products — its callers do, because a form
 * that has no products to offer must not render an empty field, a label, or the
 * word "product" anywhere. That is the degenerate-case guarantee, and it lives
 * at the call site because only the call site knows what layout to omit.
 */

/**
 * Radix reserves the empty string for "no selection", so "Unassigned" — a real
 * choice, not an absence — needs a sentinel. It never leaves this file; the
 * value handed back is `null`.
 */
const UNASSIGNED = "__unassigned__";

interface ProductPickerProps {
  products: readonly ProductDefinition[];
  value: string | null;
  onChange: (productId: string | null) => void;
  /** Defaults to "Product". The acceptance editor overrides it. */
  label?: string;
  /** Secondary line under the control — the caller's explanation, if any. */
  hint?: string;
  disabled?: boolean;
}

/** The product's `title`, or its id when the definition carries none. */
function productLabel(product: ProductDefinition): string {
  return typeof product.title === "string" && product.title.trim() !== "" ? product.title : product.id;
}

export function ProductPicker({
  products,
  value,
  onChange,
  label = "Product",
  hint,
  disabled,
}: ProductPickerProps) {
  // A stored membership naming a product this project no longer declares
  // degrades to Unassigned in the trigger, matching `ProductScopeSelector`. It
  // is displayed, not healed — writing state as a side effect of rendering
  // would make a half-synced bundle permanently forget a real assignment.
  const selected = products.find((product) => product.id === value) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <Select
        value={selected ? selected.id : UNASSIGNED}
        onValueChange={(next) => onChange(next === UNASSIGNED ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {products.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {productLabel(product)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/panels/ProductPicker.tsx
git commit -m "feat: one product picker for the three forms that assign membership"
```

---

## Task 3: Product field in the create form

**Files:**
- Modify: `components/panels/NewNodeForm.tsx`

- [ ] **Step 1: Extend the form's data and props**

Read `components/panels/NewNodeForm.tsx` first. Add these imports beside the existing ones:

```tsx
import { PRODUCT_MEMBERSHIP_SPECIES, type ProductDefinition } from "@arkaik/schema";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { constrainPlatforms, platformMenuFor, withProductMembership } from "@/lib/utils/product-editing";
```

Extend the props interface (leave `NewNodeFormData` unchanged — membership travels in `metadata`, which the type already carries):

```tsx
interface NewNodeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewNodeFormData) => void;
  /** Pre-fill species when opening from an "Add child" action. */
  defaultValues?: Partial<Pick<NewNodeFormData, "species">>;
  /**
   * The project's declared products. **Empty means the picker never renders** —
   * a project that has never heard of products must see no new field, no new
   * label, and no new word (§ degenerate-case guarantee).
   */
  products?: readonly ProductDefinition[];
  /**
   * The scope the user is standing in, pre-filled into the picker (§ D1).
   *
   * Visible and editable, never silent: creating a node under a named scope
   * without this produced a node that vanished from the scope the moment it was
   * created, because an unassigned flow or view shows under All products only.
   */
  defaultProductId?: string | null;
}
```

- [ ] **Step 2: Add the product state and the platform constraint**

Inside the component, after the existing `useState` calls:

```tsx
export function NewNodeForm({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  products = [],
  defaultProductId = null,
}: NewNodeFormProps) {
  const [title, setTitle] = useState("");
  const [species, setSpecies] = useState<SpeciesId>(defaultValues?.species ?? "view");
  const [status, setStatus] = useState<StatusId>("idea");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [product, setProduct] = useState<string | null>(defaultProductId);

  const usesSingleStatusField = species === "data-model" || species === "api-endpoint";
  const usesPlatformDefaultStatus = species === "view";

  // Only three species *store* membership; the system layer derives it from who
  // consumes it and must never be offered the control.
  const storesProduct = PRODUCT_MEMBERSHIP_SPECIES.includes(species);
  const showsProductPicker = products.length > 0 && storesProduct;

  // The containment rule at its source (§ D4): a node may only claim platforms
  // its product ships on. An unassigned node — or a project with no products —
  // gets every platform, which is today's behaviour unchanged.
  const platformMenu = platformMenuFor(
    storesProduct && product !== null ? products.find((p) => p.id === product) ?? null : null,
  );

  // A platform-less product means availability is not a tracked dimension here
  // (a CLI, a public API), so there is nothing to toggle — RFC decision 2.
  const allowsPlatformEditing = species !== "flow" && platformMenu.length > 0;
```

- [ ] **Step 3: Prune the selection when the product changes**

Add this handler next to `handlePlatformToggle`:

```tsx
  /**
   * Switching to a narrower product drops the platforms it does not ship on,
   * rather than storing a claim the product forbids and letting
   * `effectiveNodePlatforms` silently hide it at render time.
   */
  function handleProductChange(nextProduct: string | null) {
    setProduct(nextProduct);
    const nextMenu = platformMenuFor(
      nextProduct === null ? null : products.find((p) => p.id === nextProduct) ?? null,
    );
    setPlatforms((previous) => constrainPlatforms(previous, nextMenu));
  }
```

- [ ] **Step 4: Reset and submit correctly**

Update `resetForm` to restore the scoped default rather than clearing it — reopening the dialog under a named scope must pre-fill again:

```tsx
  function resetForm() {
    setTitle("");
    setSpecies(defaultValues?.species ?? "view");
    setStatus("idea");
    setPlatforms([]);
    setProduct(defaultProductId);
  }
```

Replace the body of `handleSubmit` with this. The two metadata contributions are merged rather than one overwriting the other, and membership is dropped entirely when the species does not store it — changing species from `view` to `data-model` mid-form must not leave a key the validator warns about:

```tsx
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const platformStatuses = species === "view"
      ? {
          platformStatuses: Object.fromEntries(
            platforms.map((platformId) => [platformId, status]),
          ) as Record<PlatformId, StatusId>,
        }
      : {};

    // Membership only for the species that store it, and only when the project
    // has products at all. `withProductMembership` removes the key for null
    // rather than blanking it — unassigned has to mean absent.
    const base = storesProduct && products.length > 0
      ? withProductMembership(undefined, product)
      : {};

    const metadata: NodeMetadata = { ...base, ...platformStatuses };

    onSubmit({
      title: title.trim(),
      species,
      status,
      platforms,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    resetForm();
  }
```

- [ ] **Step 5: Render the picker**

In the JSX, insert the picker immediately after the Species field and before the status field, so it reads product-then-platforms — the order the constraint flows in:

```tsx
          {showsProductPicker && (
            <ProductPicker
              products={products}
              value={product}
              onChange={handleProductChange}
              hint={
                product === null
                  ? "Unassigned nodes appear under All products only."
                  : undefined
              }
            />
          )}
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. The five call sites still compile because `products` and `defaultProductId` are optional and default to the pre-products behaviour.

- [ ] **Step 7: Commit**

```bash
git add components/panels/NewNodeForm.tsx
git commit -m "feat: create a node into the product you are standing in"
```

---

## Task 4: Thread products into all five call sites

**Files:**
- Modify: `app/project/[id]/library/page.tsx`
- Modify: `app/project/[id]/delivery/page.tsx`
- Modify: `app/project/[id]/acceptances/page.tsx`
- Modify: `components/maps/JourneyMap.tsx`
- Modify: `components/maps/SystemMap.tsx`

Every one of these already resolves a scope through `useEffectiveProduct` (or receives one as a prop) and already renders `<NewNodeForm …/>`. The change at each site is the same two props.

- [ ] **Step 1: Find every call site**

Run: `grep -rn "<NewNodeForm" --include='*.tsx' app components`
Expected: five results, one per file listed above. If there are more, every one gets the same treatment.

- [ ] **Step 2: Add the products list at each site**

At each call site the scope is already in scope as `scope` (pages) or as a `scope` prop (maps). `ProductScope` carries `productsById`, so the array comes from it with no extra resolution and no new import:

```tsx
      <NewNodeForm
        open={newNodeOpen}
        onOpenChange={setNewNodeOpen}
        onSubmit={handleCreateNode}
        products={[...scope.productsById.values()]}
        defaultProductId={scope.productId}
      />
```

Keep every other prop already present at that site (`defaultValues`, etc.) exactly as it is. In `JourneyMap.tsx` and `SystemMap.tsx` the local variable may be named differently — read the file and use whatever holds the `ProductScope`.

Hoist the array into a `useMemo` where the file already memoizes similar derivations, so the form is not handed a new array identity every render:

```tsx
  const productList = useMemo(() => [...scope.productsById.values()], [scope.productsById]);
```

- [ ] **Step 3: Verify no call site was missed**

Run: `grep -rn "<NewNodeForm" -A6 --include='*.tsx' app components | grep -c "products="`
Expected: `5`

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/project components/maps
git commit -m "feat: every create form knows the project's products"
```

---

## Task 5: Product picker on the edit paths

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `components/panels/AcceptanceEditor.tsx`

- [ ] **Step 1: Read both files**

Both already receive `scope: ProductScope`. Find how each persists an edit — `NodeDetailPanel` calls an `onUpdate`-style prop with a node patch; `AcceptanceEditor` does the equivalent for its acceptance. Use whatever mechanism is already there; do not add a new save path.

- [ ] **Step 2: Add the picker to `NodeDetailPanel`**

Add the imports:

```tsx
import { PRODUCT_MEMBERSHIP_SPECIES } from "@arkaik/schema";
import { productOf } from "@arkaik/schema";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { withProductMembership } from "@/lib/utils/product-editing";
```

Render it in the panel's editable metadata area, guarded exactly as the create form is:

```tsx
        {scope.productsById.size > 0 && PRODUCT_MEMBERSHIP_SPECIES.includes(node.species) && (
          <ProductPicker
            products={[...scope.productsById.values()]}
            value={productOf(node)}
            onChange={(nextProduct) =>
              onUpdate(node.id, { metadata: withProductMembership(node.metadata, nextProduct) })
            }
            hint={
              productOf(node) === null
                ? "Unassigned nodes appear under All products only."
                : undefined
            }
          />
        )}
```

Substitute the panel's real update callback for `onUpdate(node.id, patch)` — read the file and match its signature.

- [ ] **Step 3: Add the picker to `AcceptanceEditor`**

An acceptance's membership is **derived from its `covers` anchors**; the stored key is the answer only when it covers nothing (§ D5). The control is always present, but when anchors exist it says who is actually deciding. Imports:

```tsx
import { ProductPicker } from "@/components/panels/ProductPicker";
import { coveredAnchorIds, productsOfAcceptance } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { productOf } from "@arkaik/schema";
```

The editor needs `edges` and a `nodesById` map to answer the derivation. If it does not already receive them, add them as props and pass them from the call site — the pages that render it already hold both. Then:

```tsx
  const anchorCount = coveredAnchorIds(acceptance.id, edges).length;
  const derivedProducts = productsOfAcceptance(acceptance, edges, nodesById);
  const derivedLabels = [...derivedProducts]
    .map((id) => scope.productsById.get(id)?.title ?? id)
    .join(", ");
```

```tsx
        {scope.productsById.size > 0 && (
          <ProductPicker
            products={[...scope.productsById.values()]}
            value={productOf(acceptance)}
            onChange={(nextProduct) =>
              onUpdate(acceptance.id, {
                metadata: withProductMembership(acceptance.metadata, nextProduct),
              })
            }
            label={anchorCount > 0 ? "Product (from what it covers)" : "Product"}
            hint={
              anchorCount > 0
                ? derivedLabels
                  ? `This acceptance belongs to ${derivedLabels}, taken from the ${anchorCount} node${anchorCount === 1 ? "" : "s"} it covers. The value below applies only if it stops covering anything.`
                  : `The ${anchorCount} node${anchorCount === 1 ? "" : "s"} this covers have no product yet, so it appears under All products. The value below applies only if it stops covering anything.`
                : "This acceptance covers nothing, so its product is whatever you set here."
            }
          />
        )}
```

Substitute the editor's real update callback, as in Step 2.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 5: Verify the read-side suite still passes**

Run: `npm run test:product-scope && npm run test:product-editing`
Expected: both PASS. Nothing in this task changes their inputs, so a failure here means an import cycle or a signature drift — fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add components/panels/NodeDetailPanel.tsx components/panels/AcceptanceEditor.tsx
git commit -m "feat: change a node's product without leaving the panel"
```

---

## Task 6: The product manager — list, create, edit

**Files:**
- Create: `components/settings/ProductFormDialog.tsx`
- Create: `components/settings/ProductManagerPanel.tsx`
- Modify: `app/project/[id]/settings/page.tsx`

- [ ] **Step 1: Write the create/edit dialog**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ProductDefinition } from "@arkaik/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { deriveProductId, type ProductDraft } from "@/lib/utils/product-editing";

/**
 * Create or edit one product.
 *
 * The id is derived from the title on create and **frozen thereafter** (§ D2).
 * It is the key every member node stores, and the alternative — an editable id —
 * needs a multi-node rewrite that can half-fail, leaving some members pointing
 * at the old key and some at the new. The id is shown, not hidden: a user who
 * hand-edits a bundle later needs to know what it is.
 */

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The product being edited, or `null` to create a new one. */
  product: ProductDefinition | null;
  /** Every id already taken, so a derived slug never collides. */
  existingIds: readonly string[];
  /** Members of the product being edited, for the narrowing warning (§ D4). */
  memberPlatforms: readonly PlatformId[];
  onSave: (draft: ProductDraft) => void;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  existingIds,
  memberPlatforms,
  onSave,
}: ProductFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);

  // Re-seed whenever the dialog opens on a different product. Keying off `open`
  // as well means reopening on the same product discards an abandoned edit.
  useEffect(() => {
    if (!open) return;
    setTitle(typeof product?.title === "string" ? product.title : "");
    setDescription(typeof product?.description === "string" ? product.description : "");
    setPlatforms(Array.isArray(product?.platforms) ? [...(product.platforms as PlatformId[])] : []);
  }, [open, product]);

  const editing = product !== null;
  const id = editing ? product.id : deriveProductId(title, existingIds);

  // Narrowing below what members already claim is *allowed* — the containment
  // rule is a validator warning, never an error, because narrowing a product's
  // platforms is a product decision and must not fail CI. So this reports
  // rather than blocks, and says exactly which platforms would stop showing.
  const dropped = memberPlatforms.filter((platform) => !platforms.includes(platform));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ id, title: title.trim(), description, platforms });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>
            A product is one app in this project&rsquo;s family &mdash; an end-user app, an admin
            dashboard, a public API. They share one graph.
          </DialogDescription>
        </DialogHeader>
        <form id="product-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Admin dashboard"
              required
              aria-label="Product title"
            />
            <p className="text-xs text-muted-foreground">
              Identifier: <code>{id || "—"}</code>
              {editing ? " — fixed once created." : " — derived from the title, and fixed once created."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this app is for"
              aria-label="Product description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Platforms
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {PLATFORMS.map((platform) => {
                const selected = platforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setPlatforms((previous) =>
                        previous.includes(platform.id)
                          ? previous.filter((p) => p !== platform.id)
                          : [...previous, platform.id],
                      )
                    }
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                      selected ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {PLATFORM_LABELS[platform.id]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {platforms.length === 0
                ? "No platforms: availability is not tracked for this product, and its nodes carry a single status."
                : "Nodes in this product can only claim these platforms."}
            </p>
            {dropped.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Nodes in this product currently use{" "}
                {dropped.map((platform) => PLATFORM_LABELS[platform]).join(", ")}. Saving this keeps
                them, but they stop showing.
              </p>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" className="cursor-pointer" disabled={!title.trim()}>
            {editing ? "Save" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Check `PLATFORM_LABELS` is exported from `components/graph/nodes/node-styles` before relying on it — `NewNodeForm.tsx` already imports it from there, so it is.

- [ ] **Step 2: Write the manager panel (list + create/edit wiring)**

The delete dialog arrives in Task 7; for now the Delete button is rendered and wired to a `onRequestDelete` callback that Task 7 fills in.

```tsx
"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { resolveProducts, type ProductDefinition } from "@arkaik/schema";
import type { Node, ProjectBundle, ProjectMetadata } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { ProductFormDialog } from "@/components/settings/ProductFormDialog";
import {
  membersOfProduct,
  upsertProduct,
  type ProductDraft,
} from "@/lib/utils/product-editing";
import { platformCountLabel } from "@/lib/utils/product-scope";

/**
 * The Products section of project settings — where a human can finally do what
 * only an agent could before: name the apps this project describes.
 *
 * Definitions are project metadata, so a create or a rename is a single
 * `updateProject`. Only deletion touches nodes, and only deletion goes through
 * `applyProductPlan` (Task 7).
 */

interface ProductManagerPanelProps {
  project: ProjectBundle | undefined;
  nodes: readonly Node[];
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
  /** Task 7 opens the delete-with-reassign dialog from here. */
  onRequestDelete: (product: ProductDefinition) => void;
}

export function ProductManagerPanel({
  project,
  nodes,
  updateProject,
  onRequestDelete,
}: ProductManagerPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDefinition | null>(null);
  const [saving, setSaving] = useState(false);

  const products = useMemo(() => resolveProducts(project?.project), [project]);

  // Stored membership only — the count a deletion would have to answer for.
  const memberCounts = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, membersOfProduct(nodes, p.id).length])),
    [nodes, products],
  );

  /** The platforms this product's members actually claim — the narrowing warning's input. */
  const memberPlatforms = useMemo<PlatformId[]>(() => {
    if (!editing) return [];
    const used = new Set<PlatformId>();
    for (const node of membersOfProduct(nodes, editing.id)) {
      for (const platform of node.platforms ?? []) used.add(platform);
    }
    return [...used];
  }, [editing, nodes]);

  async function handleSave(draft: ProductDraft) {
    if (saving) return;
    setSaving(true);
    try {
      await updateProject({
        metadata: { ...(project?.project.metadata ?? {}), products: upsertProduct(products, draft) },
      });
      toast.success(editing ? `"${draft.title}" was updated.` : `"${draft.title}" was created.`);
    } catch (err) {
      console.error("[ProductManagerPanel] Failed to save product:", err);
      toast.error(err instanceof Error ? err.message : "Could not save this product.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {products.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            This project describes one product. Add another &mdash; an admin dashboard, a public
            API, a CLI &mdash; and every page gains a scope selector for moving between them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {typeof product.title === "string" && product.title.trim() !== ""
                      ? product.title
                      : product.id}
                  </p>
                  {typeof product.description === "string" && product.description.trim() !== "" ? (
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(Array.isArray(product.platforms) ? product.platforms : []).map((platform) => (
                      <Badge key={platform} variant="secondary">
                        {PLATFORM_LABELS[platform as PlatformId] ?? platform}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {platformCountLabel(product.platforms)} &middot; {memberCounts[product.id] ?? 0}{" "}
                      node{(memberCounts[product.id] ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => {
                      setEditing(product);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="cursor-pointer text-destructive"
                    onClick={() => onRequestDelete(product)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button
            variant="outline"
            className="cursor-pointer"
            disabled={!project || saving}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <PlusIcon className="size-4" />
            Add product
          </Button>
        </div>
      </div>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        existingIds={products.map((p) => p.id)}
        memberPlatforms={memberPlatforms}
        onSave={(draft) => void handleSave(draft)}
      />
    </>
  );
}
```

- [ ] **Step 3: Render the section in settings**

In `app/project/[id]/settings/page.tsx`, add the imports:

```tsx
import { ProductManagerPanel } from "@/components/settings/ProductManagerPanel";
import { useNodes } from "@/lib/hooks/useNodes";
```

Take `updateProject` from the existing `useProject` call and add `useNodes`:

```tsx
  const { project, loading, updateProject } = useProject(id);
  const { nodes } = useNodes(id);
```

Insert a new `<section>` **between** the Linked repositories section and the Danger zone section:

```tsx
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Products</h2>
                <p className="text-sm text-muted-foreground">
                  A project can describe a family of apps sharing one graph. Naming them lets every
                  page scope to one &mdash; and lets a web-only dashboard stop dragging down your
                  Android numbers.
                </p>
              </div>
              <ProductManagerPanel
                project={project}
                nodes={nodes}
                updateProject={updateProject}
                onRequestDelete={() => {}}
              />
            </section>
```

The `onRequestDelete` no-op is replaced in Task 7.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. If `updateProject`'s parameter type rejects `{ metadata }`, widen `ProductManagerPanelProps["updateProject"]` to match `useProject`'s actual signature rather than casting at the call site.

- [ ] **Step 5: Commit**

```bash
git add components/settings/ProductFormDialog.tsx components/settings/ProductManagerPanel.tsx \
        'app/project/[id]/settings/page.tsx'
git commit -m "feat: name your project's products without editing JSON"
```

---

## Task 7: Delete a product, and say where its nodes go

**Files:**
- Create: `components/settings/ProductDeleteDialog.tsx`
- Modify: `components/settings/ProductManagerPanel.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ProductDefinition } from "@arkaik/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Delete a product, and decide what happens to the nodes that named it (§ D3).
 *
 * The count is stated before the choice because it is the whole reason there is
 * a choice: deleting an empty product is a one-click nothing, and deleting one
 * with forty views is a decision. Leaving them unassigned is offered rather than
 * assumed — an unassigned flow shows under All products only, which is triage,
 * not deletion, but it is still a place a node can get lost.
 */

/** Radix reserves "" for no-selection, so "leave unassigned" needs a sentinel. */
const UNASSIGNED = "__unassigned__";

interface ProductDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDefinition | null;
  /** How many nodes store this product's id. */
  memberCount: number;
  /** Every other product, as reassignment targets. */
  otherProducts: readonly ProductDefinition[];
  onConfirm: (reassignTo: string | null) => void;
  busy?: boolean;
}

export function ProductDeleteDialog({
  open,
  onOpenChange,
  product,
  memberCount,
  otherProducts,
  onConfirm,
  busy,
}: ProductDeleteDialogProps) {
  const [reassignTo, setReassignTo] = useState<string>(UNASSIGNED);

  // Default to unassigned every time the dialog opens: a remembered target from
  // the previous deletion is exactly the kind of state that moves forty nodes
  // somewhere nobody chose.
  useEffect(() => {
    if (open) setReassignTo(UNASSIGNED);
  }, [open, product]);

  const title = typeof product?.title === "string" && product.title.trim() !== ""
    ? product.title
    : product?.id ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete product</DialogTitle>
          <DialogDescription>
            {memberCount === 0
              ? `Nothing belongs to "${title}", so deleting it changes nothing else.`
              : `${memberCount} node${memberCount === 1 ? "" : "s"} belong${memberCount === 1 ? "s" : ""} to "${title}".`}
          </DialogDescription>
        </DialogHeader>

        {memberCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Move them to
            </span>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger aria-label="Move nodes to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Leave them unassigned</SelectItem>
                {otherProducts.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {typeof other.title === "string" && other.title.trim() !== "" ? other.title : other.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reassignTo === UNASSIGNED && (
              <p className="text-xs text-muted-foreground">
                Unassigned nodes still exist &mdash; they appear under All products until someone
                gives them a home.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            disabled={busy}
            onClick={() => onConfirm(reassignTo === UNASSIGNED ? null : reassignTo)}
          >
            {busy ? "Deleting…" : "Delete product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Own the delete state inside the manager panel**

Move deletion into `ProductManagerPanel` rather than the settings page — the panel already holds `products`, `nodes` and `updateProject`, which is everything a plan needs. Replace the `onRequestDelete` prop with an `applyMutations` prop.

Change the props interface:

```tsx
import type { MutationOp } from "@arkaik/schema";

interface ProductManagerPanelProps {
  project: ProjectBundle | undefined;
  nodes: readonly Node[];
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
  applyMutations: (ops: MutationOp[]) => Promise<unknown>;
}
```

Add the imports and the state:

```tsx
import { ProductDeleteDialog } from "@/components/settings/ProductDeleteDialog";
import { applyProductPlan } from "@/lib/utils/apply-product-plan";
import { planProductDeletion } from "@/lib/utils/product-editing";
```

```tsx
  const [deleting, setDeleting] = useState<ProductDefinition | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  async function handleDelete(reassignTo: string | null) {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    const plan = planProductDeletion(products, nodes, deleting.id, reassignTo);
    try {
      await applyProductPlan(plan, {
        nodesById,
        projectMetadata: project?.project.metadata,
        updateProject,
        applyMutations: applyMutations as ProductPlanApply,
      });
      const moved = plan.reassignments.length;
      toast.success(
        moved === 0
          ? `"${deleting.title ?? deleting.id}" was deleted.`
          : `"${deleting.title ?? deleting.id}" was deleted; ${moved} node${moved === 1 ? "" : "s"} ${reassignTo === null ? "are now unassigned" : "moved"}.`,
      );
      setDeleting(null);
    } catch (err) {
      console.error("[ProductManagerPanel] Failed to delete product:", err);
      toast.error(err instanceof Error ? err.message : "Could not delete this product.");
    } finally {
      setDeleteBusy(false);
    }
  }
```

`ProductPlanApply` is whatever `applyProductPlan` declares its `applyMutations` to be; import the type from `@/lib/utils/apply-product-plan` and export it there if it is not already exported. Do not use `any`.

Wire the Delete button to `setDeleting(product)` and render the dialog beside the form dialog:

```tsx
      <ProductDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null);
        }}
        product={deleting}
        memberCount={deleting ? memberCounts[deleting.id] ?? 0 : 0}
        otherProducts={products.filter((p) => p.id !== deleting?.id)}
        onConfirm={(reassignTo) => void handleDelete(reassignTo)}
        busy={deleteBusy}
      />
```

- [ ] **Step 3: Update the settings page call site**

```tsx
  const { nodes, applyMutations } = useNodes(id);
```

```tsx
              <ProductManagerPanel
                project={project}
                nodes={nodes}
                updateProject={updateProject}
                applyMutations={applyMutations}
              />
```

- [ ] **Step 4: Verify types compile and the suites pass**

Run: `npx tsc --noEmit -p tsconfig.json && npm run test:product-editing && npm run test:product-scope`
Expected: no type errors, both suites PASS.

- [ ] **Step 5: Commit**

```bash
git add components/settings/ProductDeleteDialog.tsx components/settings/ProductManagerPanel.tsx \
        'app/project/[id]/settings/page.tsx'
git commit -m "feat: deleting a product asks where its nodes should go"
```

---

## Task 8: Library selection and bulk move

**Files:**
- Create: `components/library/LibrarySelectionBar.tsx`
- Modify: `components/library/NodeCard.tsx`
- Modify: `components/library/NodeTable.tsx`
- Modify: `app/project/[id]/library/page.tsx`

There is no `@radix-ui/react-checkbox` in this repo and no `components/ui/checkbox.tsx`. Use a styled native `<input type="checkbox">` — one control does not justify a new dependency.

- [ ] **Step 1: Add an optional checkbox to `NodeCard`**

Add to `NodeCardProps`:

```tsx
  /**
   * Selection state, or `undefined` when the surface has no selection at all.
   *
   * `undefined` rather than `false` so the card renders exactly as it did before
   * selection existed — no checkbox, no gutter, no layout shift.
   */
  selected?: boolean;
  onToggleSelected?: (nodeId: string) => void;
```

Render it as the first child of `CardHeader`, stopping propagation so ticking a box never opens the node:

```tsx
        {selected !== undefined && (
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${node.title}`}
            className="size-4 shrink-0 cursor-pointer accent-primary"
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelected?.(node.id)}
          />
        )}
```

- [ ] **Step 2: Add an optional checkbox column to `NodeTable`**

Add to `NodeTableProps`:

```tsx
  /** Selected node ids, or `undefined` when the surface has no selection. */
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (nodeId: string) => void;
  /** Ticks or clears every visible row. */
  onToggleAll?: () => void;
```

Add a leading `<TableHead>` and a leading `<TableCell>` per row, both rendered only when `selectedIds !== undefined`. The header checkbox is checked when every visible row is selected:

```tsx
            {selectedIds !== undefined && (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible nodes"
                  className="size-4 cursor-pointer accent-primary"
                  checked={nodes.length > 0 && nodes.every((node) => selectedIds.has(node.id))}
                  onChange={() => onToggleAll?.()}
                />
              </TableHead>
            )}
```

```tsx
              {selectedIds !== undefined && (
                <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${node.title}`}
                    className="size-4 cursor-pointer accent-primary"
                    checked={selectedIds.has(node.id)}
                    onChange={() => onToggleSelected?.(node.id)}
                  />
                </TableCell>
              )}
```

- [ ] **Step 3: Write the selection bar**

```tsx
"use client";

import { PRODUCT_MEMBERSHIP_SPECIES, type ProductDefinition } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The Library's bulk action bar. Selection is a **general** mechanism whose
 * first action happens to be moving nodes between products (§ D6).
 *
 * Data models and API endpoints derive their membership from who consumes them,
 * so a move cannot touch them — but their checkboxes are not disabled. Disabling
 * them would tie a general selection mechanism to one action, and would answer
 * "why can't I tick this?" with silence. Naming the subset instead is both
 * honest and short.
 */

/** Radix reserves "" for no-selection; "Unassigned" is a real choice. */
const UNASSIGNED = "__unassigned__";

interface LibrarySelectionBarProps {
  selected: readonly Node[];
  products: readonly ProductDefinition[];
  onClear: () => void;
  onMove: (productId: string | null) => void;
  busy?: boolean;
}

export function LibrarySelectionBar({
  selected,
  products,
  onClear,
  onMove,
  busy,
}: LibrarySelectionBarProps) {
  if (selected.length === 0) return null;

  const movable = selected.filter((node) => PRODUCT_MEMBERSHIP_SPECIES.includes(node.species)).length;
  const derived = selected.length - movable;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2">
      <span className="text-sm font-medium">
        {selected.length} selected
      </span>
      {products.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value=""
            disabled={busy || movable === 0}
            onValueChange={(next) => onMove(next === UNASSIGNED ? null : next)}
          >
            <SelectTrigger aria-label="Move to product" className="h-8 w-56">
              <SelectValue placeholder="Move to product…" />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {typeof product.title === "string" && product.title.trim() !== ""
                    ? product.title
                    : product.id}
                </SelectItem>
              ))}
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {movable === 0
              ? "None of these can hold a product — data models and endpoints derive theirs."
              : derived > 0
                ? `Moves ${movable} of ${selected.length}; data models and endpoints derive their product.`
                : null}
          </span>
        </div>
      )}
      <Button variant="ghost" className="ml-auto h-8 cursor-pointer" onClick={onClear} disabled={busy}>
        Clear
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Wire selection into the Library page**

In `app/project/[id]/library/page.tsx`, add the imports:

```tsx
import { LibrarySelectionBar } from "@/components/library/LibrarySelectionBar";
import { applyProductPlan } from "@/lib/utils/apply-product-plan";
import { planProductMove } from "@/lib/utils/product-editing";
```

Take `applyMutations` from the existing `useNodes` call and `updateProject` from `useProject`:

```tsx
  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, applyMutations } = useNodes(id);
  const { project: projectBundle, updateProject } = useProject(id);
```

Add the state and handlers next to the other page state:

```tsx
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState(false);

  function toggleSelected(nodeId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  /**
   * Selection is scoped to what is on screen. Ticking "all" while a species
   * filter or a search is active must not quietly select the nodes the filter
   * is hiding — a bulk move is exactly where an invisible selection does damage.
   */
  function toggleAllVisible() {
    setSelectedIds((previous) =>
      visibleNodes.every((node) => previous.has(node.id))
        ? new Set()
        : new Set(visibleNodes.map((node) => node.id)),
    );
  }

  const selectedNodes = useMemo(
    () => dataNodes.filter((node) => selectedIds.has(node.id)),
    [dataNodes, selectedIds],
  );

  async function handleMoveToProduct(productId: string | null) {
    if (moving) return;
    setMoving(true);
    const plan = planProductMove(dataNodes, [...selectedIds], productId);
    try {
      if (plan.reassignments.length === 0) {
        toast.info("Those nodes are already there.");
      } else {
        await applyProductPlan(plan, {
          nodesById,
          projectMetadata: projectBundle?.project.metadata,
          updateProject,
          applyMutations,
        });
        const moved = plan.reassignments.length;
        toast.success(
          productId === null
            ? `${moved} node${moved === 1 ? "" : "s"} unassigned.`
            : `${moved} node${moved === 1 ? "" : "s"} moved.`,
        );
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error("[LibraryPage] Failed to move nodes:", err);
      toast.error(err instanceof Error ? err.message : "Could not move those nodes.");
    } finally {
      setMoving(false);
    }
  }
```

Import `toast` from `sonner` if the page does not already.

Render the bar directly above the node list/table, and pass the selection props down:

```tsx
        <LibrarySelectionBar
          selected={selectedNodes}
          products={[...scope.productsById.values()]}
          onClear={() => setSelectedIds(new Set())}
          onMove={(productId) => void handleMoveToProduct(productId)}
          busy={moving}
        />
```

For the cards, pass `selected={selectedIds.has(node.id)}` and `onToggleSelected={toggleSelected}`. For the table, pass `selectedIds={selectedIds}`, `onToggleSelected={toggleSelected}` and `onToggleAll={toggleAllVisible}`.

- [ ] **Step 5: Verify types compile and the suites pass**

Run: `npx tsc --noEmit -p tsconfig.json && npm run test:product-editing && npm run test:product-scope`
Expected: no type errors, both suites PASS.

- [ ] **Step 6: Commit**

```bash
git add components/library 'app/project/[id]/library/page.tsx'
git commit -m "feat: move a shelf of nodes into a product at once"
```

---

## Task 9: Verification, docs, and the manual pass

**Files:**
- Modify: `docs/rfcs/products.md`

- [ ] **Step 1: Run every suite this work could have touched**

Run:

```bash
npm run test:product-editing && \
npm run test:product-scope && \
npm run test:delivery && \
npm run test:acceptance-matrix && \
npm run test:pyramid && \
npm run test:products
```

Expected: all six PASS. Report the actual output; do not summarise it as "tests pass" without it.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: a successful Next.js build. Note: `npm run lint` already fails on `main` with pre-existing react-hooks problems and CI does not gate on it — do not attempt to make lint clean, but do not add new problems either.

- [ ] **Step 3: Verify the degenerate case by hand**

Open a project that declares **no** products and confirm, on Library and in the create form:
- no product picker in the New node dialog;
- no scope selector in the sidebar;
- no checkbox gutter change beyond the new selection column;
- platform toggles behave exactly as before.

This is the guarantee the whole feature rests on. If any of it fails, the guard is `products.length > 0` and it is missing somewhere.

- [ ] **Step 4: Update the RFC**

In `docs/rfcs/products.md`, amend the status block at the top. Replace the sentence beginning "**P3 (editing UI) and the per-surface override have not**" with:

```markdown
> **P3 (editing UI) has now shipped** — products are created, renamed,
> re-platformed and deleted from project settings, assigned from the node forms,
> and moved in bulk from the Library. The per-surface override has not, and
> neither has a UI for a product's `root_node_id` (a product created in the UI
> therefore has no journey anchor until one is set by hand).
```

In the § Phased plan list, change the `**P3 — Editing (M)**` bullet to begin with `**P3 — Editing (M)** — *shipped.*`.

- [ ] **Step 5: Commit**

```bash
git add docs/rfcs/products.md
git commit -m "docs: P3 shipped — products are editable from the app"
```

- [ ] **Step 6: Hand the visual pass to Alexis**

There is no browser driver in this environment, so the visual check is a handover, not an assertion. Produce this checklist in the PR body or the final message:

1. Settings → Products: create "Admin", web only. It appears with a `Web only` badge and `0 nodes`.
2. Sidebar: the product scope selector now exists. Switch to Admin.
3. Library → New node → View: the Product field is pre-filled with **Admin**, and only the **Web** platform toggle is offered. Create it. **It stays visible** — this is the dead end the issue reports.
4. Library: tick two views and a data model. The bar reads `3 selected` and `Moves 2 of 3; data models and endpoints derive their product.` Move them to Admin.
5. Settings → Products → Edit Admin → untick Web. The amber warning names the platforms its members use. Cancel.
6. Settings → Products → Delete Admin. The dialog reports the member count; choose "Leave them unassigned" and confirm. The nodes survive and show under All products.
7. Journey, under Admin: the empty state says the product has no anchor. **This is expected** — see Known gaps.

---

## Self-review notes

- **Spec coverage:** D1 → Task 3; D2 → Task 1 (`deriveProductId`) + Task 6 (frozen id); D3 → Task 7; D4 → Task 1 (`platformMenuFor`/`constrainPlatforms`) + Task 3 + Task 6 (narrowing warning); D5 → Task 5; D6 → Task 8; D7 → Task 6 (`upsertProduct` preserves `root_node_id`) + Task 9 Step 4 (recorded as a gap). Architecture §1 → Task 1, §2 → Task 1 Step 5, §3 → Tasks 6–7, §4 → Tasks 2–5, §5 → Task 8. Testing § → Task 1 Step 2.
- **Naming consistency:** `ProductPlan`, `ProductReassignment`, `ProductDraft`, `planProductDeletion`, `planProductMove`, `planToOps`, `withProductMembership`, `platformMenuFor`, `constrainPlatforms`, `applyProductPlan` are used identically in every task that references them.
- **Known deviation:** `slugifyProductTitle` is exported but not asserted directly — it is covered through `deriveProductId`, which is the only caller.

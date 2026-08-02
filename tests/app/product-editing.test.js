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
const fs = require("fs");
const { loadProductEditing, BUILD_DIR } = require("./load-product-editing");

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

test("removeProduct drops only the named definition", () => {
  assert.deepEqual(removeProduct(PRODUCTS, "admin").map((p) => p.id), ["app", "api"]);
  assert.deepEqual(removeProduct(PRODUCTS, "nope").map((p) => p.id), ["app", "admin", "api"]);
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

// The transpiled CommonJS is a build artefact, not a fixture: leaving it behind
// makes the next run's `require` cache and the working tree both dirtier than
// they need to be. Matches tests/app/product-scope.test.js.
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll product-editing tests passed" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);

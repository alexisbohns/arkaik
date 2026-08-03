#!/usr/bin/env node

/**
 * Product editing rules (lib/utils/product-editing.ts).
 *
 * The load-bearing assertions are the two that a component could not be made to
 * make: that `planProductMove` silently skips the species which *derive*
 * membership (moving a data model would write a key every read surface ignores),
 * and that with no products declared no plan changes anything — the degenerate
 * case guarantee, which is the whole reason products stayed opt-in. The latter
 * runs against a node set that still carries stored membership keys, because an
 * empty-in/empty-out version of it would pass an implementation that does
 * nothing at all.
 *
 * Two more earn their place by being data-loss shaped rather than logic shaped:
 * `planToOps` must emit NO op for a node its map has lost (a patch replaces
 * `metadata` wholesale, so the op it would otherwise emit deletes the node's
 * platform statuses and notes), and `planProductDeletion` must never reassign
 * members into the product it is deleting.
 *
 * `applyProductPlan` is exercised with two recording spies — the ordering of its
 * two writes is its entire reason for existing, and nothing else can observe it.
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
  platformLabel,
  applyProductPlan,
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

/** The same harness for `applyProductPlan`, the one async export here. */
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  not ok - ${name}`);
    console.error(`    ${err.message}`);
  }
}

/**
 * Two recording spies standing in for the two stores. `calls` is shared and
 * ordered, which is the point: the ordering of the membership write against the
 * definition write is the whole reason `applyProductPlan` exists.
 */
function makeStores(projectMetadata) {
  const calls = [];
  return {
    calls,
    stores: {
      nodesById: new Map(NODES.map((n) => [n.id, n])),
      projectMetadata,
      updateProject: async (patch) => {
        calls.push(["updateProject", patch]);
      },
      applyMutations: async (ops) => {
        calls.push(["applyMutations", ops]);
      },
    },
  };
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

test("upsertProduct replaces only the first of a duplicated id", () => {
  // resolveProducts is first-wins, so the first entry is the one the app sees
  // and the only one an edit can mean. The stale twin stays for the validator.
  const duplicated = [
    { id: "admin", title: "Admin", platforms: ["web"] },
    { id: "admin", title: "Admin (stale twin)", platforms: [] },
  ];
  const next = upsertProduct(duplicated, { id: "admin", title: "Console", platforms: ["web"] });
  assert.equal(next.length, 2);
  assert.equal(next[0].title, "Console");
  assert.equal(next[1].title, "Admin (stale twin)");
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

test("planProductDeletion refuses to reassign into the product it deletes", () => {
  // Otherwise every member ends up naming a product the same plan removes —
  // the stale key apply-product-plan orders its two writes to avoid.
  const plan = planProductDeletion(PRODUCTS, NODES, "admin", "admin");
  assert.deepEqual(plan.products.map((p) => p.id), ["app", "api"]);
  assert.deepEqual(plan.reassignments.map((r) => r.product), [null, null]);
});

test("planProductDeletion refuses a destination this project does not declare", () => {
  const plan = planProductDeletion(PRODUCTS, NODES, "admin", "ghost");
  assert.deepEqual(plan.reassignments.map((r) => r.product), [null, null]);
});

test("planProductDeletion of an undeclared product touches nothing", () => {
  // Nodes can carry a key for a product nobody declares (a half-synced bundle).
  // Deleting what was never declared must not sweep them.
  const plan = planProductDeletion([], NODES, "admin", null);
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

test("planProductMove treats a blank target as unassign", () => {
  const blank = [{ id: "V-blank", species: "view", metadata: { product: "   " } }];
  assert.deepEqual(planProductMove(NODES, ["V-home"], "  ").reassignments, [
    { nodeId: "V-home", product: null },
  ]);
  // And a node already storing a blank key is already unassigned, so moving it
  // to Unassigned is a no-op rather than a write that changes nothing.
  assert.deepEqual(planProductMove(blank, ["V-blank"], null).reassignments, []);
});

test("withProductMembership removes the key rather than blanking it", () => {
  assert.deepEqual(withProductMembership({ product: "admin", note: "keep me" }, null), { note: "keep me" });
  assert.deepEqual(withProductMembership(undefined, "app"), { product: "app" });
});

test("withProductMembership treats a blank product exactly as null", () => {
  // `product: ""` names a product resolveProducts can never match — a slower,
  // invisible spelling of unassigned, and the one a cleared field produces.
  assert.deepEqual(withProductMembership({ product: "admin", note: "keep me" }, ""), { note: "keep me" });
  assert.deepEqual(withProductMembership({ product: "admin" }, "   "), {});
});

test("planToOps patches metadata and preserves the rest of it", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));
  const ops = planToOps(planProductMove(NODES, ["V-home"], null), nodesById);
  assert.deepEqual(ops, [
    { op: "update_node", node_id: "V-home", patch: { metadata: { note: "keep me" } } },
  ]);
});

test("planToOps emits nothing for a node the map does not know", () => {
  // A plan is computed from one snapshot and executed against a possibly newer
  // map. Patching a vanished node would send metadata built from `undefined`,
  // and since a patch replaces `metadata` wholesale that op would take the
  // node's platformStatuses, notes and screenshots with it.
  const plan = planProductMove(NODES, ["V-home", "F-signup"], "api");
  assert.equal(plan.reassignments.length, 2);

  const stale = new Map([["F-signup", NODES[2]]]);
  assert.deepEqual(planToOps(plan, stale), [
    { op: "update_node", node_id: "F-signup", patch: { metadata: { product: "api" } } },
  ]);
  assert.deepEqual(planToOps(plan, new Map()), []);
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
  // Deliberately run against a NON-empty node set that still carries stored
  // `metadata.product` keys — a half-synced bundle, or a project whose products
  // were removed. An emptiness-only assertion here would pass an implementation
  // that does nothing at all, which is the opposite of what is being claimed:
  // the guarantee is that a product-less project is *untouched*, not that the
  // functions are inert.
  const nodesById = new Map(NODES.map((n) => [n.id, n]));
  assert.equal(NODES.filter((n) => n.metadata.product !== undefined).length, 3);

  for (const id of ["admin", "app", "nope"]) {
    const plan = planProductDeletion([], NODES, id, null);
    assert.deepEqual(plan.products, [], `${id}: definitions`);
    assert.deepEqual(plan.reassignments, [], `${id}: reassignments`);
    assert.deepEqual(planToOps(plan, nodesById), [], `${id}: ops`);
  }

  // And the node form is unchanged: every platform stays on offer.
  assert.deepEqual(platformMenuFor(null), ["web", "ios", "android"]);
});

test("platformLabel names a platform this build knows", () => {
  assert.equal(platformLabel("ios"), "iOS");
  assert.equal(platformLabel("web"), "Web");
});

test("platformLabel echoes an id it does not know rather than blanking it", () => {
  // Showing the junk is what tells a bundle's author their file says something
  // this build does not understand.
  assert.equal(platformLabel("watchos"), "watchos");
  assert.equal(platformLabel(undefined), "undefined");
});

console.log("\napply-product-plan");

async function main() {
  await asyncTest("applyProductPlan writes memberships before definitions", async () => {
    // If the definition write lands first and the membership write is then lost,
    // nodes point at a product nobody declares and every read surface degrades
    // silently. This order fails visibly instead.
    const { calls, stores } = makeStores({ title: "Demo" });
    await applyProductPlan(planProductDeletion(PRODUCTS, NODES, "admin", "app"), stores);

    assert.deepEqual(calls.map(([name]) => name), ["applyMutations", "updateProject"]);
    assert.deepEqual(calls[0][1], [
      { op: "update_node", node_id: "V-home", patch: { metadata: { product: "app", note: "keep me" } } },
      { op: "update_node", node_id: "V-list", patch: { metadata: { product: "app" } } },
    ]);
    // The rest of the project's metadata is carried through, not replaced.
    assert.equal(calls[1][1].metadata.title, "Demo");
    assert.deepEqual(calls[1][1].metadata.products.map((p) => p.id), ["app", "api"]);
  });

  await asyncTest("applyProductPlan skips the project write when products is null", async () => {
    const { calls, stores } = makeStores({ title: "Demo" });
    await applyProductPlan(planProductMove(NODES, ["V-home"], "app"), stores);
    assert.deepEqual(calls.map(([name]) => name), ["applyMutations"]);
  });

  await asyncTest("applyProductPlan does not call applyMutations with no ops", async () => {
    // An empty ops array is still a round trip, and a mutation journal entry.
    const { calls, stores } = makeStores({ title: "Demo" });
    await applyProductPlan(planProductDeletion(PRODUCTS, NODES, "api", null), stores);
    assert.deepEqual(calls.map(([name]) => name), ["updateProject"]);
  });

  // The transpiled CommonJS is a build artefact, not a fixture: leaving it behind
  // makes the next run's `require` cache and the working tree both dirtier than
  // they need to be. Matches tests/app/product-scope.test.js.
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll product-editing tests passed" : `\n${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

#!/usr/bin/env node

/**
 * Product scope helpers (lib/utils/product-scope.ts) — the app-side layer over
 * the schema's product projections.
 *
 * The load-bearing assertion is the "All products" one: `scopedPlatforms` must
 * intersect a node against **its own product's** menu, never against the
 * scope's platform list. Under All products that list is the union of every
 * product, so intersecting against it would leave a web-only admin view
 * contributing to the Android column exactly as it does today — the bug this
 * whole feature exists to fix. The fixture deliberately gives that admin view a
 * stale three-platform `platforms` array so the two implementations disagree.
 */

const fs = require("fs");
const { loadProductScope, BUILD_DIR } = require("./load-product-scope");

const {
  resolveProductScope,
  nodeInScope,
  scopedPlatforms,
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
  resetProductScopeStore,
} = loadProductScope();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Fixture -----------------------------------------------------------------
//
// Two products, deliberately of different arity, so the union is genuinely
// wider than either member's menu.

const ENDUSER = { id: "enduser", title: "End-user app", platforms: ["web", "ios", "android"] };
const ADMIN = { id: "admin", title: "Admin dashboard", platforms: ["web"] };

const bundle = { project: { id: "P1", metadata: { products: [ENDUSER, ADMIN] } } };
const noProducts = { project: { id: "P2", metadata: {} } };

/** A view whose stored platforms predate products — the stale, over-claiming case. */
const adminView = {
  id: "V-admin",
  species: "view",
  platforms: ["web", "ios", "android"],
  metadata: { product: "admin" },
};
const endUserView = {
  id: "V-feed",
  species: "view",
  platforms: ["ios", "web"],
  metadata: { product: "enduser" },
};
/** Triage: stores no membership at all. */
const unassignedView = { id: "V-orphan", species: "view", platforms: ["web", "ios", "android"], metadata: {} };
/** Points at a product the project no longer declares. */
const ghostView = { id: "V-ghost", species: "view", platforms: ["web", "android"], metadata: { product: "ghost" } };
/** A species that never stores membership; it is derived from consumers. */
const dataModel = { id: "DM-user", species: "data-model", platforms: ["web", "ios"], metadata: { product: "admin" } };

// --- resolveProductScope -----------------------------------------------------

const allScope = resolveProductScope(bundle, null);
assert(allScope.productId === null && allScope.product === null, "All products is a null id and a null product");
assert(
  eq(allScope.platforms, ["web", "ios", "android"]),
  `All products unions every declared menu (got ${JSON.stringify(allScope.platforms)})`,
);
assert(allScope.isMultiPlatform === true, "a 3-platform union is multi-platform");
assert(allScope.productsById.size === 2, "productsById indexes every declared product");

const endUserScope = resolveProductScope(bundle, "enduser");
assert(
  endUserScope.product === ENDUSER && eq(endUserScope.platforms, ["web", "ios", "android"]),
  "a named product resolves to its own definition and menu",
);
assert(endUserScope.isMultiPlatform === true, "arity 3 is multi-platform");

const adminScope = resolveProductScope(bundle, "admin");
assert(eq(adminScope.platforms, ["web"]), "a web-only product scopes to one platform");
assert(adminScope.isMultiPlatform === false, "arity 1 is NOT multi-platform — the arity rule collapses it");

const platformless = { project: { metadata: { products: [{ id: "api", title: "Public API", platforms: [] }] } } };
const apiScope = resolveProductScope(platformless, "api");
assert(
  eq(apiScope.platforms, []) && apiScope.isMultiPlatform === false,
  "arity 0 is NOT multi-platform either — rendered identically to arity 1",
);

const bareScope = resolveProductScope(noProducts, null);
assert(
  eq(bareScope.platforms, ["web", "ios", "android"]) && bareScope.productsById.size === 0,
  "a project declaring no products degenerates to every platform, unchanged from today",
);
assert(bareScope.isMultiPlatform === true, "the degenerate case stays multi-platform");

const undefinedScope = resolveProductScope(undefined, null);
assert(
  eq(undefinedScope.platforms, ["web", "ios", "android"]) && undefinedScope.product === null,
  "an unloaded bundle degrades to the degenerate case rather than throwing",
);

const staleScope = resolveProductScope(bundle, "ghost");
assert(
  staleScope.product === null && eq(staleScope.platforms, ["web", "ios", "android"]),
  "a stale scope id degrades to the union rather than to nothing",
);

// --- nodeInScope -------------------------------------------------------------

assert(nodeInScope(adminView, adminScope) === true, "a node matches the scope it stores membership for");
assert(nodeInScope(adminView, endUserScope) === false, "a node does not leak into another product's scope");
assert(
  nodeInScope(adminView, allScope) && nodeInScope(unassignedView, allScope) && nodeInScope(dataModel, allScope),
  "All products matches everything, membership or not",
);
assert(
  nodeInScope(unassignedView, adminScope) === false,
  "a node with no membership is in triage — excluded from a named scope",
);
assert(
  nodeInScope(dataModel, adminScope) === false,
  "a species that never stores membership never matches a named scope by its stored key",
);

// --- scopedPlatforms — the headline assertion --------------------------------

assert(
  eq(allScope.platforms, ["web", "ios", "android"]) && eq(adminView.platforms, ["web", "ios", "android"]),
  "precondition: under All products the scope union and the stale node array are both 3 wide",
);
assert(
  eq(scopedPlatforms(adminView, allScope), ["web"]),
  `THE FIX: under All products a web-only product's view yields ["web"], not the union (got ${JSON.stringify(
    scopedPlatforms(adminView, allScope),
  )})`,
);
assert(
  eq(scopedPlatforms(endUserView, allScope), ["web", "ios"]),
  "a multi-platform product's view keeps its own platforms, ordered by PLATFORM_IDS",
);
assert(
  eq(scopedPlatforms(adminView, adminScope), ["web"]),
  "the same node under its own named scope yields the same answer",
);

// Fallback to scope.product for a membership-less node under a named scope.
assert(
  eq(scopedPlatforms(unassignedView, adminScope), ["web"]),
  "a membership-less node falls back to the scoped product's menu",
);
assert(
  eq(scopedPlatforms(unassignedView, allScope), ["web", "ios", "android"]),
  "under All products a membership-less node has no menu to intersect against and keeps its own list",
);

// A node whose own product is unknown/missing.
assert(
  eq(scopedPlatforms(ghostView, allScope), ["web", "android"]),
  "an unknown product id degrades to the node's own list, never to empty",
);
assert(
  eq(scopedPlatforms(ghostView, adminScope), ["web"]),
  "an unknown product id under a named scope falls back to that scope's menu",
);
assert(
  eq(scopedPlatforms(adminView, bareScope), ["web", "ios", "android"]),
  "with no products declared, every node keeps its own platforms — today's behaviour, unchanged",
);

// --- The store: one value, shared by every consumer -------------------------
//
// The sidebar selector and every surface each call `useProductScope`. If that
// hook held per-component `useState`, picking a product would relabel the
// selector and change nothing else — the feature would be inert. What makes it
// shared is this store, so this is where that is asserted. `useSyncExternalStore`
// adds no logic of its own; it only wires `subscribe` / `getSnapshot` to React.

resetProductScopeStore();

// Two independent consumers, standing in for the selector and a surface.
let selectorNotifications = 0;
let surfaceNotifications = 0;
const unsubscribeSelector = subscribeProductScope(() => selectorNotifications++);
const unsubscribeSurface = subscribeProductScope(() => surfaceNotifications++);

assert(getProductScopeId("P1") === null, "a project with nothing stored starts at All products");

// The selector sets; the surface must observe it.
setProductScopeId("P1", "admin");
assert(
  selectorNotifications === 1 && surfaceNotifications === 1,
  `one set notifies EVERY subscriber, not just the setter (got ${selectorNotifications}/${surfaceNotifications})`,
);
assert(
  getProductScopeId("P1") === "admin",
  "the snapshot a second consumer reads is the value the first one set — the scope is shared",
);

// Snapshot stability: useSyncExternalStore re-reads on every render and warns
// if the value is not referentially cached. A primitive makes that free.
assert(
  getProductScopeId("P1") === getProductScopeId("P1"),
  "repeated snapshot reads are referentially equal, so React never loops",
);

setProductScopeId("P1", "admin");
assert(
  selectorNotifications === 1,
  "setting the value it already holds notifies no one — no render storm from a re-select",
);

setProductScopeId("P1", null);
assert(
  getProductScopeId("P1") === null && selectorNotifications === 2,
  "returning to All products is a real transition, notified like any other",
);

assert(
  getProductScopeId("P2") === null,
  "scope is keyed per project — setting P1 never moved P2",
);

unsubscribeSelector();
setProductScopeId("P1", "enduser");
assert(
  selectorNotifications === 2 && surfaceNotifications === 3,
  `unsubscribing stops notifications for that consumer only (got ${selectorNotifications}/${surfaceNotifications})`,
);

unsubscribeSurface();
resetProductScopeStore();

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll product-scope tests passed");

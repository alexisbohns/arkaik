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
  productPlatforms,
  effectiveNodePlatforms,
  buildProductUsageIndex,
  productsUsingNode,
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

process.exit(failures === 0 ? 0 : 1);

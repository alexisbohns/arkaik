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

process.exit(failures === 0 ? 0 : 1);

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

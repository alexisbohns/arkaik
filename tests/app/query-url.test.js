#!/usr/bin/env node

/**
 * Query-string writes (lib/utils/query-url.ts) — the pure half of the fix for
 * two independent writers on one surface clobbering each other.
 *
 * The interesting assertions are the interleaving ones at the bottom: a
 * keyed mutation applied to a base read *after* the other writer has landed
 * keeps both changes, which is exactly what rebuilding from a render-time
 * `searchParams` closure could not do. The two mutations here are the real
 * ones — the acceptance filters' delete-then-set over `KEYS`, and the product
 * override's single set/delete — restated only as far as this module's shape
 * requires, since the hooks themselves need React to load.
 */

const fs = require("fs");
const { loadUtil, BUILD_DIR } = require("./load-panel-utils");

const { buildQueryHref, currentSearch } = loadUtil("query-url");

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const PATH = "/project/p1/acceptances";

// The two real writers, as mutations.
const FILTER_KEYS = ["search", "platform", "status", "value", "anchor", "parity_gap"];
const setSearch = (search) => (params) => {
  for (const key of FILTER_KEYS) params.delete(key);
  if (search) params.set("search", search);
};
const setProduct = (next) => (params) => {
  if (next === null) params.delete("product");
  else params.set("product", next);
};

// --- href shape ---
assert(
  buildQueryHref(PATH, "", setSearch("checkout")) === `${PATH}?search=checkout`,
  "a write onto an empty query produces pathname?qs",
);
assert(
  buildQueryHref(PATH, "?search=checkout", setSearch("")) === PATH,
  "clearing the last param yields a bare pathname, not a trailing '?'",
);
assert(
  buildQueryHref(PATH, "?product=admin", setProduct(null)) === PATH,
  "All products deletes the key rather than writing a sentinel",
);
assert(
  buildQueryHref(PATH, "search=checkout", setProduct("admin")) === `${PATH}?search=checkout&product=admin`,
  "a base without its leading '?' is accepted",
);

// --- each writer leaves foreign keys alone ---
assert(
  buildQueryHref(PATH, "?panel=n1&search=old", setSearch("new")) === `${PATH}?panel=n1&search=new`,
  "the filter writer preserves params it does not own",
);
assert(
  buildQueryHref(PATH, "?species=view&product=admin", setProduct("web")) ===
    `${PATH}?species=view&product=web`,
  "the override writer preserves params it does not own",
);

// --- the race from issue #328, both directions ---
// Step 1: the debounced search lands. Step 2: the product control fires before
// the router transition commits — so it reads a base that already has `search`,
// which is the whole point of reading at call time.
const afterSearch = buildQueryHref(PATH, "", setSearch("checkout"));
const afterBoth = buildQueryHref(PATH, afterSearch.slice(afterSearch.indexOf("?")), setProduct("admin"));
assert(
  afterBoth === `${PATH}?search=checkout&product=admin`,
  "product picked mid-debounce keeps the typed search",
);

const afterProduct = buildQueryHref(PATH, "", setProduct("admin"));
const afterBothMirror = buildQueryHref(
  PATH,
  afterProduct.slice(afterProduct.indexOf("?")),
  setSearch("checkout"),
);
assert(
  afterBothMirror === `${PATH}?product=admin&search=checkout`,
  "a search debounce landing after a product pick keeps the override",
);

// The stale-closure behaviour this replaces, stated once so the regression is
// visible: same two writes, second one built from the pre-search base.
assert(
  buildQueryHref(PATH, "", setProduct("admin")) === `${PATH}?product=admin`,
  "building from a stale base drops the other writer's change (the old bug)",
);

// --- currentSearch under SSR ---
assert(typeof window === "undefined" && currentSearch() === "", "currentSearch falls back to '' with no window");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll query-url tests passed");

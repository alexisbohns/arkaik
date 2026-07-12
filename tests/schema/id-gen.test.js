#!/usr/bin/env node

/**
 * Unit tests for the deterministic id generator (packages/schema/src/id-gen.ts,
 * docs/spec/bundle-format.md § Identifier Conventions) adopted by the app in
 * issue #215: kebab-case-from-title node ids, `-2`/`-3` collision
 * disambiguation, the untitled fallback, and the `e-{source}-{target}` edge-id
 * helper.
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const { kebabCase, deriveNodeId, edgeId, SPECIES_PREFIXES } = loadSchema();

// --- kebabCase ---
assert(kebabCase("User Profile") === "user-profile", "kebabCase: spaces become hyphens, lowercased");
assert(kebabCase("Set Intensity!") === "set-intensity", "kebabCase: trailing punctuation is trimmed");
assert(kebabCase("Café Menu") === "cafe-menu", "kebabCase: accents are stripped");
assert(kebabCase("  Multiple   Spaces  ") === "multiple-spaces", "kebabCase: runs collapse, ends trimmed");
assert(kebabCase("API v2 / beta") === "api-v2-beta", "kebabCase: slashes and symbols collapse to single hyphens");
assert(kebabCase("!!!") === "", "kebabCase: symbol-only title kebabs to empty");

// --- deriveNodeId: prefix + kebab of title ---
assert(deriveNodeId("view", "User Profile") === "V-user-profile", "deriveNodeId: view prefix + kebab");
assert(deriveNodeId("flow", "Checkout Flow") === "F-checkout-flow", "deriveNodeId: flow prefix + kebab");
assert(deriveNodeId("data-model", "Bounce") === "DM-bounce", "deriveNodeId: data-model prefix + kebab");
assert(deriveNodeId("api-endpoint", "Create Bounce") === "API-create-bounce", "deriveNodeId: api-endpoint prefix + kebab");

// --- deriveNodeId: collision disambiguation ---
assert(
  deriveNodeId("data-model", "Bounce", new Set(["DM-bounce"])) === "DM-bounce-2",
  "deriveNodeId: first collision gets -2",
);
assert(
  deriveNodeId("data-model", "Bounce", new Set(["DM-bounce", "DM-bounce-2"])) === "DM-bounce-3",
  "deriveNodeId: second collision gets -3",
);
assert(
  deriveNodeId("view", "Home", ["V-home", "V-home-2"]) === "V-home-3",
  "deriveNodeId: accepts an array (not just a Set) for existing ids",
);
assert(
  deriveNodeId("view", "Home", []) === "V-home",
  "deriveNodeId: no collision when the id is free",
);

// --- deriveNodeId: untitled fallback ---
{
  const a = deriveNodeId("view", "", []);
  const b = deriveNodeId("view", "", []);
  assert(a.startsWith("V-") && a.length > 2, "deriveNodeId: empty title falls back to a prefixed hashed id");
  assert(a === b, "deriveNodeId: untitled fallback is deterministic");
  assert(!/^V-[0-9a-f]{8}$/.test(a), "deriveNodeId: untitled fallback is not shaped like the old random id");
  const seeded1 = deriveNodeId("view", "", [], "V-oldrandom1");
  const seeded2 = deriveNodeId("view", "", [], "V-oldrandom2");
  assert(seeded1 !== seeded2, "deriveNodeId: different fallback seeds yield different ids");
  assert(seeded1 === deriveNodeId("view", "", [], "V-oldrandom1"), "deriveNodeId: seeded fallback is stable");
}

// --- edgeId ---
assert(edgeId("V-home", "API-list-bounces") === "e-V-home-API-list-bounces", "edgeId: e-{source}-{target}");

// --- SPECIES_PREFIXES: the single source ---
assert(
  SPECIES_PREFIXES.flow === "F-" &&
    SPECIES_PREFIXES.view === "V-" &&
    SPECIES_PREFIXES["data-model"] === "DM-" &&
    SPECIES_PREFIXES["api-endpoint"] === "API-",
  "SPECIES_PREFIXES: all four species map to their conventional prefixes",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} id-gen test(s) failed.`);
  process.exit(1);
}
console.log("\nAll id-gen tests passed.");

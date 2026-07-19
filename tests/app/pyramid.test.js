#!/usr/bin/env node

/**
 * Pyramid aggregation (lib/utils/pyramid.ts) — value element → per-platform
 * status distribution, grouped by tier, over the seeded acceptances.
 */

const fs = require("fs");
const path = require("path");
const { loadPyramid, BUILD_DIR } = require("./load-pyramid");

const { computePyramidAggregation } = loadPyramid();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const acceptances = bundle.nodes.filter((n) => n.species === "acceptance");

const tiers = computePyramidAggregation(acceptances);
assert(
  eq(tiers.map((t) => t.tier), ["functional", "emotional", "life-changing", "social-impact"]),
  "tiers come back in pyramid order",
);

const elementsById = new Map();
for (const tier of tiers) for (const element of tier.elements) elementsById.set(element.value, element);

assert(elementsById.size === 30, "every one of the 30 value elements is represented");

const designAesthetics = elementsById.get("design-aesthetics");
assert(designAesthetics.tier === "emotional", "design-aesthetics is emotional");
assert(designAesthetics.acceptanceCount === 2, `design-aesthetics counts its two acceptances (got ${designAesthetics.acceptanceCount})`);
assert(
  eq(designAesthetics.rollup.counts, { ios: { live: 2 }, android: { development: 1, live: 1 } }),
  "design-aesthetics distribution: ios live×2, android dev+live (web backlog uncounted)",
);

const funEntertainment = elementsById.get("fun-entertainment");
assert(funEntertainment.acceptanceCount === 1, "fun-entertainment counts one acceptance");

const savesTime = elementsById.get("saves-time");
assert(
  savesTime.acceptanceCount === 0 && eq(savesTime.rollup, { counts: {}, totals: {} }),
  "an unserved value element has zero acceptances and an empty rollup",
);

// Platform filter narrows the distribution but not the count.
const iosTiers = computePyramidAggregation(acceptances, "ios");
const iosDesign = iosTiers.flatMap((t) => t.elements).find((e) => e.value === "design-aesthetics");
assert(
  iosDesign.acceptanceCount === 2 && eq(iosDesign.rollup.counts, { ios: { live: 2 } }),
  "platform filter keeps only the ios distribution; count is platform-independent",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pyramid tests passed");

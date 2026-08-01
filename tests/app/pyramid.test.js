#!/usr/bin/env node

/**
 * Pyramid aggregation (lib/utils/pyramid.ts) — value element → per-platform
 * status distribution, grouped by tier, over the seeded acceptances. Also
 * covers lib/utils/platform-status.ts: per-platform and all-platform segment
 * building, and the display order shared by rings and bars.
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

// --- Display order (rings and bars) and the global all-platform segment sum ---

const {
  compareStatusesForDisplay,
  createEmptyRollup,
  addPlatformStatusToRollup,
  getPlatformRollupSegments,
  getRollupTotalSegments,
} = require(path.join(BUILD_DIR, "platform-status.js"));
const { getCountedStatuses, STATUS_ORDER } = require(path.join(BUILD_DIR, "config-statuses.js"));

assert(
  eq(
    [...getCountedStatuses()].sort(compareStatusesForDisplay),
    ["live", "releasing", "development", "prioritized", "blocked"],
  ),
  "display order is lifecycle-descending with blocked pinned last",
);
assert(
  STATUS_ORDER.blocked > STATUS_ORDER.live,
  "blocked outranks live in STATUS_ORDER, so pinning it last is real work, not a no-op",
);

let ringRollup = createEmptyRollup();
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "blocked");
ringRollup = addPlatformStatusToRollup(ringRollup, "ios", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "android", "development");

const totalSegments = getRollupTotalSegments(ringRollup);
assert(
  eq(totalSegments.map((s) => s.status), ["live", "releasing", "development", "prioritized", "blocked"]),
  "global segments come back in display order, one entry per counted status",
);

const totalByStatus = Object.fromEntries(totalSegments.map((s) => [s.status, s]));
assert(totalByStatus.live?.count === 3, `global ring sums live across platforms (got ${totalByStatus.live?.count})`);
assert(
  totalByStatus.development.count === 1 && totalByStatus.blocked.count === 1,
  "global ring sums the single-platform statuses too",
);
assert(
  totalSegments.reduce((sum, s) => sum + s.count, 0) === 5,
  "global counts equal the sum of the per-platform totals",
);
assert(
  totalByStatus.live.percentage === 60,
  `global percentages divide by the grand total, not one platform (got ${totalByStatus.live.percentage})`,
);
assert(
  totalByStatus.releasing.count === 0 && totalByStatus.releasing.ratio === 0,
  "an absent status is still present, with a zero count and ratio",
);
assert(
  totalSegments.every((s) => s.count === 0 || s.ratio > 0),
  "a nonzero count implies a nonzero ratio",
);

const webSegments = getPlatformRollupSegments(ringRollup, "web");
assert(
  eq(webSegments.map((s) => s.status), ["live", "releasing", "development", "prioritized", "blocked"]),
  "per-platform segments use the same display order as the global ring",
);
assert(
  webSegments.find((s) => s.status === "live")?.percentage === 67,
  "per-platform percentages divide by that platform's own total",
);

const emptySegments = getRollupTotalSegments(createEmptyRollup());
assert(
  emptySegments.length === 5 && emptySegments.every((s) => s.count === 0 && s.ratio === 0 && s.percentage === 0),
  "an empty rollup yields all-zero segments and never divides by zero",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pyramid tests passed");

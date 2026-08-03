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

const {
  computePyramidAggregation,
  computeScopedPyramidTiers,
  filterAcceptances,
  EMPTY_FILTERS,
  resolveProductScope,
} = loadPyramid();

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
  eq(designAesthetics.rollup.counts, { web: { backlog: 2 }, ios: { live: 2 }, android: { development: 1, live: 1 } }),
  "design-aesthetics distribution: web backlog×2 (backlog is counted now), ios live×2, android dev+live",
);

const funEntertainment = elementsById.get("fun-entertainment");
assert(funEntertainment.acceptanceCount === 1, "fun-entertainment counts one acceptance");

const savesTime = elementsById.get("saves-time");
assert(
  savesTime.acceptanceCount === 0 && eq(savesTime.rollup, { counts: {}, totals: {} }),
  "an unserved value element has zero acceptances and an empty rollup",
);

// Platform menu narrows the distribution but not the count.
const iosTiers = computePyramidAggregation(acceptances, { platforms: ["ios"] });
const iosDesign = iosTiers.flatMap((t) => t.elements).find((e) => e.value === "design-aesthetics");
assert(
  iosDesign.acceptanceCount === 2 && eq(iosDesign.rollup.counts, { ios: { live: 2 } }),
  "platform menu keeps only the ios distribution; count is platform-independent",
);

// --- The platform menu (product scope, § Decision 3) -------------------------
//
// A fixture of its own rather than the seed, so every platform carries more
// than one counted status: a menu that dropped a platform or a status could
// not hide behind a seed distribution that happens to be sparse there.

const menuAcceptances = [
  {
    id: "AC-shell", project_id: "p", species: "acceptance", title: "Shell polish", status: "live",
    platforms: ["web", "ios"], metadata: { values: ["design-aesthetics"] },
  },
  {
    id: "AC-motion", project_id: "p", species: "acceptance", title: "Motion pass", status: "backlog",
    platforms: ["web", "ios", "android"],
    metadata: {
      values: ["design-aesthetics"],
      platformStatuses: { web: "development", ios: "live", android: "development" },
    },
  },
];
const designOf = (tiers_) => tiers_.flatMap((t) => t.elements).find((e) => e.value === "design-aesthetics");

const everyPlatform = computePyramidAggregation(menuAcceptances);
assert(
  eq(designOf(everyPlatform).rollup.counts, {
    web: { live: 1, development: 1 },
    ios: { live: 2 },
    android: { development: 1 },
  }),
  "no menu counts every platform the acceptances carry",
);

const webOnly = computePyramidAggregation(menuAcceptances, { platforms: ["web"] });
assert(
  eq(designOf(webOnly).rollup.counts, { web: { live: 1, development: 1 } }),
  `a web-only menu counts web statuses and drops the ios and android ones (got ${JSON.stringify(designOf(webOnly).rollup.counts)})`,
);
assert(
  eq(designOf(webOnly).rollup.totals, { web: 2 }),
  `a web-only menu's totals follow its counts (got ${JSON.stringify(designOf(webOnly).rollup.totals)})`,
);

// The degenerate case, asserted rather than assumed: a project declaring no
// products resolves to the full menu, and must render exactly as today.
assert(
  eq(computePyramidAggregation(menuAcceptances, { platforms: ["web", "ios", "android"] }), everyPlatform),
  "the full menu is byte-identical to no menu at all (degenerate case)",
);
assert(
  eq(computePyramidAggregation(acceptances, { platforms: ["web", "ios", "android"] }), tiers),
  "the full menu is byte-identical to no menu at all over the seeded bundle too",
);

// `acceptanceCount` counts acceptances, not platform statuses, so no menu may
// move it — including the empty menu an arity-0 product (a CLI, a public API)
// resolves to.
const countsUnderMenus = [
  undefined,
  { platforms: ["web", "ios", "android"] },
  { platforms: ["web"] },
  { platforms: ["ios"] },
  { platforms: [] },
].map((options) => designOf(computePyramidAggregation(menuAcceptances, options)).acceptanceCount);
assert(
  countsUnderMenus.every((count) => count === 2),
  `acceptanceCount is 2 under every platform menu, empty included (got ${JSON.stringify(countsUnderMenus)})`,
);
assert(
  eq(designOf(computePyramidAggregation(menuAcceptances, { platforms: [] })).rollup, { counts: {}, totals: {} }),
  "an empty menu counts nothing rather than falling back to every platform",
);

// --- Product scope: the acceptances feeding the projection -------------------
//
// The surfaces narrow the acceptances with `filterAcceptances` before
// aggregating — product membership is an anchor-traversal question, not a value
// one — so this asserts the composition they perform, using both real functions.

const consoleView = { id: "V-console", project_id: "p", species: "view", title: "Console", status: "live", platforms: ["web"], metadata: { product: "admin" } };
const homeView = { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web", "ios", "android"], metadata: { product: "end-user" } };
// Its stored key names the *other* product, so "anchors win" is not vacuous here.
const accArchive = { id: "AC-archive", project_id: "p", species: "acceptance", title: "Bulk archive", status: "live", platforms: ["web"], metadata: { values: ["reduces-effort"], product: "end-user" } };
const accHome = { id: "AC-home", project_id: "p", species: "acceptance", title: "Home hero", status: "live", platforms: ["web", "ios", "android"], metadata: { values: ["reduces-effort"] } };
const scopeNodes = [consoleView, homeView, accArchive, accHome];
const scopeNodesById = new Map(scopeNodes.map((n) => [n.id, n]));
const scopeEdges = [
  { id: "e1", project_id: "p", source_id: "AC-archive", target_id: "V-console", edge_type: "covers" },
  { id: "e2", project_id: "p", source_id: "AC-home", target_id: "V-home", edge_type: "covers" },
];
const scopeAcceptances = [accArchive, accHome];

const effortOf = (tiers_) => tiers_.flatMap((t) => t.elements).find((e) => e.value === "reduces-effort");

/**
 * What the Pyramid page and the Overview's card both draw — the shared
 * composition itself, not a copy of it.
 */
function pyramidForScope(productId, platforms) {
  return effortOf(
    computeScopedPyramidTiers(scopeAcceptances, scopeEdges, scopeNodesById, { productId, platforms }),
  );
}

const allProducts = pyramidForScope(null, ["web", "ios", "android"]);
assert(
  allProducts.acceptanceCount === 2,
  `All products aggregates every acceptance (got ${allProducts.acceptanceCount})`,
);

const adminScoped = pyramidForScope("admin", ["web"]);
assert(
  adminScoped.acceptanceCount === 1 && eq(adminScoped.rollup.counts, { web: { live: 1 } }),
  `scoping to admin aggregates only admin's acceptances (got count ${adminScoped.acceptanceCount}, ${JSON.stringify(adminScoped.rollup.counts)})`,
);

const endUserScoped = pyramidForScope("end-user", ["web", "ios", "android"]);
assert(
  endUserScoped.acceptanceCount === 1 && endUserScoped.rollup.counts.ios !== undefined,
  `an acceptance anchored to an admin view is not in end-user, whatever its stored key says (got count ${endUserScoped.acceptanceCount})`,
);

// --- One pyramid, two surfaces (Overview ≡ Pyramid page) ---------------------
//
// The Overview's PyramidCard and the Pyramid page render the same projection for
// the same scope. Since Task 15 that is structural — both call
// `computeScopedPyramidTiers` — so what is worth asserting is that the shared
// function really performs *both* steps, and that the fixture can tell.

const scopeBundle = {
  project: {
    id: "P",
    title: "P",
    metadata: {
      products: [
        { id: "end-user", title: "End-user app", platforms: ["web", "ios", "android"] },
        { id: "admin", title: "Admin", platforms: ["web"] },
      ],
    },
  },
};
const adminScope = resolveProductScope(scopeBundle, "admin");

const sharedAdmin = computeScopedPyramidTiers(scopeAcceptances, scopeEdges, scopeNodesById, adminScope);
// The longhand, built from the same two real functions rather than paraphrased.
const longhandAdmin = computePyramidAggregation(
  filterAcceptances(scopeAcceptances, scopeEdges, scopeNodesById, {
    ...EMPTY_FILTERS,
    product: adminScope.productId,
  }),
  { platforms: adminScope.platforms },
);
assert(
  eq(sharedAdmin, longhandAdmin),
  "the shared composition is exactly filterAcceptances -> computePyramidAggregation(platforms)",
);

// The half-fix the Overview would plausibly have shipped: scope the platform
// menu, forget the acceptances. If this matched, the assertion above would be
// vacuous — so it is asserted NOT to.
const menuOnlyAdmin = computePyramidAggregation(scopeAcceptances, { platforms: adminScope.platforms });
assert(
  !eq(sharedAdmin, menuOnlyAdmin),
  "the fixture discriminates: scoping the platform menu alone gives a different pyramid",
);
assert(
  effortOf(sharedAdmin).acceptanceCount === 1 && effortOf(menuOnlyAdmin).acceptanceCount === 2,
  `and the difference is the acceptance count the two screens would have disagreed about (shared ${
    effortOf(sharedAdmin).acceptanceCount
  } vs menu-only ${effortOf(menuOnlyAdmin).acceptanceCount})`,
);

// The degenerate case over the real seed: no products declared, so the scoped
// composition must be byte-identical to today's bare aggregation.
const seedNodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
const noProductScope = resolveProductScope({ project: { id: "Q", title: "Q", metadata: {} } }, null);
assert(
  eq(computeScopedPyramidTiers(acceptances, bundle.edges, seedNodesById, noProductScope), tiers),
  "a project declaring no products composes byte-identical tiers to the unscoped aggregation, over the seed",
);

// --- Display order (rings and bars) and the global all-platform segment sum ---

const {
  compareStatusesForDisplay,
  createEmptyRollup,
  addPlatformStatusToRollup,
  getPlatformRollupSegments,
  getRollupTotalSegments,
} = require(path.join(BUILD_DIR, "platform-status.js"));
const { getCountedStatuses } = require(path.join(BUILD_DIR, "config-statuses.js"));

// The historical blocked-last pin is gone with the `blocked` status itself
// (now `metadata.blocked_by`): display order is pure lifecycle-descending.
assert(
  eq(
    [...getCountedStatuses()].sort(compareStatusesForDisplay),
    ["live", "releasing", "development", "backlog"],
  ),
  "display order is pure lifecycle-descending: Live → Releasing → Development → Backlog",
);

let ringRollup = createEmptyRollup();
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "backlog");
ringRollup = addPlatformStatusToRollup(ringRollup, "ios", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "android", "development");

const totalSegments = getRollupTotalSegments(ringRollup);
assert(
  eq(totalSegments.map((s) => s.status), ["live", "releasing", "development", "backlog"]),
  "global segments come back in display order, one entry per counted status",
);

const totalByStatus = Object.fromEntries(totalSegments.map((s) => [s.status, s]));
assert(totalByStatus.live?.count === 3, `global ring sums live across platforms (got ${totalByStatus.live?.count})`);
assert(
  totalByStatus.development?.count === 1 && totalByStatus.backlog?.count === 1,
  "global ring sums the single-platform statuses too",
);
assert(
  totalSegments.reduce((sum, s) => sum + s.count, 0) === 5,
  "global counts equal the sum of the per-platform totals",
);
assert(
  totalByStatus.live?.percentage === 60,
  `global percentages divide by the grand total, not one platform (got ${totalByStatus.live?.percentage})`,
);
assert(
  totalByStatus.releasing?.count === 0 && totalByStatus.releasing?.ratio === 0,
  "an absent status is still present, with a zero count and ratio",
);
assert(
  totalSegments.every((s) => s.count === 0 || s.ratio > 0),
  "a nonzero count implies a nonzero ratio",
);

const webSegments = getPlatformRollupSegments(ringRollup, "web");
assert(
  eq(webSegments.map((s) => s.status), ["live", "releasing", "development", "backlog"]),
  "per-platform segments use the same display order as the global ring",
);
assert(
  webSegments.find((s) => s.status === "live")?.percentage === 67,
  "per-platform percentages divide by that platform's own total",
);

const emptySegments = getRollupTotalSegments(createEmptyRollup());
assert(
  emptySegments.length === 4 && emptySegments.every((s) => s.count === 0 && s.ratio === 0 && s.percentage === 0),
  "an empty rollup yields all-zero segments and never divides by zero",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pyramid tests passed");

/**
 * The weighing projections (docs/rfcs/weighing.md): seeding, the level a cell
 * reads at, served and cost per promise, positioned variants, kept share,
 * per-element masses, the claim-versus-assessment flags and the guesswork
 * share. Pure and DB-free — runs in CI's fast `build` job.
 *
 * Run: npm run test:weighing-derive
 */

const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");
const { loadEffectiveStatus, BUILD_DIR: STATUS_BUILD_DIR } = require("../app/load-effective-status");

const {
  VALUE_CONTRIBUTION_SET,
  acceptanceFingerprint,
  seedLevelAt,
  claimedElements,
  seedAssessments,
  resolveCell,
  buildWeighingContext,
  weighPromise,
  keptShare,
  deriveWeighing,
  matrixSubjects,
  sortPromises,
  resolvePlatformStatus,
  SEED_SCORER_ID,
} = loadSchema();
const { getNodePlatformStatuses } = loadEffectiveStatus();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const human = { kind: "human", id: "alexis" };
const agent = { kind: "agent", id: "arkaik-mcp", model: "claude" };

const ac = (id, values, over = {}) => ({
  id,
  project_id: "p",
  species: "acceptance",
  title: `Promise ${id}`,
  status: "live",
  platforms: ["web"],
  metadata: { gherkin: `Given ${id}`, values },
  ...over,
});
const row = (node, criterion, level, over = {}) => ({
  matrix: "value",
  subject: node.id,
  criterion,
  level,
  scorer: human,
  confidence: 2,
  evidence: "because",
  basis: { fingerprint: acceptanceFingerprint(node), set_version: "1.0.0" },
  ts: "2026-11-15T10:00:00.000Z",
  ...over,
});
const set = VALUE_CONTRIBUTION_SET;

// --- Seeding ----------------------------------------------------------------

check("the first claimed value seeds +3, the second +2, every other +1", eq([0, 1, 2, 3, 9].map(seedLevelAt), [3, 2, 1, 1, 1]));
const four = ac("AC-four", ["connects", "reduces-anxiety", "informs", "organizes"]);
const seeds = seedAssessments(four, { id: "value" }, set);
check("a seed is made per claimed element, in claim order", eq(seeds.map((s) => s.criterion), ["connects", "reduces-anxiety", "informs", "organizes"]) && eq(seeds.map((s) => s.level), [3, 2, 1, 1]));
check("a seed is a rule at confidence 0", seeds.every((s) => s.scorer.kind === "rule" && s.scorer.id === SEED_SCORER_ID && s.confidence === 0));
check("a seed is never negative", seeds.every((s) => s.level > 0));
check("an unknown or repeated value is not seeded", eq(claimedElements(ac("AC-x", ["connects", "teleports", "connects"]), set), ["connects"]));
check("a promise that claims nothing seeds nothing", seedAssessments(ac("AC-none", []), { id: "value" }, set).length === 0);

// --- The level a cell reads at ----------------------------------------------

const node = ac("AC-a", ["connects"]);
const current = { fingerprint: acceptanceFingerprint(node), setVersion: "1.0.0" };
const seed = seedAssessments(node, { id: "value" }, set)[0];
const resolve = (stored, over = {}) => resolveCell("connects", stored, seed, over.current ?? current, true);

check("with nothing stored a cell reads its seed", resolve([]).source === "seed" && resolve([]).level === 3 && resolve([]).confidence === 0);
check("an unclaimed, unscored cell is blank", resolveCell("informs", [], undefined, current, false) === undefined);
check("an agent beats the seed", resolve([row(node, "connects", 1, { scorer: agent })]).level === 1);
check("a human beats an agent, even a newer one", resolve([row(node, "connects", 2), row(node, "connects", -1, { scorer: agent, ts: "2026-11-16T10:00:00.000Z" })]).level === 2);
check("the latest row wins within a kind", resolve([row(node, "connects", 1), row(node, "connects", 3, { ts: "2026-11-15T12:00:00.000Z" })]).level === 3);
check("a stored rule row is ignored — seeds are computed", resolve([row(node, "connects", -3, { scorer: { kind: "rule", id: "x" } })]).source === "seed");

const moved = { fingerprint: "fp1-other", setVersion: "1.0.0" };
const staleHuman = resolve([row(node, "connects", 2), row(node, "connects", 3, { scorer: agent })], { current: moved });
check("a moved subject marks the winner stale", staleHuman.stale === true);
check("…and staleness never changes the winner", staleHuman.level === 2 && staleHuman.scorer.kind === "human");
check("…the agent's level rides beside it", staleHuman.others.length === 1 && staleHuman.others[0].level === 3);
check("a new set major marks it stale", resolve([row(node, "connects", 2, { basis: { fingerprint: current.fingerprint, set_version: "0.9.0" } })]).stale === true);
check("a fresh row is not stale", resolve([row(node, "connects", 2)]).stale === false);
check("a row with no basis is never stale", resolve([row(node, "connects", 2, { basis: undefined })], { current: moved }).stale === false);
check("a human and an agent two levels apart go on the review list", resolve([row(node, "connects", 3), row(node, "connects", 1, { scorer: agent })]).review === true);
check("one level apart does not", resolve([row(node, "connects", 3), row(node, "connects", 2, { scorer: agent })]).review === false);

// --- One promise: served and cost, never netted -----------------------------

const consent = ac("AC-consent", ["reduces-risk", "reduces-anxiety"], { platforms: ["web", "ios", "android"], status: "development", metadata: { gherkin: "g", values: ["reduces-risk", "reduces-anxiety"], platformStatuses: { web: "live", ios: "releasing", android: "development" } } });
const section = {
  sets: [],
  matrices: [],
  assessments: [
    row(consent, "reduces-risk", 3),
    row(consent, "reduces-anxiety", 1),
    row(consent, "reduces-effort", -1, { scorer: agent, confidence: 1 }),
  ],
};
const ctx = buildWeighingContext(section);
const w = weighPromise(consent, ctx);
check("served is the sum of positive levels over 3", near(w.served, 4 / 3), String(w.served));
check("cost is the sum of |negative| levels over 3", near(w.cost, 1 / 3), String(w.cost));
check("served and cost are never netted", !near(w.served - w.cost, w.served) && w.cost > 0);
check("the claimed elements come first, in claim order, then the rest", eq(w.cells.map((c) => c.criterion), ["reduces-risk", "reduces-anxiety", "reduces-effort"]));
check("an unclaimed negative is flagged as an unclaimed cost", eq(w.flags.unclaimed_cost, ["reduces-effort"]));
check("a claim assessed at +3 is supported; one assessed at +1 is not (the consent page claims anxiety, delivers a touch)", eq(w.flags.claim_not_supported, ["reduces-anxiety"]) && w.flags.unclaimed_value.length === 0);
check("no positioning means no positioned variant", w.positioned === null);
check("kept share is live platforms over applicable ones", near(w.kept_share, 1 / 3), String(w.kept_share));
check("the fingerprint rides along", w.fingerprint === acceptanceFingerprint(consent));

const hollow = ac("AC-hollow", ["connects", "informs"]);
const hw = weighPromise(hollow, buildWeighingContext({ assessments: [row(hollow, "connects", 1), row(hollow, "organizes", 2)] }));
check("claimed but assessed at 1 or less: the claim is not supported", eq(hw.flags.claim_not_supported, ["connects"]));
check("not claimed but assessed at 1 or more: an unclaimed value", eq(hw.flags.unclaimed_value, ["organizes"]));
check("a claimed element nobody assessed is only seeded — no flag", !hw.flags.claim_not_supported.includes("informs") && hw.cells.find((c) => c.criterion === "informs").source === "seed");
const zeroed = weighPromise(hollow, buildWeighingContext({ assessments: [row(hollow, "connects", 0)] }));
check("a stored 0 suppresses the seed and flags the claim", zeroed.cells.find((c) => c.criterion === "connects").level === 0 && zeroed.flags.claim_not_supported.includes("connects"));

// --- Positioning ------------------------------------------------------------

const positioning = (status, criteria) => ({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", extends: "value-contribution@1", ...(status ? { status } : {}), criteria });
const stands = [{ id: "reduces-risk", weight: 3 }, { id: "reduces-effort" }];
const positioned = weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning("active", stands)] }));
check("an active positioning gives a positioned variant: only its elements, each times its weight", positioned.positioned && near(positioned.positioned.served, (3 / 3) * 3) && near(positioned.positioned.cost, (1 / 3) * 1), JSON.stringify(positioned.positioned));
check("a positioning with no status is active", weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning(undefined, stands)] })).positioned !== null);
const draft = buildWeighingContext({ ...section, sets: [positioning("draft", stands)] });
check("a draft positioning feeds no roll-up", weighPromise(consent, draft).positioned === null);
check("…but the context still knows it is there", draft.positioningSet !== undefined && draft.positioning === null);
check("a mistyped status counts as a draft too, so it feeds no roll-up", ["Draft", "archived", 5].every((status) => weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning(status, stands)] })).positioned === null));
check("rows a reader cannot address, or with a non-numeric level, are skipped and never throw", (() => {
  const junk = [null, 5, { matrix: "value" }, { ...row(hollow, "connects", 3), level: "3" }, { ...row(hollow, "connects", 3), scorer: undefined }, { ...row(hollow, "connects", 3), criterion: 7 }];
  const ctx = buildWeighingContext({ assessments: junk });
  return weighPromise(hollow, ctx).cells.every((cell) => cell.source === "seed");
})());
check("the plain served and cost do not depend on the positioning", near(positioned.served, w.served) && near(positioned.cost, w.cost));

// --- Kept share and the existing platform seam ------------------------------

check("a promise that applies nowhere has no kept share", keptShare(ac("AC-n", [], { platforms: [] })) === null);
check("every platform live is 1", keptShare(ac("AC-l", [], { platforms: ["web", "ios"] })) === 1);
check("nothing live is 0", keptShare(ac("AC-d", [], { status: "development" })) === 0);
const nodes3 = [consent, ac("AC-p", [], { platforms: ["web", "ios"], status: "backlog", metadata: { platformStatuses: { ios: "live" } } }), ac("AC-q", [], { platforms: ["android"], status: "releasing" })];
check(
  "the schema's platform resolution agrees with lib/utils/platform-status.ts getNodePlatformStatuses",
  nodes3.every((n) => {
    const app = getNodePlatformStatuses(n);
    return n.platforms.every((p) => app[p] === resolvePlatformStatus(n, p));
  }),
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(STATUS_BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-derive test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-derive tests passed.");

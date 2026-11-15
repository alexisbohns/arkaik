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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(STATUS_BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-derive test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-derive tests passed.");

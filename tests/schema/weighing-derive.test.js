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
check("served and cost are never netted: served is exactly 4/3, cost 1/3, and nothing reads their difference (1)", w.served === 4 / 3 && w.cost === 1 / 3 && [w.served, w.cost, w.kept_share, w.guesswork.served, w.guesswork.cost].every((x) => x !== 1) && w.positioned === null);
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

// --- The matrix: masses, archived, totals -----------------------------------

const a1 = ac("AC-1", ["connects", "reduces-anxiety"], { platforms: ["web", "ios"], metadata: { gherkin: "g1", values: ["connects", "reduces-anxiety"], platformStatuses: { web: "live", ios: "development" } } });
const a2 = ac("AC-2", ["connects"], { platforms: ["web"] });
const gone = ac("AC-gone", ["connects"], { status: "archived" });
const view = { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web"] };
const sec = { sets: [], matrices: [], assessments: [row(a1, "connects", 3), row(a1, "reduces-anxiety", -2)] };
const derived = deriveWeighing([a1, a2, gone, view], sec);
check("the matrix judges acceptances only", derived.promises.length === 3 && !derived.promises.some((p) => p.node_id === "V-home"));
check("matrixSubjects reads the matrix's query", matrixSubjects([a1, view], derived.matrix).length === 1);
check("every element of the set has a mass, zeros included", Object.keys(derived.elements).length === 30 && derived.elements.variety.promised === 0);
check("connects: promised = 3/3 (a1, human) + 3/3 (a2, seed) = 2", near(derived.elements.connects.promised, 2), String(derived.elements.connects.promised));
check("connects: kept = 1 × 1/2 (a1) + 1 × 1 (a2) = 1.5", near(derived.elements.connects.kept, 1.5), String(derived.elements.connects.kept));
check("reduces-anxiety carries a cost mass and no promised mass", near(derived.elements["reduces-anxiety"].cost, 2 / 3) && derived.elements["reduces-anxiety"].promised === 0);
check("an archived promise is weighed but counted nowhere", derived.totals.archived === 1 && near(derived.totals.promised, 2));
check("only a1 has a stored cell", derived.totals.assessed === 1);
check("connects: guesswork is the seeded share — a2's mass over the total", near(derived.elements.connects.guesswork.promised, 0.5), String(derived.elements.connects.guesswork.promised));
check("the total guesswork share is the same reading across elements", near(derived.totals.guesswork.promised, 0.5));
check("a promise built only from seeds is all guesswork", near(derived.promises.find((p) => p.node_id === "AC-2").guesswork.served, 1));
check("a human-scored promise at confidence 2 is no guesswork", near(derived.promises.find((p) => p.node_id === "AC-1").guesswork.served, 0));
check("an unknown matrix derives to nothing", deriveWeighing([a1], sec, "nope") === undefined);
check("a project with no section derives from seeds alone", deriveWeighing([a2], undefined).totals.guesswork.promised === 1);

const order = sortPromises(derived.promises, "served").map((p) => p.node_id);
check("promises sort by served, heaviest first, ties by title", order[0] === "AC-1" && order.length === 3);
check("promises sort by title A to Z", sortPromises(derived.promises, "title")[0].title === "Promise AC-1");
check("promises sort by cost, costliest first", sortPromises(derived.promises, "cost")[0].node_id === "AC-1");

// --- Review round: levels, confidence, positioning lookup, guesswork, drafts, flags ----

const lone = ac("AC-lone", ["connects"]);
const lrow = (criterion, level, over = {}) => row(lone, criterion, level, over);
const cellOf = (node, rows, criterion = "connects") => weighPromise(node, buildWeighingContext({ assessments: rows })).cells.find((c) => c.criterion === criterion);

check("a level above the scale is skipped — the cell reads its seed", cellOf(lone, [lrow("connects", 99)]).source === "seed");
check("a fractional level is skipped", cellOf(lone, [lrow("connects", 2.5)]).source === "seed");
check("a level below the scale is skipped", cellOf(lone, [lrow("connects", -4)]).source === "seed");
check("the scale's own ends are read", cellOf(lone, [lrow("connects", -3)]).level === -3 && cellOf(lone, [lrow("connects", 3)]).level === 3);
check("a skipped out-of-scale row does not shadow a good one", cellOf(lone, [lrow("connects", 2), lrow("connects", 99, { ts: "2026-11-16T10:00:00.000Z" })]).level === 2);

check("a confidence of \"0\" counts as a guess", weighPromise(lone, buildWeighingContext({ assessments: [lrow("connects", 3, { confidence: "0" })] })).guesswork.served === 1);
check("a confidence of 4 counts as a guess", weighPromise(lone, buildWeighingContext({ assessments: [lrow("connects", 3, { confidence: 4 })] })).guesswork.served === 1);
check("an unknown confidence reads as 0 on the cell too", cellOf(lone, [lrow("connects", 3, { confidence: 4 })]).confidence === 0);
check("a real confidence is kept", cellOf(lone, [lrow("connects", 3, { confidence: 3 })]).confidence === 3);

const bare = { id: "positioning", version: "1.0.0", scale: set.scale, criteria: [{ id: "connects", weight: 2 }] };
const bareCtx = buildWeighingContext({ sets: [bare], assessments: [lrow("connects", 3)] });
check("a set with the positioning id but no role is not applied", weighPromise(lone, bareCtx).positioned === null && bareCtx.positioningSet === undefined);
check("a set with the positioning role under another id is not the matrix's positioning", buildWeighingContext({ sets: [{ ...bare, id: "other", role: "positioning" }] }).positioningSet === undefined);

const weights = buildWeighingContext({ sets: [positioning("active", [{ id: "connects", weight: 0 }, { id: "informs", weight: Infinity }, { id: "informs", weight: 5 }, { id: "organizes", weight: -1 }, { id: "connects", weight: 4 }])] }).positioning.weights;
check("a weight of 0 means 0; a non-finite or negative weight reads as 1; the first duplicate wins", weights.get("connects") === 0 && weights.get("informs") === 1 && weights.get("organizes") === 1);

const wview = (status, criteria) => deriveWeighing([consent], { sets: [positioning(status, criteria)] });
const dupes = [{ id: "connects", weight: 0 }, { id: "informs" }, { id: "informs", weight: 5 }, { id: "organizes", weight: -1 }, { id: "connects", weight: 4 }];
check(
  "the view hands over the positioning's weights with the same rule as the roll-up: default 1, 0 is 0, the first duplicate wins",
  [wview("active", dupes), wview("draft", dupes)].every((v) => eq(Object.fromEntries(v.positioning.weights), { connects: 0, informs: 1, organizes: 1 })),
);
check("…for a draft too, which feeds no roll-up but is still shown", wview("draft", dupes).positioning.active === false);

// Guesswork on every number
const guessy = ac("AC-guessy", ["connects"], { platforms: ["web", "ios"], metadata: { gherkin: "g", values: ["connects"], platformStatuses: { web: "live", ios: "development" } } });
const guessSec = { sets: [positioning("active", [{ id: "connects", weight: 2 }, { id: "reduces-effort", weight: 3 }])], assessments: [row(guessy, "connects", 3, { confidence: 2 }), row(guessy, "reduces-effort", -3, { scorer: agent, confidence: 0 }), row(guessy, "reduces-anxiety", -3, { scorer: agent, confidence: 2 })] };
const gv = deriveWeighing([guessy], guessSec);
const gp = gv.promises[0];
check("a confidence-0 agent cost is a guess: half the cost rests on it", near(gp.cost, 2) && near(gp.guesswork.cost, 0.5) && gp.guesswork.served === 0, JSON.stringify(gp.guesswork));
check("positioned carries its own, weighted, guesswork share", near(gp.positioned.cost, 3) && near(gp.positioned.guesswork.cost, 1) && gp.positioned.guesswork.served === 0, JSON.stringify(gp.positioned));
check("an element says how much of its cost, promised and kept mass is a guess", near(gv.elements["reduces-effort"].guesswork.cost, 1) && near(gv.elements["reduces-anxiety"].guesswork.cost, 0) && gv.elements.connects.guesswork.promised === 0 && gv.elements.connects.guesswork.kept === 0);
check("the totals say it for promised, kept and cost", gv.totals.guesswork.promised === 0 && gv.totals.guesswork.kept === 0 && near(gv.totals.guesswork.cost, 0.5), JSON.stringify(gv.totals.guesswork));
const seededOnly = deriveWeighing([ac("AC-s", ["connects"], { platforms: ["web", "ios"], metadata: { gherkin: "g", values: ["connects"], platformStatuses: { web: "live" } } })], undefined);
check("a seeded promise's kept mass is all guesswork too", seededOnly.totals.guesswork.promised === 1 && seededOnly.totals.guesswork.kept === 1 && seededOnly.elements.connects.guesswork.kept === 1);

// Draft matrices feed no roll-up
const projectMatrix = (status) => ({ id: "m2", set: "value-contribution@1", subjects: { kind: "query", species: "acceptance" }, ...(status === undefined ? {} : { status }) });
check("a matrix with no status is active", deriveWeighing([a2], { matrices: [projectMatrix()] }, "m2") !== undefined);
check("a matrix with status active is active", deriveWeighing([a2], { matrices: [projectMatrix("active")] }, "m2") !== undefined);
check("a draft matrix derives to undefined", deriveWeighing([a2], { matrices: [projectMatrix("draft")] }, "m2") === undefined);
check("a mistyped matrix status is a draft too", ["Draft", "archived", 5].every((st) => deriveWeighing([a2], { matrices: [projectMatrix(st)] }, "m2") === undefined && buildWeighingContext({ matrices: [projectMatrix(st)] }, "m2") === undefined));

// The claim flags are a clean partition
const claims = ac("AC-claims", ["connects", "informs", "organizes", "reduces-risk", "variety"]);
const cw = weighPromise(claims, buildWeighingContext({
  assessments: [
    row(claims, "connects", -2),       // claimed, negative -> contradicted only
    row(claims, "informs", 0),         // claimed, 0 -> not supported
    row(claims, "organizes", 1),       // claimed, 1 -> not supported
    row(claims, "reduces-risk", 2),    // claimed, 2 -> holds, no flag
    row(claims, "variety", 3),         // claimed, 3 -> holds, no flag
    row(claims, "reduces-effort", 1),  // unclaimed +1 -> unclaimed value
    row(claims, "reduces-anxiety", -1, { scorer: agent }), // unclaimed negative -> unclaimed cost
    row(claims, "avoids-hassles", 0),  // unclaimed 0 -> nothing
  ],
}));
check("claim_not_supported: claimed and the stored winner is 0 or 1", eq(cw.flags.claim_not_supported, ["informs", "organizes"]), JSON.stringify(cw.flags));
check("claim_contradicted: claimed and the stored winner is negative — and only that flag", eq(cw.flags.claim_contradicted, ["connects"]) && !cw.flags.claim_not_supported.includes("connects") && !cw.flags.unclaimed_cost.includes("connects"));
check("unclaimed_value: not claimed and the stored winner is 1 or more", eq(cw.flags.unclaimed_value, ["reduces-effort"]));
check("unclaimed_cost: not claimed and the stored winner is negative", eq(cw.flags.unclaimed_cost, ["reduces-anxiety"]));
check("the four flags never overlap", (() => { const all = Object.values(cw.flags).flat(); return new Set(all).size === all.length; })());

// A promise that applies to no platform, through the whole derivation
const nowhere = ac("AC-nowhere", ["connects"], { platforms: [] });
const nv = deriveWeighing([nowhere], { assessments: [row(nowhere, "connects", 3)] });
check("a promise with no platform: promised is counted, kept is 0, kept_share is null", near(nv.elements.connects.promised, 1) && nv.elements.connects.kept === 0 && nv.promises[0].kept_share === null && nv.totals.kept === 0);

// --- Review round: quality -------------------------------------------------------

check("the seed scorer is frozen", Object.isFrozen(seed.scorer) && Object.isFrozen(weighPromise(lone, buildWeighingContext(undefined)).cells[0].scorer));

const tie = { ts: "2026-11-15T12:00:00.000Z" };
check("a ts tie goes to the later row", cellOf(lone, [lrow("connects", 1, tie), lrow("connects", 2, tie)]).level === 2 && cellOf(lone, [lrow("connects", 2, tie), lrow("connects", 1, tie)]).level === 1);
check("timestamps compare as times, not text: an offset still orders", cellOf(lone, [lrow("connects", 1, { ts: "2026-11-15T12:00:00.000+02:00" }), lrow("connects", 2, { ts: "2026-11-15T11:00:00.000Z" })]).level === 2);
check("an unparseable ts is the oldest, whatever its spelling", cellOf(lone, [lrow("connects", 3), lrow("connects", 1, { ts: "yesterday" })]).level === 3 && cellOf(lone, [lrow("connects", 1, { ts: "yesterday" }), lrow("connects", 3)]).level === 3);

const freshAgent = resolveCell("connects", [row(node, "connects", 2, { basis: { fingerprint: "fp1-old", set_version: "1.0.0" } }), row(node, "connects", 3, { scorer: agent })], seed, current, true);
check("a stale human beside a fresh agent: the human still wins, flagged, and the agent (current basis) rides beside it", freshAgent.level === 2 && freshAgent.stale === true && freshAgent.others[0].level === 3 && freshAgent.others[0].basis.fingerprint === current.fingerprint);
check("evidence is kept only when it is a string", resolve([row(node, "connects", 2, { evidence: 7 })]).evidence === undefined && resolve([row(node, "connects", 2, { evidence: "why" })]).evidence === "why");

const archivedNode = ac("AC-arch", ["connects"], { status: "archived", platforms: ["web", "ios"] });
const av = deriveWeighing([archivedNode, a2], { assessments: [row(archivedNode, "reduces-effort", -3), row(archivedNode, "connects", 3)] });
const ap = av.promises.find((p) => p.node_id === "AC-arch");
check("an archived promise keeps its cells and flags", ap.cells.length === 2 && eq(ap.flags.unclaimed_cost, ["reduces-effort"]) && near(ap.cost, 1));
check("…but is excluded from every mass and from the kept total", av.elements["reduces-effort"].cost === 0 && near(av.totals.cost, 0) && near(av.elements.connects.promised, 1) && near(av.elements.connects.kept, 1));
check("…and from the assessed count", av.totals.assessed === 0 && av.totals.archived === 1);

const driftNode = ac("AC-drift", ["connects", "informs"]);
const drift = weighPromise(driftNode, buildWeighingContext({ assessments: [
  row(driftNode, "connects", 3, { basis: { fingerprint: "fp1-old", set_version: "1.0.0" } }),
  row(driftNode, "informs", 3), row(driftNode, "informs", 0, { scorer: agent }),
] }));
check("the promise lists the stale elements", eq(drift.stale, ["connects"]));
check("the promise lists the elements a human and an agent disagree on", eq(drift.review, ["informs"]));

const listNodes = [ac("AC-l1", ["connects"]), ac("AC-l2", ["connects"]), ac("AC-l3", ["connects"])];
const listMatrix = { id: "m-list", set: "value-contribution@1", subjects: { kind: "list", items: [{ node_id: "AC-l1" }, { id: "AC-l2" }, { id: "AC-ghost" }] } };
check("a list matrix judges the nodes it names, by node_id or id", eq(deriveWeighing(listNodes, { matrices: [listMatrix] }, "m-list").promises.map((p) => p.node_id), ["AC-l1", "AC-l2"]));
check("a node repeated in the input is judged once, first wins", deriveWeighing([a2, { ...a2, title: "Again" }], undefined).promises.length === 1 && deriveWeighing([a2, { ...a2, title: "Again" }], undefined).promises[0].title === "Promise AC-2");

const nameless = { ...ac("AC-nameless", ["connects"]), title: undefined, platforms: undefined };
check("a node with no title or platforms derives and sorts without throwing", (() => {
  const v = deriveWeighing([nameless, a2], undefined);
  return v.promises.length === 2 && v.promises[0].kept_share === null && sortPromises(v.promises, "title").length === 2;
})());

const sevenNodes = Array.from({ length: 7 }, (_, i) => ac(`AC-f${i}`, ["connects"]));
const sevenRows = sevenNodes.map((n) => row(n, "connects", 1));
check("sums are of whole levels divided by 3 once, so seven +1 cells read exactly 7/3", deriveWeighing(sevenNodes, { assessments: sevenRows }).totals.promised === 7 / 3);

// Sorting: distinct values
const s1 = ac("AC-s1", ["informs", "connects", "organizes"]); // seeds 3,2,1
const s2 = ac("AC-s2", ["connects", "informs"]);              // seeds 3,2
const s3 = ac("AC-s3", ["connects"]);                         // seeds 3
const sortSec = { sets: [positioning("active", [{ id: "connects", weight: 1 }, { id: "informs", weight: 2 }])], assessments: [row(s3, "reduces-effort", -3), row(s2, "reduces-effort", -1)] };
const sv = deriveWeighing([s3, s2, s1], sortSec);
check("promises sort by served over distinct values: 2, 5/3, 1", eq(sortPromises(sv.promises, "served").map((p) => p.node_id), ["AC-s1", "AC-s2", "AC-s3"]) && near(sv.promises.find((p) => p.node_id === "AC-s1").served, 2));
check("promises sort by cost over distinct values: costliest first, then the rest by title", eq(sortPromises(sv.promises, "cost").map((p) => p.node_id), ["AC-s3", "AC-s2", "AC-s1"]));
check("promises sort by positioned over distinct values", eq(sortPromises(sv.promises, "positioned").map((p) => p.node_id), ["AC-s1", "AC-s2", "AC-s3"]));
check("a promise with no positioned figure sorts last on positioned", eq(sortPromises([{ node_id: "a", title: "A", served: 9, cost: 0, positioned: null }, { node_id: "b", title: "B", served: 0, cost: 0, positioned: { served: 0 } }], "positioned").map((p) => p.node_id), ["b", "a"]));
check("equal titles break by node id", eq(sortPromises([{ node_id: "z", title: "Same", served: 1, cost: 0, positioned: null }, { node_id: "y", title: "Same", served: 1, cost: 0, positioned: null }], "served").map((p) => p.node_id), ["y", "z"]));
check("a missing title sorts as empty", eq(sortPromises([{ node_id: "b", title: "B", served: 0, cost: 0, positioned: null }, { node_id: "a", served: 0, cost: 0, positioned: null }], "title").map((p) => p.node_id), ["a", "b"]));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(STATUS_BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-derive test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-derive tests passed.");

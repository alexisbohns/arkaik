#!/usr/bin/env node

/**
 * Stake evaluation (docs/rfcs/stake-architecture.md, part 4): a reference
 * declares the stake species it scores, assessments land on stakes through the
 * planner, the derivation and the validator, felt / matters / frequency live on
 * the stake, and a Kritik criterion's criticality is read, never copied.
 *
 * Run: npm run test:stake-evaluation
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const {
  VALUE_CONTRIBUTION_SET,
  VALUE_CONTRIBUTION_SET_V1,
  VALUE_MATRIX_ID,
  STAKE_MATRIX_ID,
  STAKE_FELT_IDS,
  STAKE_MATTERS_LEVELS,
  STAKE_FREQUENCY_IDS,
  STAKE_MATTERS_WORDING,
  USER_FACING_STAKE_SPECIES,
  QUALITY_STAKE_SPECIES,
  referenceForStakeSpecies,
  kritikCriticality,
  stakeSpeciesDeclaredBy,
  stakeFeltOf,
  stakeMattersOf,
  stakeFrequencyOf,
  stakeMetadataWith,
  acceptanceFingerprint,
  stakeFingerprint,
  fingerprintOf,
  planWeighingEvents,
  buildWeighingContext,
  weighPromise,
  deriveWeighing,
  resolveWeighing,
  isMatrixSubject,
  matrixSubjects,
  parseBundle,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` - ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- A reference declares its species ---------------------------------------

check("the current ruler declares the user-facing stakes", eq(stakeSpeciesDeclaredBy(VALUE_CONTRIBUTION_SET), ["bug", "friction", "need"]));
check("the declaration is the user-facing list, not a copy that can drift", eq(stakeSpeciesDeclaredBy(VALUE_CONTRIBUTION_SET), [...USER_FACING_STAKE_SPECIES]));
check("the frozen first ruler declares none", eq(stakeSpeciesDeclaredBy(VALUE_CONTRIBUTION_SET_V1), []));
check("a mistyped declaration reads as none, never throws", eq(stakeSpeciesDeclaredBy({ stake_species: "bug" }), []) && eq(stakeSpeciesDeclaredBy({}), []));
check("an unknown entry is dropped from a declaration", eq(stakeSpeciesDeclaredBy({ stake_species: ["bug", "wish", 3] }), ["bug"]));
check("the acceptance subject is untouched", VALUE_CONTRIBUTION_SET.subject === "acceptance");
check("the declaration does not move the set's version", VALUE_CONTRIBUTION_SET.version === "2.0.0");

for (const species of ["bug", "friction", "need"]) {
  check(`${species} is read on the value pyramid`, eq(referenceForStakeSpecies(species), { kind: "weighing-set", set: "value-contribution@2" }));
}
for (const species of ["requirement", "risk", "defect"]) {
  check(`${species} is read against Kritik`, eq(referenceForStakeSpecies(species), { kind: "kritik" }));
}

// --- The declaration never stales a cell -------------------------------------

check("an acceptance's fingerprint is the one it always was", acceptanceFingerprint({ title: "Accept an invite", metadata: { gherkin: "Given a link", values: ["connects"] } }) === "fp1-0867835158299c");
check("fingerprintOf an acceptance is acceptanceFingerprint", fingerprintOf({ species: "acceptance", title: "x", metadata: { values: ["connects"] } }) === acceptanceFingerprint({ title: "x", metadata: { values: ["connects"] } }));

const AC = { id: "AC-a", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { gherkin: "Given a link", values: ["connects"] } };
const stored = (over = {}) => ({
  matrix: "value",
  subject: "AC-a",
  criterion: "connects",
  level: 2,
  scorer: { kind: "human", id: "owner" },
  confidence: 2,
  evidence: "the title says so",
  basis: { fingerprint: "fp1-0867835158299c", set_version: "2.0.0" },
  ts: "2026-11-15T10:00:00.000Z",
  ...over,
});
const section = { sets: [], matrices: [], assessments: [stored()] };
const acceptanceView = deriveWeighing([AC], section, VALUE_MATRIX_ID);
const connects = acceptanceView.promises[0].cells.find((cell) => cell.criterion === "connects");
check("a cell scored before the declaration existed is fresh after it", connects.stale === false && connects.level === 2 && connects.source === "stored");
check("the value matrix still judges acceptances only", acceptanceView.promises.length === 1);

// --- Stakes: fingerprint -----------------------------------------------------

const need = (over = {}) => ({ id: "STK-slow", species: "stake", title: "Finding a pebble takes too long", status: "idea", platforms: [], metadata: { stake_species: "need", ...over } });
check("a stake's fingerprint is its own", stakeFingerprint(need()) !== acceptanceFingerprint(need()));
check("fingerprintOf a stake is stakeFingerprint", fingerprintOf(need()) === stakeFingerprint(need()));
check("the title moves a stake's fingerprint", stakeFingerprint(need()) !== stakeFingerprint({ ...need(), title: "Other" }));
check("the kind moves it: a rerouted stake is another thing to weigh", stakeFingerprint(need()) !== stakeFingerprint(need({ stake_species: "friction" })));
check("evidence does not: one more signal never stales a score", stakeFingerprint(need()) === stakeFingerprint(need({ evidence: [{ event_id: "e1" }] })));

// --- The planner -------------------------------------------------------------

const nodes = [
  AC,
  need(),
  { id: "STK-bug", species: "stake", title: "Crash on save", status: "idea", platforms: [], metadata: { stake_species: "bug" } },
  { id: "STK-req", species: "stake", title: "Never lose a pebble", status: "idea", platforms: [], metadata: { stake_species: "requirement" } },
  { id: "STK-risk", species: "stake", title: "Token leak", status: "idea", platforms: [], metadata: { stake_species: "risk" } },
  { id: "STK-blank", species: "stake", title: "No kind yet", status: "idea", platforms: [], metadata: {} },
];
const NOW = new Date("2026-11-22T10:00:00.000Z");
const ctx = { actor: "arkaik-app", scorerKind: "human", now: NOW };
const assess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "STK-slow", criterion: "saves-time", level: 2, confidence: 2, evidence: "people say it", ...over });
const plan = (entries) => planWeighingEvents(undefined, nodes, entries, ctx);

const planned = plan([assess()]);
check("an assessment on a need is planned", planned.ok === true, JSON.stringify(planned.refusals));
check("with no matrix named, a stake lands on the stake matrix", planned.ok && planned.assessments[0].matrix === STAKE_MATRIX_ID);
check("its basis carries the stake's own fingerprint", planned.ok && planned.assessments[0].basis.fingerprint === stakeFingerprint(nodes[1]));
check("an acceptance with no matrix named still lands on the value matrix", plan([assess({ subject: "AC-a", criterion: "connects" })]).assessments[0].matrix === VALUE_MATRIX_ID);
for (const subject of ["STK-slow", "STK-bug"]) {
  check(`${subject} is weighable`, plan([assess({ subject })]).ok === true);
}
for (const subject of ["STK-req", "STK-risk"]) {
  const refused = plan([assess({ subject })]);
  check(`${subject} is refused: Kritik reads it, the pyramid never does`, refused.ok === false && refused.refusals[0].reason === "unknown_subject" && /Kritik/.test(refused.refusals[0].detail), JSON.stringify(refused.refusals));
}
const blank = plan([assess({ subject: "STK-blank" })]);
check("a stake with no kind is refused, and the refusal says why", blank.ok === false && /no stake kind/.test(blank.refusals[0].detail));
check("a stake is not a subject of the value matrix", plan([assess({ matrix: "value" })]).ok === false);
check("an acceptance is not a subject of the stake matrix", plan([assess({ subject: "AC-a", criterion: "connects", matrix: "stakes" })]).ok === false);
const kritikCriterion = plan([assess({ criterion: "SAF-01" })]);
check("a Kritik criterion is never written into the weighing section", kritikCriterion.ok === false && kritikCriterion.refusals[0].reason === "unknown_criterion");

// --- The derivation ----------------------------------------------------------

const rows = planned.assessments;
const withRows = { sets: [], matrices: [], assessments: rows };
const ctxStakes = buildWeighingContext(withRows, STAKE_MATRIX_ID);
const weighed = weighPromise(nodes[1], ctxStakes);
check("a stake's score reads back", weighed.cells.length === 1 && weighed.cells[0].criterion === "saves-time" && weighed.cells[0].level === 2 && weighed.cells[0].source === "stored");
check("a stake is fresh against its own fingerprint", weighed.stale.length === 0);
const retitled = weighPromise({ ...nodes[1], title: "Something else" }, ctxStakes);
check("a stake whose title moved reads stale", eq(retitled.stale, ["saves-time"]));
check("a stake is never seeded: an unscored stake has no cells", weighPromise({ ...nodes[1], metadata: { stake_species: "need", values: ["saves-time"] } }, buildWeighingContext(undefined, STAKE_MATRIX_ID)).cells.length === 0);
check("a stake raises no claim flag (it claims nothing)", Object.values(weighed.flags).every((list) => list.length === 0));
check("a stake has no kept share (no platforms)", weighed.kept_share === null);

const view = deriveWeighing(nodes, withRows, STAKE_MATRIX_ID);
check("the stake matrix lists the stakes of declared species only", eq(view.promises.map((p) => p.node_id).sort(), ["STK-bug", "STK-slow"]));
check("…and never an acceptance or a requirement", !view.promises.some((p) => p.node_id === "AC-a" || p.node_id === "STK-req"));
check("a stake matrix has no positioning to re-weight it", view.positioning === null);
check("the matrix subjects follow the set's declaration", eq(matrixSubjects(nodes, resolveWeighing().matrices.find((m) => m.id === "stakes"), VALUE_CONTRIBUTION_SET).map((n) => n.id).sort(), ["STK-bug", "STK-slow"]));
check("isMatrixSubject: a stake of an undeclared kind is not one", isMatrixSubject(nodes[3], resolveWeighing().matrices.find((m) => m.id === "stakes"), VALUE_CONTRIBUTION_SET) === false);

// --- felt, matters, frequency ------------------------------------------------

check("felt has three kinds", eq([...STAKE_FELT_IDS], ["expected", "wanted", "delight"]));
check("matters is 1 to 4", eq([...STAKE_MATTERS_LEVELS], [1, 2, 3, 4]));
check("frequency has three bands", eq([...STAKE_FREQUENCY_IDS], ["rare", "some", "often"]));
check("every felt kind words all four tiers", STAKE_FELT_IDS.every((kind) => STAKE_MATTERS_LEVELS.every((level) => typeof STAKE_MATTERS_WORDING[kind].tiers[level].name === "string")));
const md = { felt: "wanted", matters: 3, frequency: "often" };
check("the readers read well-formed values", stakeFeltOf({ metadata: md }) === "wanted" && stakeMattersOf({ metadata: md }) === 3 && stakeFrequencyOf({ metadata: md }) === "often");
check("…and nothing from a malformed one", stakeFeltOf({ metadata: { felt: "meh" } }) === undefined && stakeMattersOf({ metadata: { matters: 5 } }) === undefined && stakeMattersOf({ metadata: { matters: "3" } }) === undefined && stakeFrequencyOf({ metadata: { frequency: "daily" } }) === undefined);
check("a write sets all three", eq(stakeMetadataWith({ stake_species: "need" }, { felt: "delight", matters: 4, frequency: "some" }), { stake_species: "need", felt: "delight", matters: 4, frequency: "some" }));
check("undefined clears one", !("matters" in stakeMetadataWith({ stake_species: "need", matters: 2 }, { matters: undefined })));
check("a bug is always expected", stakeMetadataWith({ stake_species: "bug" }, { felt: "wanted" }).felt === "expected");
check("…and a stake that becomes a bug is written as expected even with no felt stored", stakeMetadataWith({ stake_species: "need" }, { stake_species: "bug" }).felt === "expected");
check("moving a stake to a quality species drops all three", eq(stakeMetadataWith({ stake_species: "need", ...md }, { stake_species: "risk" }), { stake_species: "risk" }));
check("moving between user-facing species keeps them", stakeMetadataWith({ stake_species: "need", ...md }, { stake_species: "friction" }).matters === 3);

// --- Parse boundary and validator --------------------------------------------

const base = {
  schema_version: 2,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
};
const bundleWith = (metadata, extra = {}) => ({
  ...base,
  nodes: [...base.nodes, { id: "STK-a", project_id: "p", species: "stake", title: "A", status: "idea", platforms: [], metadata }],
  edges: [{ id: "e1", project_id: "p", source_id: "STK-a", target_id: "V-home", edge_type: "concerns" }],
  ...extra,
});
const rulesFor = (metadata, extra) => validateBundle(bundleWith(metadata, extra)).warnings.map((w) => w.rule);
check("a need with all three is clean", rulesFor({ stake_species: "need", ...md }).filter((r) => r.startsWith("stake-")).length === 0);
check("an unknown felt is a parse error", !parseBundle(bundleWith({ stake_species: "need", felt: "meh" })).success);
check("a matters of 5 is a parse error", !parseBundle(bundleWith({ stake_species: "need", matters: 5 })).success);
check("a frequency of daily is a parse error", !parseBundle(bundleWith({ stake_species: "need", frequency: "daily" })).success);
check("a valid trio parses", parseBundle(bundleWith({ stake_species: "need", ...md })).success);
check("a bug that is not expected warns", rulesFor({ stake_species: "bug", felt: "wanted" }).includes("stake-bug-felt"));
check("a bug that is expected does not", !rulesFor({ stake_species: "bug", felt: "expected", matters: 4, frequency: "rare" }).includes("stake-bug-felt"));
for (const species of QUALITY_STAKE_SPECIES) {
  check(`felt on a ${species} warns`, rulesFor({ stake_species: species, felt: "wanted" }).includes("stake-evaluation-quality-species"));
  check(`matters on a ${species} warns`, rulesFor({ stake_species: species, matters: 2 }).includes("stake-evaluation-quality-species"));
  check(`frequency on a ${species} warns`, rulesFor({ stake_species: species, frequency: "some" }).includes("stake-evaluation-quality-species"));
}
check("felt on a view warns as a wrong-species field", validateBundle({ ...base, nodes: [{ ...base.nodes[0], metadata: { felt: "wanted" } }] }).warnings.some((w) => w.rule === "stake-species-wrong-species"));
check("all of it is a warning, never an error", validateBundle(bundleWith({ stake_species: "risk", felt: "wanted", matters: 2, frequency: "some" })).valid);

const assessmentRow = (subject, over = {}) => ({ matrix: "stakes", subject, criterion: "saves-time", level: 2, scorer: { kind: "human", id: "o" }, confidence: 2, evidence: "x", basis: { fingerprint: "fp1-0", set_version: "2.0.0" }, ts: "2026-11-22T10:00:00.000Z", ...over });
const weighingFor = (subjectNode, assessments) => validateBundle({ ...bundleWith(subjectNode), weighing: { sets: [], matrices: [], assessments } }).warnings.map((w) => w.rule);
check("an assessment on a need is clean", !weighingFor({ stake_species: "need" }, [assessmentRow("STK-a")]).some((r) => r.startsWith("weighing")));
check("an assessment on a risk warns: the set does not declare it", weighingFor({ stake_species: "risk" }, [assessmentRow("STK-a")]).includes("weighing-subject-stake-species"));
check("an assessment on a stake with no kind warns", weighingFor({}, [assessmentRow("STK-a")]).includes("weighing-subject-stake-species"));
check("an assessment on a stake in the value matrix warns", weighingFor({ stake_species: "need" }, [assessmentRow("STK-a", { matrix: "value" })]).includes("weighing-subject-species"));
const setWith = (stake_species) => ({ id: "mine", version: "1.0.0", subject: "acceptance", stake_species, scale: VALUE_CONTRIBUTION_SET.scale, criteria: [] });
const setRules = (stake_species) => validateBundle({ ...base, weighing: { sets: [setWith(stake_species)], matrices: [], assessments: [] } }).warnings.map((w) => w.rule);
check("a set declaring known kinds is clean", !setRules(["bug", "need"]).includes("weighing-set-stake-species"));
check("a set declaring an unknown kind warns", setRules(["wish"]).includes("weighing-set-stake-species"));
check("a set whose declaration is not an array warns", setRules("bug").includes("weighing-set-stake-species"));
check("a set may declare nothing", !setRules(undefined).includes("weighing-set-stake-species"));

// --- Kritik criticality ------------------------------------------------------

const pack = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "packages", "kritik-library", "framework.json"), "utf8"));
const saf = pack.criteria.find((criterion) => criterion.id === "SAF-01");
const fromCriterion = kritikCriticality("SAF-01", pack);
check("criticality reads the criterion's default impact and weight", fromCriterion.impact === saf.default_impact && fromCriterion.weight === saf.weight && fromCriterion.source === "criterion");
check("…and its name", fromCriterion.name === saf.name);
check("…with no severity when no finding raised the stake", fromCriterion.severity === undefined);
const fromFinding = kritikCriticality("SAF-01", pack, { impact: 5, likelihood: 4 });
check("a finding that raised the stake adds its severity, and wins as the source", fromFinding.severity === "critical" && fromFinding.source === "finding" && fromFinding.impact === saf.default_impact);
check("a lower finding reads lower", kritikCriticality("SAF-01", pack, { impact: 2, likelihood: 1 }).severity === "low");
check("an unknown criterion reads unknown, never throws", eq(kritikCriticality("ZZZ-99", pack), { criterion_id: "ZZZ-99", source: "unknown" }));
check("no library reads unknown", eq(kritikCriticality("SAF-01", undefined), { criterion_id: "SAF-01", source: "unknown" }) && eq(kritikCriticality("SAF-01", null), { criterion_id: "SAF-01", source: "unknown" }));
const synthesized = { criteria: [{ id: "SAF-01", domain: "SAF", weight: 1 }], domains: [], version: "0" };
check("a synthesized library (no default impact) reads unknown, with no invented weight", eq(kritikCriticality("SAF-01", synthesized), { criterion_id: "SAF-01", source: "unknown" }));
check("a malformed finding is ignored, not trusted", kritikCriticality("SAF-01", pack, { impact: "high", likelihood: 2 }).source === "criterion");
check("nothing is copied onto the stake: the reading is a pure function of the library", !("criticality" in stakeMetadataWith({ stake_species: "risk", catalog: { source: "kritik", id: "SAF-01" } }, {})));

// --- No cross-kind arithmetic ------------------------------------------------

const exported = Object.keys(loadSchema()).filter((name) => /rank|combine|priority.?score|total.?matters/i.test(name) && /stake|matters|criticality/i.test(name));
check("no helper ranks across kinds", exported.length === 0, exported.join(", "));

if (failures > 0) {
  console.log(`\n${failures} stake evaluation test(s) failed.`);
  process.exit(1);
}
console.log("\nAll stake evaluation tests passed.");

/**
 * The weighing section's model (docs/rfcs/weighing.md): the built-in value
 * library, the fingerprint staleness reads, the zod shapes, and the validator's
 * warnings. Pure and DB-free — runs in CI's fast `build` job.
 *
 * Run: npm run test:weighing
 */

const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const {
  VALUE_IDS,
  VALUE_TIERS,
  VALUE_CONTRIBUTION_SET,
  VALUE_MATRIX,
  VALUE_SET_VERSION,
  POSITIONING_SET_ID,
  resolveWeighing,
  setOfRef,
  splitSetRef,
  majorOf,
  acceptanceFingerprint,
  cellKey,
  assessmentKey,
  scorerRank,
  upsertWeighingAssessment,
  sortWeighingAssessments,
  WeighingSectionSchema,
  AssessmentSchema,
  CriteriaSetSchema,
  ProjectBundleSchema,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- The built-in library ---------------------------------------------------

const set = VALUE_CONTRIBUTION_SET;
check("the value set has the 30 elements, in VALUE_IDS order", eq(set.criteria.map((c) => c.id), [...VALUE_IDS]));
check("every element sits in its tier", set.criteria.every((c) => c.group === VALUE_TIERS[c.id]));
check("the four tiers are the set's groups", eq(set.groups.map((g) => g.id), ["functional", "emotional", "life-changing", "social-impact"]));
check("the scale is signed −3..+3", set.scale.min === -3 && set.scale.max === 3);
check(
  "every level from −3 to +3 has an anchor",
  [-3, -2, -1, 0, 1, 2, 3].every((level) => typeof set.scale.anchors[String(level)] === "string" && set.scale.anchors[String(level)] !== ""),
);
check("every element has a name and a definition", set.criteria.every((c) => c.name && c.definition));
check("the set is pinned at 1.0.0", set.version === VALUE_SET_VERSION && VALUE_SET_VERSION === "1.0.0");
check("the built-in matrix judges every acceptance against value-contribution@1", VALUE_MATRIX.id === "value" && VALUE_MATRIX.set === "value-contribution@1" && VALUE_MATRIX.subjects.kind === "query" && VALUE_MATRIX.subjects.species === "acceptance");
check("the built-in matrix names the positioning set", VALUE_MATRIX.positioning === POSITIONING_SET_ID);

const resolved = resolveWeighing(undefined);
check("an absent section resolves to the built-ins alone", resolved.sets.length === 1 && resolved.matrices.length === 1);
check("a ref resolves to its set", setOfRef(resolved, "value-contribution@1")?.id === "value-contribution");
check("an unknown ref resolves to nothing", setOfRef(resolved, "nope@1") === undefined);
const withOwn = resolveWeighing({
  sets: [{ ...set, version: "9.0.0" }, { id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [] }],
  matrices: [],
});
check("a project cannot redefine a pinned set", withOwn.sets.find((s) => s.id === "value-contribution").version === "1.0.0");
check("the project's own sets are layered on", withOwn.sets.some((s) => s.id === "positioning"));
check("splitSetRef reads id and major", eq(splitSetRef("value-contribution@1"), { id: "value-contribution", major: "1" }) && splitSetRef("x").major === undefined);
check("majorOf reads a semver major", majorOf("1.4.2") === "1" && majorOf("2") === "2" && majorOf("beta") === undefined);

// --- Keys and ordering ------------------------------------------------------

const human = { kind: "human", id: "alexis" };
const agent = { kind: "agent", id: "arkaik-mcp" };
check("a human outranks an agent outranks a rule", scorerRank("human") > scorerRank("agent") && scorerRank("agent") > scorerRank("rule"));
check("a cell key is stable", cellKey("value", "AC-a", "connects") === cellKey("value", "AC-a", "connects"));
check(
  "a human and an agent have different assessment keys for one cell",
  assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects", scorer: human }) !==
    assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects", scorer: agent }),
);

const row = (over = {}) => ({ matrix: "value", subject: "AC-a", criterion: "connects", level: 2, scorer: human, confidence: 2, evidence: "the title says so", ts: "2026-11-15T10:00:00.000Z", ...over });
const first = upsertWeighingAssessment([], row());
check("upsert appends a new cell", first.assessments.length === 1 && first.replaced === undefined);
const second = upsertWeighingAssessment(first.assessments, row({ level: 3, ts: "2026-11-15T11:00:00.000Z" }));
check("upsert replaces the same cell and scorer kind in place", second.assessments.length === 1 && second.assessments[0].level === 3 && second.replaced.level === 2);
const third = upsertWeighingAssessment(second.assessments, row({ scorer: agent, level: -1 }));
check("an agent's row sits beside the human's, not over it", third.assessments.length === 2);
check("upsert does not mutate its input", first.assessments.length === 1 && first.assessments[0].level === 2);
const sorted = sortWeighingAssessments([row({ subject: "AC-b" }), row({ scorer: agent }), row()]);
check("a sidecar sorts by subject, then authority", sorted[0].subject === "AC-a" && sorted[0].scorer.kind === "human" && sorted[1].scorer.kind === "agent" && sorted[2].subject === "AC-b");

// --- The fingerprint --------------------------------------------------------

const ac = (over = {}) => ({
  id: "AC-a",
  title: "Accept an invite",
  status: "development",
  platforms: ["web"],
  metadata: { gherkin: "Given a link\nWhen I tap it\nThen we connect", values: ["connects", "reduces-anxiety"] },
  ...over,
});
const fp = acceptanceFingerprint(ac());
check("a fingerprint is a short stable string", /^fp1-[0-9a-f]{14}$/.test(fp) && fp === acceptanceFingerprint(ac()));
check("the status is NOT in the fingerprint", fp === acceptanceFingerprint(ac({ status: "live", platforms: ["web", "ios"] })));
check("the title is", fp !== acceptanceFingerprint(ac({ title: "Accept an invitation" })));
check("the Gherkin is", fp !== acceptanceFingerprint(ac({ metadata: { ...ac().metadata, gherkin: "Given a link\nWhen I tap it\nThen we are friends" } })));
check("the values are, and their order is", fp !== acceptanceFingerprint(ac({ metadata: { ...ac().metadata, values: ["reduces-anxiety", "connects"] } })));
check("whitespace is not", fp === acceptanceFingerprint(ac({ title: "  Accept   an invite ", metadata: { ...ac().metadata, gherkin: "Given a link When I tap it Then we connect" } })));
check("a node with no metadata still fingerprints", /^fp1-/.test(acceptanceFingerprint({ title: "x" })));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing tests passed.");

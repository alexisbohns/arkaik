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
  WeighingAssessmentSchema,
  WeighingCriteriaSetSchema,
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

// --- The zod shapes ---------------------------------------------------------

const section = { sets: [], matrices: [], assessments: [row()] };
check("a valid section parses", WeighingSectionSchema.safeParse(section).success);
check("a level of 3.5 is refused — no half points", !WeighingAssessmentSchema.safeParse(row({ level: 3.5 })).success);
check("a confidence of 4 is refused", !WeighingAssessmentSchema.safeParse(row({ confidence: 4 })).success);
check("a scorer is required", !WeighingAssessmentSchema.safeParse({ ...row(), scorer: undefined }).success);
check("an unknown scorer kind is refused", !WeighingAssessmentSchema.safeParse(row({ scorer: { kind: "robot", id: "x" } })).success);
check("unknown keys survive (a scorer's full distribution)", WeighingAssessmentSchema.parse(row({ distribution: [0.1, 0.9] })).distribution?.[1] === 0.9);
check("a scorer may say whom it acts for: an optional string that survives, and a number is refused", WeighingAssessmentSchema.parse(row({ scorer: { ...agent, on_behalf_of: "u_1842" } })).scorer.on_behalf_of === "u_1842" && WeighingAssessmentSchema.safeParse(row({ scorer: agent })).success && !WeighingAssessmentSchema.safeParse(row({ scorer: { ...agent, on_behalf_of: 42 } })).success);
check("a set parses with its own anchors and weight", WeighingCriteriaSetSchema.safeParse({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", status: "draft", extends: "value-contribution@1", criteria: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "Removes a worry the user names" } }] }).success);

const base = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "p", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { values: ["connects"] } }],
  edges: [],
};
check("a bundle with a weighing section parses", ProjectBundleSchema.safeParse({ ...base, weighing: section }).success);
check("a bundle without one still parses", ProjectBundleSchema.safeParse(base).success);
check("schema_version stays 3 — the section is additive", base.schema_version === 3);

// --- The validator ----------------------------------------------------------

const warningsFor = (weighing, extra = {}) => validateBundle({ ...base, weighing, ...extra }).warnings.map((w) => w.rule);
check("a clean section raises no weighing warning", warningsFor(section).filter((r) => r.startsWith("weighing")).length === 0);
check("an unknown criterion warns", warningsFor({ ...section, assessments: [row({ criterion: "teleports" })] }).includes("weighing-unknown-criterion"));
check("a level off the scale warns", warningsFor({ ...section, assessments: [row({ level: 4 })] }).includes("weighing-level-range"));
check("a stored rule seed warns", warningsFor({ ...section, assessments: [row({ scorer: { kind: "rule", id: "seed" }, confidence: 0, evidence: undefined })] }).includes("weighing-rule-stored"));
check("a missing scorer warns", warningsFor({ ...section, assessments: [{ ...row(), scorer: undefined }] }).includes("weighing-scorer-missing"));
check("an unknown subject warns", warningsFor({ ...section, assessments: [row({ subject: "AC-gone" })] }).includes("weighing-unknown-subject"));
check("a subject that is not an acceptance warns", warningsFor({ ...section, assessments: [row({ subject: "V-home" })] }, { nodes: [...base.nodes, { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web"] }] }).includes("weighing-subject-species"));
check("confidence 2 with no evidence warns", warningsFor({ ...section, assessments: [row({ evidence: undefined })] }).includes("weighing-no-evidence"));
check("confidence 0 with no evidence is fine", !warningsFor({ ...section, assessments: [row({ confidence: 0, evidence: undefined })] }).includes("weighing-no-evidence"));
check("two rows for one cell and kind warn", warningsFor({ ...section, assessments: [row(), row({ level: 1 })] }).includes("weighing-duplicate-assessment"));
check("a human and an agent row for one cell do not", !warningsFor({ ...section, assessments: [row(), row({ scorer: agent })] }).includes("weighing-duplicate-assessment"));
check("an unknown matrix warns", warningsFor({ ...section, assessments: [row({ matrix: "nope" })] }).includes("weighing-unknown-matrix"));
check("a set major bump warns", warningsFor({ ...section, assessments: [row({ basis: { set_version: "0.9.0" } })] }).includes("weighing-set-major"));
check("redefining a pinned set warns", warningsFor({ sets: [{ ...set, version: "9.0.0" }], matrices: [], assessments: [] }).includes("weighing-pinned-set-redefined"));
const positioning = (criteria) => ({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", extends: "value-contribution@1", criteria });
check("a positioning naming a non-element warns", warningsFor({ sets: [positioning([{ id: "teleports", weight: 2 }])], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-element"));
check("a positioning weight of 0 warns", warningsFor({ sets: [positioning([{ id: "connects", weight: 0 }])], matrices: [], assessments: [] }).includes("weighing-positioning-weight"));
check("a good positioning raises nothing", warningsFor({ sets: [positioning([{ id: "connects", weight: 3 }])], matrices: [], assessments: [] }).filter((r) => r.startsWith("weighing")).length === 0);
check(
  "a weighing event with no actor warns",
  warningsFor(undefined, { journal: [{ id: "01A", ts: "2026-11-15T10:00:00.000Z", type: "weighing.assessment.recorded", matrix: "value", subject: "AC-a", criterion: "connects", level: 2, confidence: 1, scorer: human }] }).includes("weighing-event-no-actor"),
);
check("none of this is an error — warnings never block an import", validateBundle({ ...base, weighing: { ...section, assessments: [row({ criterion: "teleports", level: 9 })] } }).valid === true);
check("a bundle with no weighing section raises no weighing finding", validateBundle(base).findings.every((f) => !f.rule.startsWith("weighing")));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing tests passed.");

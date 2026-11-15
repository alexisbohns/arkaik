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
  VALUE_CONTRIBUTION_SET_V1,
  VALUE_MATRIX,
  isOlderMajorRef,
  VALUE_SET_VERSION,
  POSITIONING_SET_ID,
  resolveWeighing,
  setOfRef,
  isActiveWeighingSet,
  isWeighingAssessmentShape,
  isWeighingMatrixShape,
  isWeighingSetShape,
  readWeighingAssessments,
  weighingScaleOf,
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
check(
  "the tiers hold 14, 10, 5 and 1 elements",
  eq(
    set.groups.map((g) => set.criteria.filter((c) => c.group === g.id).length),
    [14, 10, 5, 1],
  ),
);
check("the scale is signed −3..+3", set.scale.min === -3 && set.scale.max === 3);
check(
  "every level from −3 to +3 has an anchor",
  [-3, -2, -1, 0, 1, 2, 3].every((level) => typeof set.scale.anchors[String(level)] === "string" && set.scale.anchors[String(level)] !== ""),
);
check("every element has a name and a definition", set.criteria.every((c) => c.name && c.definition));
check("level 0 means weighed and unrelated, and says a missing row is unweighed", /weighed and found to have nothing to do with it/.test(set.scale.anchors["0"]) && /No row means nobody has weighed it yet/.test(set.scale.anchors["0"]));
check("the built-ins are deep-frozen — nobody can mutate the shared library", Object.isFrozen(set) && Object.isFrozen(set.criteria) && Object.isFrozen(set.criteria[0]) && Object.isFrozen(set.scale.anchors) && Object.isFrozen(VALUE_MATRIX) && Object.isFrozen(VALUE_MATRIX.subjects));
check("the set is pinned at 2.0.0 — the reach ruler", set.version === VALUE_SET_VERSION && VALUE_SET_VERSION === "2.0.0");
check(
  "every element carries its own reach ladder: every level but 0, in words",
  set.criteria.every((c) => [-3, -2, -1, 1, 2, 3].every((level) => typeof c.anchors?.[String(level)] === "string" && c.anchors[String(level)].trim() !== "") && c.anchors["0"] === undefined),
);
check("the scale's anchors speak of reach: +1 within the product, +2 the domain, +3 life-wide", /within the product/i.test(set.scale.anchors["1"]) && /domain/i.test(set.scale.anchors["2"]) && /life-wide/i.test(set.scale.anchors["3"]) && /life-wide/i.test(set.scale.anchors["-3"]));
check("the Informs ladder is the owner's wording, and it is asked as \"mainly\"", set.criteria.find((c) => c.id === "informs").anchors["2"] === "Informs the person about the service area or domain." && /mainly gives the person information/.test(set.criteria.find((c) => c.id === "informs").question));
check("the ladders are frozen with the set", Object.isFrozen(set.criteria[0].anchors));
check("the @1 ruler is kept, frozen, with its own centrality anchors and no ladders", VALUE_CONTRIBUTION_SET_V1.version === "1.0.0" && /^Core\./.test(VALUE_CONTRIBUTION_SET_V1.scale.anchors["3"]) && VALUE_CONTRIBUTION_SET_V1.criteria.every((c) => c.anchors === undefined) && Object.isFrozen(VALUE_CONTRIBUTION_SET_V1));
check("the built-in matrix judges every acceptance against value-contribution@2", VALUE_MATRIX.id === "value" && VALUE_MATRIX.set === "value-contribution@2" && VALUE_MATRIX.subjects.kind === "query" && VALUE_MATRIX.subjects.species === "acceptance");
check("the built-in matrix names the positioning set", VALUE_MATRIX.positioning === POSITIONING_SET_ID);

const resolved = resolveWeighing(undefined);
check("an absent section resolves to the built-ins alone: both majors of the ruler, one matrix", eq(resolved.sets.map((s) => s.version), ["2.0.0", "1.0.0"]) && resolved.matrices.length === 1);
check("a ref resolves to its set", setOfRef(resolved, "value-contribution@2")?.id === "value-contribution");
check("an unknown ref resolves to nothing", setOfRef(resolved, "nope@1") === undefined);
check("a ref picks its major among those the library holds", setOfRef(resolved, "value-contribution@2")?.version === "2.0.0" && setOfRef(resolved, "value-contribution@1")?.version === "1.0.0");
check("a ref at a major nobody holds resolves to nothing — levels are comparable only within a major", setOfRef(resolved, "value-contribution@3") === undefined);
check("a ref with no major names the current one", setOfRef(resolved, "value-contribution")?.version === "2.0.0");
check("@1 is an older major of the ruler; @2, an unknown set and a ref with no major are not", isOlderMajorRef(resolved, "value-contribution@1") && !isOlderMajorRef(resolved, "value-contribution@2") && !isOlderMajorRef(resolved, "nope@1") && !isOlderMajorRef(resolved, "value-contribution"));
const withOwn = resolveWeighing({
  sets: [{ ...set, version: "9.0.0" }, { id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [] }],
  matrices: [],
});
check("a project cannot redefine a pinned set", eq(withOwn.sets.filter((s) => s.id === "value-contribution").map((s) => s.version), ["2.0.0", "1.0.0"]));
check("the project's own sets are layered on", withOwn.sets.some((s) => s.id === "positioning"));
const matrixOf = (...extra) => resolveWeighing({ sets: [], matrices: extra }).matrices.map((m) => m.id);
check("a matrix with only an id is skipped, not thrown on", eq(matrixOf({ id: "m" }), ["value"]));
check("a matrix with no subjects is skipped", eq(matrixOf({ id: "m", set: "value-contribution@2" }), ["value"]));
check("a well-formed matrix is layered on", eq(matrixOf({ id: "m", set: "value-contribution@2", subjects: { kind: "query", species: "acceptance" } }), ["value", "m"]));
check("a set with no criteria or no scale is skipped", resolveWeighing({ sets: [{ id: "s" }, { id: "t", scale: set.scale }, { id: "u", criteria: [] }], matrices: [] }).sets.length === 2);
check("a later well-formed duplicate beats an earlier malformed one", resolveWeighing({ sets: [{ id: "s" }, { id: "s", version: "1.0.0", scale: set.scale, criteria: [] }], matrices: [] }).sets.some((s) => s.id === "s"));
check(
  "a garbage section never throws, from the resolver or the validator",
  [
    { sets: [null, 5, "x", [], {}, { id: 3 }], matrices: [null, [], "m", { id: "m" }, { id: "m", set: 4, subjects: 5 }], assessments: [null, 7, "a", [], {}, { scorer: null, level: "2", confidence: {} }, { matrix: 1, subject: 2, criterion: 3, scorer: 4 }] },
    { sets: "x", matrices: null, assessments: {} },
    { sets: [{ id: "positioning", role: "positioning", criteria: [null, 3, { id: null }], scale: null }] },
    "not an object",
    [],
    null,
  ].every((garbage) => {
    try {
      resolveWeighing(garbage);
      validateBundle({ schema_version: 3, project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }, nodes: [], edges: [], weighing: garbage });
      sortWeighingAssessments(Array.isArray(garbage?.assessments) ? garbage.assessments.filter((a) => typeof a === "object" && a !== null) : []);
      return true;
    } catch (error) {
      console.log(`  threw on ${JSON.stringify(garbage)}: ${error.message}`);
      return false;
    }
  }),
);
check("splitSetRef reads id and major", eq(splitSetRef("value-contribution@2"), { id: "value-contribution", major: "2" }) && splitSetRef("x").major === undefined);
check("majorOf reads a semver major", majorOf("1.4.2") === "1" && majorOf("2") === "2" && majorOf("beta") === undefined);

// --- Keys and ordering ------------------------------------------------------

const human = { kind: "human", id: "alexis" };
const agent = { kind: "agent", id: "arkaik-mcp" };
check("a human outranks an agent outranks a rule", scorerRank("human") > scorerRank("agent") && scorerRank("agent") > scorerRank("rule"));
check("an unknown scorer kind ranks below a rule, and so does no kind at all", scorerRank("robot") === 0 && scorerRank("robot") < scorerRank("rule") && scorerRank(undefined) === 0);
check("a row with no scorer still has a key and a place in a sorted sidecar", typeof assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects" }) === "string" && sortWeighingAssessments([{ matrix: "value", subject: "AC-a", criterion: "connects" }, { matrix: "value", subject: "AC-a", criterion: "connects", scorer: { kind: "human", id: "a" } }])[0].scorer?.kind === "human");
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
// Import never blocks: every judgement about a value is the validator's, and a bad cell only warns.
// (Each of these is checked against the validator's warning in the section below.)
check("a level of 3.5 parses — the validator warns, the import does not fail", WeighingAssessmentSchema.safeParse(row({ level: 3.5 })).success);
check("a confidence of 4 parses", WeighingAssessmentSchema.safeParse(row({ confidence: 4 })).success);
check("a missing scorer parses", WeighingAssessmentSchema.safeParse({ ...row(), scorer: undefined }).success);
check("an unknown scorer kind parses", WeighingAssessmentSchema.safeParse(row({ scorer: { kind: "robot", id: "x" } })).success);
check("a scorer with no id parses", WeighingAssessmentSchema.safeParse(row({ scorer: { kind: "agent" } })).success);
check("a row that cannot be addressed still parses — readers skip it, the validator warns", WeighingAssessmentSchema.safeParse({ ...row(), criterion: undefined }).success && WeighingAssessmentSchema.safeParse({ ...row(), subject: 7 }).success && WeighingAssessmentSchema.safeParse({ ...row(), ts: undefined }).success);
check("a partial section parses: each list is optional and a reader treats it as empty", WeighingSectionSchema.safeParse({}).success && WeighingSectionSchema.safeParse({ assessments: [row()] }).success && WeighingSectionSchema.safeParse({ sets: [] }).success);
check("a matrix with no set or subjects, and a set with no scale or criteria, parse", WeighingSectionSchema.safeParse({ matrices: [{ id: "m" }], sets: [{ id: "s", version: "1.0.0", subject: "acceptance" }] }).success);
check("unknown keys survive (a scorer's full distribution)", WeighingAssessmentSchema.parse(row({ distribution: [0.1, 0.9] })).distribution?.[1] === 0.9);
check("a scorer may say whom it acts for: an optional string that survives, and a number still parses", WeighingAssessmentSchema.parse(row({ scorer: { ...agent, on_behalf_of: "u_1842" } })).scorer.on_behalf_of === "u_1842" && WeighingAssessmentSchema.safeParse(row({ scorer: agent })).success && WeighingAssessmentSchema.safeParse(row({ scorer: { ...agent, on_behalf_of: 42 } })).success);
check("a set parses with its own anchors and weight", WeighingCriteriaSetSchema.safeParse({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", status: "draft", extends: "value-contribution@2", criteria: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "Removes a worry the user names" } }] }).success);

const base = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "p", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { values: ["connects"] } }],
  edges: [],
};
check("a bundle with a weighing section parses", ProjectBundleSchema.safeParse({ ...base, weighing: section }).success);
check("a bundle without one still parses", ProjectBundleSchema.safeParse(base).success);
check("a bundle carrying a bad cell still imports (zod) — and validates, with warnings", ProjectBundleSchema.safeParse({ ...base, weighing: { assessments: [row({ level: 3.5, confidence: 4, scorer: undefined })] } }).success);

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
const positioning = (criteria) => ({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", extends: "value-contribution@2", criteria });
check("a positioning naming a non-element warns", warningsFor({ sets: [positioning([{ id: "teleports", weight: 2 }])], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-element"));
check("a positioning weight of 0 warns", warningsFor({ sets: [positioning([{ id: "connects", weight: 0 }])], matrices: [], assessments: [] }).includes("weighing-positioning-weight"));
check("a good positioning raises nothing", warningsFor({ sets: [positioning([{ id: "connects", weight: 3 }])], matrices: [], assessments: [] }).filter((r) => r.startsWith("weighing")).length === 0);
const rulesOf = (weighing) => warningsFor(weighing).filter((r) => r.startsWith("weighing"));
check("a level of 3.5 warns", warningsFor({ ...section, assessments: [row({ level: 3.5 })] }).includes("weighing-level-range"));
check("a confidence of 4 warns", warningsFor({ ...section, assessments: [row({ confidence: 4 })] }).includes("weighing-confidence-range"));
check("a scorer with no id warns as a missing scorer", warningsFor({ ...section, assessments: [row({ scorer: { kind: "agent" } })] }).includes("weighing-scorer-missing"));
check(
  "an unknown scorer kind warns as itself, not as a stored rule",
  (() => {
    const rules = warningsFor({ ...section, assessments: [row({ scorer: { kind: "robot", id: "x" } })] });
    return rules.includes("weighing-scorer-kind") && !rules.includes("weighing-rule-stored");
  })(),
);
check("a partial section raises nothing", rulesOf({ assessments: [] }).length === 0 && rulesOf({}).length === 0 && rulesOf({ sets: [] }).length === 0);

const own = (over = {}) => ({ id: "rubric", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [{ id: "old", superseded_by: "new" }, { id: "new" }], ...over });
const ownMatrix = (over = {}) => ({ id: "m", set: "rubric@1", subjects: { kind: "query", species: "acceptance" }, ...over });
check("a duplicate set id warns", warningsFor({ sets: [own(), own()], matrices: [], assessments: [] }).includes("weighing-duplicate-set"));
check("a set with a criterion list and a scale is not a shape problem", !rulesOf({ sets: [own()], matrices: [], assessments: [] }).includes("weighing-set-shape"));
check("a set with no criteria or scale warns", warningsFor({ sets: [{ id: "s" }], matrices: [], assessments: [] }).includes("weighing-set-shape") && warningsFor({ sets: [own({ scale: undefined })], matrices: [], assessments: [] }).includes("weighing-set-shape"));
check("redefining the built-in matrix warns", warningsFor({ sets: [], matrices: [ownMatrix({ id: "value", set: "value-contribution@2" })], assessments: [] }).includes("weighing-pinned-matrix-redefined"));
check("a duplicate matrix id warns", warningsFor({ sets: [own()], matrices: [ownMatrix(), ownMatrix()], assessments: [] }).includes("weighing-duplicate-matrix"));
check("a matrix naming a set nothing defines warns", warningsFor({ sets: [], matrices: [ownMatrix()], assessments: [] }).includes("weighing-unknown-set"));
check("a matrix naming a defined set is clean", rulesOf({ sets: [own()], matrices: [ownMatrix()], assessments: [] }).length === 0);
check("a matrix with only an id warns, and so does one with no subjects", warningsFor({ sets: [], matrices: [{ id: "m" }], assessments: [] }).includes("weighing-matrix-shape") && warningsFor({ sets: [], matrices: [{ id: "m", set: "value-contribution@2" }], assessments: [] }).includes("weighing-matrix-shape"));
check("a matrix naming another major of a set warns as a major, not as unknown", (() => {
  const rules = warningsFor({ sets: [], matrices: [ownMatrix({ set: "value-contribution@3" })], assessments: [] });
  return rules.includes("weighing-set-ref-major") && !rules.includes("weighing-unknown-set");
})());
check("an assessment on a retired criterion warns", warningsFor({ sets: [own()], matrices: [ownMatrix()], assessments: [row({ matrix: "m", criterion: "old" })] }).includes("weighing-retired-criterion"));
check("an assessment on its replacement does not", !warningsFor({ sets: [own()], matrices: [ownMatrix()], assessments: [row({ matrix: "m", criterion: "new" })] }).includes("weighing-retired-criterion"));

const positioningOf = (over) => ({ ...positioning([{ id: "connects", weight: 3 }]), ...over });
check("a positioning under another id warns — it would never be applied", warningsFor({ sets: [positioningOf({ id: "positioning-pebbles" })], matrices: [], assessments: [] }).includes("weighing-positioning-id"));
check("a set called positioning with no role warns", warningsFor({ sets: [positioningOf({ role: undefined })], matrices: [], assessments: [] }).includes("weighing-positioning-id"));
check("a positioning with no extends warns", warningsFor({ sets: [positioningOf({ extends: undefined })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending nothing known warns", warningsFor({ sets: [positioningOf({ extends: "nope@1" })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending itself warns", warningsFor({ sets: [positioningOf({ extends: "positioning@1" })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending another major warns as a major", (() => {
  const rules = warningsFor({ sets: [positioningOf({ extends: "value-contribution@7" })], matrices: [], assessments: [] });
  return rules.includes("weighing-set-ref-major") && !rules.includes("weighing-positioning-unknown-ruler");
})());
check("a positioning that names its ruler right is clean", rulesOf({ sets: [positioningOf({})], matrices: [], assessments: [] }).length === 0);
check("a positioning on the older ruler still applies, and says to re-save it", (() => {
  const rules = rulesOf({ sets: [positioningOf({ extends: "value-contribution@1" })], matrices: [], assessments: [] });
  return eq(rules, ["weighing-positioning-old-ruler"]);
})());
check("a probability off 0..1, or not a number, warns — and one in range does not", (() => {
  const bad = rulesOf({ ...section, assessments: [row({ p_serves: 1.2, p_costs: "high" })] }).filter((r) => r === "weighing-probability-shape").length;
  const fine = rulesOf({ ...section, assessments: [row({ p_serves: 0.9, p_costs: 0 })] }).includes("weighing-probability-shape");
  return bad === 2 && !fine;
})());
check(
  "a weighing event with no actor warns",
  warningsFor(undefined, { journal: [{ id: "01A", ts: "2026-11-15T10:00:00.000Z", type: "weighing.assessment.recorded", matrix: "value", subject: "AC-a", criterion: "connects", level: 2, confidence: 1, scorer: human }] }).includes("weighing-event-no-actor"),
);

// --- Import never blocks: every probe case parses AND warns ------------------

const good = { matrix: "value", subject: "AC-a", criterion: "connects", level: 1, scorer: { kind: "human", id: "x" }, confidence: 1, ts: "2026-11-15T10:00:00.000Z" };
const pos = { id: "positioning", version: "1.0.0", subject: "acceptance", role: "positioning", extends: "value-contribution@2", criteria: [{ id: "connects", weight: 2 }] };
const asRow = (over) => ({ sets: [], matrices: [], assessments: [{ ...good, ...over }] });
const asPos = (over) => ({ sets: [{ ...pos, ...over }], matrices: [], assessments: [] });
const mat = (subjects) => ({ sets: [], matrices: [{ id: "m", set: "value-contribution@2", subjects }], assessments: [] });
const bad = [
  ["an assessment with no ts", asRow({ ts: undefined }), "weighing-assessment-ts"],
  ["an assessment with an invalid ts", asRow({ ts: "yesterday" }), "weighing-assessment-ts"],
  ["an assessment with no criterion", asRow({ criterion: undefined }), "weighing-assessment-shape"],
  ["an assessment with a numeric subject", asRow({ subject: 7 }), "weighing-assessment-shape"],
  ["a string level", asRow({ level: "2" }), "weighing-level-range"],
  ["a null level", asRow({ level: null }), "weighing-level-range"],
  ["a string confidence", asRow({ confidence: "high" }), "weighing-confidence-range"],
  ["a scorer that is a string", asRow({ scorer: "alexis" }), "weighing-scorer-missing"],
  ["a scorer with no kind", asRow({ scorer: { id: "x" } }), "weighing-scorer-missing"],
  ["a numeric evidence", asRow({ evidence: 3 }), "weighing-evidence-type"],
  ["refs that is a string", asRow({ refs: "AC-b" }), "weighing-refs-type"],
  ["a numeric set_version", asRow({ basis: { set_version: 1 } }), "weighing-basis-shape"],
  ["a null assessment row", { sets: [], matrices: [], assessments: [null] }, "weighing-assessment-shape"],
  ["a number among the assessments", { sets: [], matrices: [], assessments: [good, 5] }, "weighing-assessment-shape"],
  ["a null set", { sets: [null], matrices: [], assessments: [] }, "weighing-set-shape"],
  ["a null matrix", { sets: [], matrices: [null], assessments: [] }, "weighing-matrix-shape"],
  ["a set with no id", { sets: [{ version: "1.0.0", scale: set.scale, criteria: [] }], matrices: [], assessments: [] }, "weighing-set-shape"],
  ["a positioning with no version", asPos({ version: undefined }), "weighing-set-shape"],
  ["a positioning weight that is a string", asPos({ criteria: [{ id: "connects", weight: "2" }] }), "weighing-positioning-weight"],
  ["a positioning anchor that is a number", asPos({ criteria: [{ id: "connects", anchors: { 3: 3 } }] }), "weighing-criterion-shape"],
  ["a positioning criterion with no id", asPos({ criteria: [{ weight: 2 }] }), "weighing-criterion-shape"],
  ["a null positioning criterion", asPos({ criteria: [null] }), "weighing-criterion-shape"],
  ["a status of Draft", asPos({ status: "Draft" }), "weighing-set-status"],
  ["a mistyped role", asPos({ role: "Positioning" }), "weighing-positioning-id"],
  ["a numeric role", asPos({ role: 5 }), "weighing-positioning-id"],
  ["a scale with no anchors", asPos({ scale: { min: -3, max: 3 } }), "weighing-scale-shape"],
  ["a matrix whose subjects kind is a tag", mat({ kind: "tag" }), "weighing-matrix-shape"],
  ["a matrix whose subjects is empty", mat({}), "weighing-matrix-shape"],
  ["a matrix with a numeric status", { sets: [], matrices: [{ id: "m", set: "value-contribution@2", subjects: { kind: "query", species: "acceptance" }, status: 5 }], assessments: [] }, "weighing-set-status"],
];
for (const [name, weighing, rule] of bad) {
  const parsed = ProjectBundleSchema.safeParse({ ...base, weighing }).success;
  let rules = [];
  let threw = "";
  try {
    rules = warningsFor(weighing);
  } catch (error) {
    threw = error.message;
  }
  check(`${name} imports and warns ${rule}`, parsed && threw === "" && rules.includes(rule), `parsed=${parsed} threw=${threw} rules=${rules.filter((r) => r.startsWith("weighing")).join(",")}`);
}
check("only the containers block: a section that is not an object, or a list that is not an array", !ProjectBundleSchema.safeParse({ ...base, weighing: "x" }).success && !ProjectBundleSchema.safeParse({ ...base, weighing: { sets: "x" } }).success);
check("…and the validator still says so, without throwing", warningsFor("x").includes("weighing-section-shape") && warningsFor({ sets: "x" }).includes("weighing-section-shape"));
check("a bad row survives a parse round trip untouched", (() => {
  const weighing = { sets: [], matrices: [], assessments: [{ ...good, level: "2", confidence: { a: 1 }, scorer: "alexis", extra: [1, 2] }, null, 5] };
  return eq(ProjectBundleSchema.parse({ ...base, weighing }).weighing, weighing);
})());
check("a clean assessment with a valid ts raises no assessment warning", rulesOf({ sets: [], matrices: [], assessments: [good] }).length === 0);

// --- The readers skip what cannot be addressed -------------------------------

check("readWeighingAssessments keeps only rows with string keys, in order", readWeighingAssessments({ assessments: [null, good, 5, { ...good, criterion: 3 }, { ...good, subject: "AC-b" }] }).map((r) => r.subject).join() === "AC-a,AC-b" && readWeighingAssessments(undefined).length === 0 && readWeighingAssessments({}).length === 0);
check("isWeighingAssessmentShape", isWeighingAssessmentShape(good) && !isWeighingAssessmentShape(null) && !isWeighingAssessmentShape([]) && !isWeighingAssessmentShape({ ...good, matrix: undefined }));
check("assessmentKey and the sort never throw on a null or half-empty row", (() => {
  try {
    assessmentKey(null);
    return sortWeighingAssessments([null, good, { subject: 1 }, 5]).filter((r) => r === good).length === 1 && sortWeighingAssessments([null, good])[0] === good;
  } catch {
    return false;
  }
})());

// --- Status: absent or "active" is active; anything else is a draft ---------

check("a set with no status is active", isActiveWeighingSet({ id: "positioning" }) === true);
check("status active is active", isActiveWeighingSet({ status: "active" }) === true);
check("status draft is a draft", isActiveWeighingSet({ status: "draft" }) === false);
check("status Draft (mistyped) is a draft, so it feeds no roll-up", isActiveWeighingSet({ status: "Draft" }) === false);
check("status archived is a draft", isActiveWeighingSet({ status: "archived" }) === false);
check("a non-string status is a draft", isActiveWeighingSet({ status: 5 }) === false && isActiveWeighingSet({ status: null }) === false);
check("only draft and active are valid spellings", !warningsFor(asPos({ status: "active" })).includes("weighing-set-status") && !warningsFor(asPos({ status: "draft" })).includes("weighing-set-status") && warningsFor(asPos({ status: "archived" })).includes("weighing-set-status"));

// --- A positioning needs no scale -------------------------------------------

check("a positioning with no scale is well-formed", isWeighingSetShape(pos) && !("scale" in pos));
check("…and raises no warning", rulesOf({ sets: [pos], matrices: [], assessments: [] }).length === 0);
check("…it uses its ruler's scale", weighingScaleOf(pos, resolveWeighing({ sets: [pos] })) === set.scale);
check("a set that is not a positioning still needs a scale", !isWeighingSetShape({ id: "s", version: "1.0.0", criteria: [] }) && isWeighingSetShape({ id: "s", version: "1.0.0", criteria: [], scale: set.scale }));
check("a set needs a string version", !isWeighingSetShape({ ...pos, version: undefined }) && !isWeighingSetShape({ ...pos, version: 1 }));
check("a matrix needs a string id, a string set and a known subjects kind", isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "list", items: [] } }) && !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "tag" } }) && !isWeighingMatrixShape({ set: "s@1", subjects: { kind: "query" } }));

check("a query matrix names a species and a list matrix has items", !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "query" } }) && !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "list" } }) && isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "query", species: "acceptance" } }));
check("a project set's unusable criteria are dropped from its resolved copy, so it is clean to walk", (() => {
  const own = { id: "rubric", version: "1.0.0", scale: set.scale, criteria: [null, { id: "a" }, { weight: 2 }, 7, { id: "b" }] };
  const resolvedSet = resolveWeighing({ sets: [own] }).sets.find((s) => s.id === "rubric");
  return eq(resolvedSet.criteria.map((c) => c.id), ["a", "b"]) && own.criteria.length === 5;
})());

check("a project set whose scale has no anchors falls back: to its ruler's scale, then to the signed one", (() => {
  const noAnchors = { id: "rubric", version: "1.0.0", criteria: [], scale: { min: -3, max: 3 } };
  const bareMinMax = { ...pos, scale: { anchors: {} } };
  return (
    weighingScaleOf(noAnchors, resolveWeighing({ sets: [noAnchors] })) === set.scale &&
    typeof weighingScaleOf(noAnchors).anchors === "object" &&
    weighingScaleOf(bareMinMax, resolveWeighing({ sets: [bareMinMax] })) === set.scale &&
    weighingScaleOf({ ...pos, scale: set.scale }) === set.scale
  );
})());
check("resolveWeighing reports what it dropped, with kind, id and stored index", (() => {
  const okSet = { id: "ok", version: "1.0.0", scale: set.scale, criteria: [] };
  const okMatrix = { id: "m", set: "value-contribution@2", subjects: { kind: "query", species: "acceptance" } };
  const r = resolveWeighing({
    sets: [okSet, { id: "positioning", role: "positioning" }, null, { ...okSet }, { ...set, version: "9.0.0" }],
    matrices: [okMatrix, { id: "m2" }, { ...okMatrix }, 5],
  });
  return eq(r.skipped, [
    { kind: "set", id: "positioning", role: "positioning", index: 1 },
    { kind: "set", index: 2 },
    { kind: "set", id: "ok", index: 3 },
    { kind: "set", id: "value-contribution", index: 4 },
    { kind: "matrix", id: "m2", index: 1 },
    { kind: "matrix", id: "m", index: 2 },
    { kind: "matrix", index: 3 },
  ]);
})());
check("nothing dropped means an empty skipped list", resolveWeighing(undefined).skipped.length === 0 && resolveWeighing({ sets: [pos] }).skipped.length === 0);

// --- "The first wins" is true ------------------------------------------------

const dup = (title) => ({ id: "rubric", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [], title });
check("two well-formed sets with one id: the first wins, and the warning says exactly that", (() => {
  const weighing = { sets: [dup("first"), dup("second")], matrices: [], assessments: [] };
  const finding = validateBundle({ ...base, weighing }).warnings.find((w) => w.rule === "weighing-duplicate-set");
  return resolveWeighing(weighing).sets.find((s) => s.id === "rubric").title === "first" && finding !== undefined && /first well-formed one wins/.test(finding.message) && finding.path === "weighing.sets[1].id";
})());
check("a malformed earlier set does not shadow a good later one, and raises no duplicate warning", (() => {
  const weighing = { sets: [{ id: "rubric" }, dup("good")], matrices: [], assessments: [] };
  return resolveWeighing(weighing).sets.find((s) => s.id === "rubric")?.title === "good" && !warningsFor(weighing).includes("weighing-duplicate-set");
})());
check("the same holds for matrices", (() => {
  const okMatrix = (title) => ({ id: "m", title, set: "value-contribution@2", subjects: { kind: "query", species: "acceptance" } });
  const first = { sets: [], matrices: [okMatrix("first"), okMatrix("second")], assessments: [] };
  const shadow = { sets: [], matrices: [{ id: "m" }, okMatrix("good")], assessments: [] };
  return (
    resolveWeighing(first).matrices.find((m) => m.id === "m").title === "first" &&
    warningsFor(first).includes("weighing-duplicate-matrix") &&
    resolveWeighing(shadow).matrices.find((m) => m.id === "m")?.title === "good" &&
    !warningsFor(shadow).includes("weighing-duplicate-matrix")
  );
})());

check("none of this is an error — warnings never block an import", validateBundle({ ...base, weighing: { ...section, assessments: [row({ criterion: "teleports", level: 9 })] } }).valid === true);
check("a bundle with no weighing section raises no weighing finding", validateBundle(base).findings.every((f) => !f.rule.startsWith("weighing")));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing tests passed.");

#!/usr/bin/env node

/**
 * Task 5 (issue #400, hosted Kritik): lib/services/graph/quality-events.ts —
 * the pure core behind `POST /api/graph/projects/{id}/quality/events`.
 *
 * DB-free by construction: `parseQualityEventInputs` is shape validation with
 * no I/O, and `planQualityEvents` takes the section and prior journal events
 * as plain arguments rather than reading them itself — the same seam
 * `applyQualityResolutions` (lib/services/github/quality.ts) uses. This is
 * why the suite runs in CI's fast build job instead of beside the ones that
 * need Postgres.
 */

const fs = require("fs");
const { loadQualityEvents, BUILD_DIR } = require("./load-quality-events");

const kritik = loadQualityEvents();
const { parseQualityEventInputs, planQualityEvents, requiredScopeFor, callerMaySendQualityEvents } = kritik;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const FINDING = (over = {}) => ({
  id: "F-2026-08-SEC-web-01",
  criterion_id: "SEC-01",
  surface: "web",
  title: "Anonymous read on the profiles table",
  detail: "d",
  evidence: "e",
  impact: 5,
  likelihood: 4,
  cost: "M",
  status: "open",
  ...over,
});

const SECTION = (findings = [FINDING()]) => ({ findings, assessments: [], profile: { surfaces: [] } });

// --- parseQualityEventInputs -------------------------------------------------

const validResolve = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "F-1" }] });
check("a minimal valid resolve parses", Array.isArray(validResolve) && validResolve.length === 1, JSON.stringify(validResolve));

const validAccepted = parseQualityEventInputs({ events: [{ type: "quality.finding.accepted", finding_id: "F-1", reason: "known, tracked elsewhere" }] });
check("a valid accepted with a reason parses", Array.isArray(validAccepted) && validAccepted.length === 1, JSON.stringify(validAccepted));

const missingReason = parseQualityEventInputs({ events: [{ type: "quality.finding.accepted", finding_id: "F-1" }] });
check("accepted without a reason is a parse error", !Array.isArray(missingReason) && typeof missingReason.error === "string", JSON.stringify(missingReason));

const emptyReason = parseQualityEventInputs({ events: [{ type: "quality.finding.accepted", finding_id: "F-1", reason: "" }] });
check("accepted with an empty reason is a parse error", !Array.isArray(emptyReason) && typeof emptyReason.error === "string", JSON.stringify(emptyReason));

const emptyResolvedBy = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "F-1", resolved_by: "" }] });
check("resolved_by: \"\" is a parse error", !Array.isArray(emptyResolvedBy) && typeof emptyResolvedBy.error === "string", JSON.stringify(emptyResolvedBy));

const namedResolve = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "F-1", resolved_by: "https://github.com/acme/notes-app/pull/7" }] });
check("resolved_by, when non-empty, is accepted", Array.isArray(namedResolve), JSON.stringify(namedResolve));

const unknownType = parseQualityEventInputs({ events: [{ type: "quality.finding.reopened", finding_id: "F-1" }] });
check("an unwhitelisted type is a parse error", !Array.isArray(unknownType) && typeof unknownType.error === "string", JSON.stringify(unknownType));

const emptyBatch = parseQualityEventInputs({ events: [] });
check("an empty events array is a parse error", !Array.isArray(emptyBatch) && typeof emptyBatch.error === "string", JSON.stringify(emptyBatch));

const missingEvents = parseQualityEventInputs({});
check("a missing events key is a parse error", !Array.isArray(missingEvents) && typeof missingEvents.error === "string", JSON.stringify(missingEvents));

const notArray = parseQualityEventInputs({ events: "nope" });
check("a non-array events value is a parse error", !Array.isArray(notArray) && typeof notArray.error === "string", JSON.stringify(notArray));

const notObject = parseQualityEventInputs("nope");
check("a non-object body is a parse error", !Array.isArray(notObject) && typeof notObject.error === "string", JSON.stringify(notObject));

const nullBody = parseQualityEventInputs(null);
check("a null body is a parse error", !Array.isArray(nullBody) && typeof nullBody.error === "string", JSON.stringify(nullBody));

const tooMany = parseQualityEventInputs({
  events: Array.from({ length: 51 }, (_, i) => ({ type: "quality.finding.resolved", finding_id: `F-${i}` })),
});
check(">50 entries is a parse error", !Array.isArray(tooMany) && typeof tooMany.error === "string", JSON.stringify(tooMany));

const exactly50 = parseQualityEventInputs({
  events: Array.from({ length: 50 }, (_, i) => ({ type: "quality.finding.resolved", finding_id: `F-${i}` })),
});
check("exactly 50 entries parses", Array.isArray(exactly50) && exactly50.length === 50, JSON.stringify(exactly50).slice(0, 100));

const blankId = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "" }] });
check("an empty finding_id is a parse error", !Array.isArray(blankId) && typeof blankId.error === "string", JSON.stringify(blankId));

const missingId = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved" }] });
check("a missing finding_id is a parse error", !Array.isArray(missingId) && typeof missingId.error === "string", JSON.stringify(missingId));

// --- planQualityEvents -------------------------------------------------------

const resolvePlan = planQualityEvents(
  SECTION([FINDING({ node_ids: ["V-profile"] })]),
  [],
  [{ type: "quality.finding.resolved", finding_id: "F-2026-08-SEC-web-01", resolved_by: "https://github.com/acme/notes-app/pull/7" }],
  "arkaik-agent",
);
check("a valid resolve plans ok", resolvePlan.ok === true, JSON.stringify(resolvePlan));
if (resolvePlan.ok) {
  const [event] = resolvePlan.events;
  check("exactly one event is planned", resolvePlan.events.length === 1, JSON.stringify(resolvePlan.events));
  check("the event carries the given actor", event.actor === "arkaik-agent", JSON.stringify(event));
  check("the finding's node_ids ride along", JSON.stringify(event.node_ids) === JSON.stringify(["V-profile"]), JSON.stringify(event));
  check("the event type is quality.finding.resolved", event.type === "quality.finding.resolved", JSON.stringify(event));
}

const unknownPlan = planQualityEvents(
  SECTION(),
  [],
  [{ type: "quality.finding.resolved", finding_id: "F-nope" }],
  "arkaik-agent",
);
check("an unknown finding_id refuses the batch", unknownPlan.ok === false, JSON.stringify(unknownPlan));
if (!unknownPlan.ok) {
  check("refusal names unknown_finding", unknownPlan.refusals[0].reason === "unknown_finding" && unknownPlan.refusals[0].finding_id === "F-nope", JSON.stringify(unknownPlan.refusals));
}

const snapshotDecided = planQualityEvents(
  SECTION([FINDING({ status: "accepted-risk" })]),
  [],
  [{ type: "quality.finding.resolved", finding_id: "F-2026-08-SEC-web-01" }],
  "arkaik-agent",
);
check("a finding already decided in the snapshot refuses not_open", snapshotDecided.ok === false && snapshotDecided.refusals[0].reason === "not_open", JSON.stringify(snapshotDecided));

const priorEvent = { id: "ev1", ts: new Date().toISOString(), type: "quality.finding.resolved", finding_id: "F-2026-08-SEC-web-01" };
const eventDecided = planQualityEvents(
  SECTION([FINDING()]),
  [priorEvent],
  [{ type: "quality.finding.accepted", finding_id: "F-2026-08-SEC-web-01", reason: "already handled" }],
  "arkaik-agent",
);
check("a finding decided by a prior journal event refuses not_open", eventDecided.ok === false && eventDecided.refusals[0].reason === "not_open", JSON.stringify(eventDecided));

const duplicateInBatch = planQualityEvents(
  SECTION([FINDING()]),
  [],
  [
    { type: "quality.finding.resolved", finding_id: "F-2026-08-SEC-web-01" },
    { type: "quality.finding.accepted", finding_id: "F-2026-08-SEC-web-01", reason: "second time" },
  ],
  "arkaik-agent",
);
check("a finding decided twice in one batch refuses the second not_open", duplicateInBatch.ok === false, JSON.stringify(duplicateInBatch));
if (!duplicateInBatch.ok) {
  check("exactly one refusal, on the duplicate", duplicateInBatch.refusals.length === 1 && duplicateInBatch.refusals[0].reason === "not_open", JSON.stringify(duplicateInBatch.refusals));
}

// Any refusal refuses the WHOLE batch — a good entry earlier in the list must
// not leak an event out when a later entry in the same batch is refused.
const mixedBatch = planQualityEvents(
  SECTION([FINDING({ id: "F-good" }), FINDING({ id: "F-bad", status: "refuted" })]),
  [],
  [
    { type: "quality.finding.resolved", finding_id: "F-good" },
    { type: "quality.finding.resolved", finding_id: "F-bad" },
  ],
  "arkaik-agent",
);
check("one refusal in a batch refuses the whole batch (all-or-nothing)", mixedBatch.ok === false, JSON.stringify(mixedBatch));
if (!mixedBatch.ok) {
  check("the good entry's event does not leak out on refusal", mixedBatch.refusals.every((r) => r.finding_id !== undefined) && !("events" in mixedBatch), JSON.stringify(mixedBatch));
}

const acceptedPlan = planQualityEvents(
  SECTION([FINDING({ id: "F-acc" })]),
  [],
  [{ type: "quality.finding.accepted", finding_id: "F-acc", reason: "tracked in #123" }],
  "arkaik-agent",
);
check("a valid accept plans ok with a quality.finding.accepted event", acceptedPlan.ok === true && acceptedPlan.events[0].type === "quality.finding.accepted", JSON.stringify(acceptedPlan));

// --- #406: quality.signal.tripped -------------------------------------------

// The third whitelisted type. A trip decides nothing, so it never consults a
// finding: no unknown_finding, no not_open, no batch bookkeeping.
const TRIP = {
  type: "quality.signal.tripped",
  criterion_id: "SEC-supabase-01",
  surface: "supabase",
  signal: "delete-account rejects an unauthenticated call",
  commit: "0123456789abcdef0123456789abcdef01234567",
  detail: "https://github.com/o/r/actions/runs/1",
};

{
  const parsed = parseQualityEventInputs({ events: [TRIP] });
  check("trip parses", Array.isArray(parsed) && parsed[0].type === "quality.signal.tripped", JSON.stringify(parsed));
  check("trip keeps commit", Array.isArray(parsed) && parsed[0].commit === TRIP.commit, JSON.stringify(parsed));
  check("trip keeps detail", Array.isArray(parsed) && parsed[0].detail === TRIP.detail, JSON.stringify(parsed));
}
for (const field of ["criterion_id", "surface", "signal", "commit"]) {
  const bad = { ...TRIP, [field]: undefined };
  const parsed = parseQualityEventInputs({ events: [bad] });
  check(`trip without ${field} is refused`, !Array.isArray(parsed) && parsed.error.includes(field), JSON.stringify(parsed));
}
{
  const parsed = parseQualityEventInputs({ events: [{ ...TRIP, detail: undefined }] });
  check("detail is optional", Array.isArray(parsed) && !("detail" in parsed[0]), JSON.stringify(parsed));
}
{
  const parsed = parseQualityEventInputs({ events: [{ ...TRIP, detail: "" }] });
  check("an empty detail on a trip is a parse error", !Array.isArray(parsed) && typeof parsed.error === "string", JSON.stringify(parsed));
}
{
  const parsed = parseQualityEventInputs({ events: [{ type: "node.created", id: "V-x" }] });
  check("unknown type names all five legal values",
    !Array.isArray(parsed) &&
    parsed.error.includes("quality.signal.tripped") &&
    parsed.error.includes("quality.finding.resolved") &&
    parsed.error.includes("quality.finding.accepted") &&
    parsed.error.includes("quality.assessment.scored") &&
    parsed.error.includes("quality.audit.completed"), JSON.stringify(parsed));
}
{
  // No section, no prior events, no findings anywhere — a trip still plans.
  const inputs = parseQualityEventInputs({ events: [TRIP] });
  const plan = planQualityEvents(undefined, [], inputs, "arkaik-agent");
  check("trip plans without any section", plan.ok && plan.events.length === 1, JSON.stringify(plan));
  check("trip event carries criterion + commit",
    plan.ok && plan.events[0].type === "quality.signal.tripped" &&
    plan.events[0].criterion_id === "SEC-supabase-01" && plan.events[0].commit === TRIP.commit, JSON.stringify(plan));
}
{
  // A trip alongside a VALID finding decision: both events are planned.
  const inputs = parseQualityEventInputs({
    events: [TRIP, { type: "quality.finding.resolved", finding_id: "F-mixed" }],
  });
  const plan = planQualityEvents(SECTION([FINDING({ id: "F-mixed" })]), [], inputs, "arkaik-agent");
  check("a trip batched with a valid resolution plans two events", plan.ok && plan.events.length === 2, JSON.stringify(plan));
  check("the two events are the trip and the resolution",
    plan.ok && plan.events[0].type === "quality.signal.tripped" && plan.events[1].type === "quality.finding.resolved", JSON.stringify(plan));
}
{
  // All-or-nothing still holds across types: a refused finding decision
  // refuses the trip batched with it — and the trip never appears in refusals,
  // because a trip has nothing to refuse.
  const inputs = parseQualityEventInputs({
    events: [TRIP, { type: "quality.finding.resolved", finding_id: "F-nope" }],
  });
  const plan = planQualityEvents(SECTION(), [], inputs, "arkaik-agent");
  check("a trip batched with a refused decision refuses the whole batch", plan.ok === false, JSON.stringify(plan));
  check("refusals name only the finding, never the trip",
    plan.ok === false && plan.refusals.length === 1 && plan.refusals[0].finding_id === "F-nope", JSON.stringify(plan));
}

// --- #473: quality.assessment.scored + scoped quality.audit.completed ------

const SCORED = {
  type: "quality.assessment.scored",
  criterion_id: "SEC-01",
  surface: "web",
  level: 3,
  evidence: "Verified via curl against a fresh instance.",
  audit_id: "2026-09-27",
  commit: "0123456789abcdef0123456789abcdef01234567",
};

{
  const parsed = parseQualityEventInputs({ events: [SCORED] });
  check("a valid scored entry parses", Array.isArray(parsed) && parsed.length === 1, JSON.stringify(parsed));
  check("the parsed scored entry equals the input", Array.isArray(parsed) && JSON.stringify(parsed[0]) === JSON.stringify(SCORED), JSON.stringify(parsed));
}
{
  const minimal = { type: "quality.assessment.scored", criterion_id: "SEC-01", surface: "web", level: 0, evidence: "e" };
  const parsed = parseQualityEventInputs({ events: [minimal] });
  check("a minimal scored entry (no audit_id/commit) parses", Array.isArray(parsed) && !("audit_id" in parsed[0]) && !("commit" in parsed[0]), JSON.stringify(parsed));
}
for (const level of [5, 2.5, "3", -1]) {
  const parsed = parseQualityEventInputs({ events: [{ ...SCORED, level }] });
  check(`a scored level of ${JSON.stringify(level)} is refused`, !Array.isArray(parsed) && parsed.error.includes("level"), JSON.stringify(parsed));
}
{
  const missingEvidence = { ...SCORED, evidence: undefined };
  const parsed = parseQualityEventInputs({ events: [missingEvidence] });
  check("scored without evidence is refused", !Array.isArray(parsed) && parsed.error.includes("evidence"), JSON.stringify(parsed));
}
{
  const emptyCriterion = { ...SCORED, criterion_id: "" };
  const parsed = parseQualityEventInputs({ events: [emptyCriterion] });
  check("scored with an empty criterion_id is refused", !Array.isArray(parsed) && parsed.error.includes("criterion_id"), JSON.stringify(parsed));
}
{
  const emptyAuditId = { ...SCORED, audit_id: "" };
  const parsed = parseQualityEventInputs({ events: [emptyAuditId] });
  check("scored with an empty audit_id is refused", !Array.isArray(parsed) && parsed.error.includes("audit_id"), JSON.stringify(parsed));
}
{
  const emptyCommit = { ...SCORED, commit: "" };
  const parsed = parseQualityEventInputs({ events: [emptyCommit] });
  check("scored with an empty commit is refused", !Array.isArray(parsed) && parsed.error.includes("commit"), JSON.stringify(parsed));
}

const AUDIT_COMPLETED = {
  type: "quality.audit.completed",
  scope: true,
  audit_id: "2026-09-27",
  commit: "0123456789abcdef0123456789abcdef01234567",
};

{
  const parsed = parseQualityEventInputs({ events: [AUDIT_COMPLETED] });
  check("a valid scoped audit.completed parses", Array.isArray(parsed) && parsed.length === 1, JSON.stringify(parsed));
  check("the parsed audit.completed entry equals the input", Array.isArray(parsed) && JSON.stringify(parsed[0]) === JSON.stringify(AUDIT_COMPLETED), JSON.stringify(parsed));
}
{
  const minimal = { type: "quality.audit.completed", scope: true, audit_id: "2026-09-27" };
  const parsed = parseQualityEventInputs({ events: [minimal] });
  check("a minimal scoped audit.completed (no commit) parses", Array.isArray(parsed) && !("commit" in parsed[0]), JSON.stringify(parsed));
}
{
  const missingScope = { type: "quality.audit.completed", audit_id: "2026-09-27" };
  const parsed = parseQualityEventInputs({ events: [missingScope] });
  check("audit.completed without scope is refused", !Array.isArray(parsed) && parsed.error.includes("scope"), JSON.stringify(parsed));
}
{
  const falseScope = { ...AUDIT_COMPLETED, scope: false };
  const parsed = parseQualityEventInputs({ events: [falseScope] });
  check("audit.completed with scope: false is refused", !Array.isArray(parsed) && parsed.error.includes("scope"), JSON.stringify(parsed));
}
{
  const withScores = { ...AUDIT_COMPLETED, scores: { web: { SEC: 3 } } };
  const parsed = parseQualityEventInputs({ events: [withScores] });
  check("audit.completed with scores present is refused", !Array.isArray(parsed) && parsed.error.includes("computed by the server"), JSON.stringify(parsed));
}
{
  const withCounts = { ...AUDIT_COMPLETED, counts: { open: 1 } };
  const parsed = parseQualityEventInputs({ events: [withCounts] });
  check("audit.completed with counts present is refused", !Array.isArray(parsed) && parsed.error.includes("computed by the server"), JSON.stringify(parsed));
}
{
  const emptyAuditId = { ...AUDIT_COMPLETED, audit_id: "" };
  const parsed = parseQualityEventInputs({ events: [emptyAuditId] });
  check("audit.completed with an empty audit_id is refused", !Array.isArray(parsed) && parsed.error.includes("audit_id"), JSON.stringify(parsed));
}
{
  const emptyCommit = { ...AUDIT_COMPLETED, commit: "" };
  const parsed = parseQualityEventInputs({ events: [emptyCommit] });
  check("audit.completed with an empty commit is refused", !Array.isArray(parsed) && parsed.error.includes("commit"), JSON.stringify(parsed));
}

// --- #473: planning scores, scoped recordings and the baseline write --------

// A restored project: one `2026-08` audit in the snapshot, no recorded reading
// of it in the journal, and one hosted resolution since. The shape Pebbles was
// in when #472/#473 were filed.
const { BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");
const schema = require(require("path").join(SCHEMA_BUILD_DIR, "index.js"));
const { foldQualityEvents } = require(require("path").join(BUILD_DIR, "quality-utils.js"));
const { deriveQualityMatrix, deriveQualityTrend, trendRows } = schema;

const LIB = {
  version: "1.0.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [
    { id: "SEC-01", domain: "SEC", weight: 1, applies_to: ["web"] },
    { id: "SEC-02", domain: "SEC", weight: 1, applies_to: ["web"] },
  ],
};
const RESTORED = (over = {}) => ({
  framework_version: "1.0.0",
  library: LIB,
  profile: { surfaces: [{ id: "web", title: "Web" }] },
  assessments: [
    { criterion_id: "SEC-01", surface: "web", level: 1, evidence: "e1", audit_id: "2026-08", ts: "2026-08-10T00:00:00.000Z" },
    { criterion_id: "SEC-02", surface: "web", level: 2, evidence: "e2", audit_id: "2026-08", ts: "2026-08-10T00:00:00.000Z" },
  ],
  findings: [FINDING({ id: "F-1", criterion_id: "SEC-01" }), FINDING({ id: "F-2", criterion_id: "SEC-02" })],
  ...over,
});
const RESOLUTION = { id: "01K0000000000000000000RES1", ts: "2026-08-20T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-1" };
const PRIOR = [RESOLUTION];
const NOW = new Date("2026-09-15T00:00:00Z");
const SCORE = (over = {}) => ({ type: "quality.assessment.scored", criterion_id: "SEC-01", surface: "web", level: 4, evidence: "fixed in #7", ...over });
const COMPLETE = (audit_id) => ({ type: "quality.audit.completed", scope: true, audit_id });
const typesOf = (plan) => (plan.ok ? plan.events.map((e) => e.type).join(",") : `refused:${JSON.stringify(plan.refusals)}`);

// 1. The first hosted score writes the baseline, backdated, then the score.
const plan1 = planQualityEvents(RESTORED(), PRIOR, [SCORE()], "arkaik-agent", NOW);
check("#473.1 the first scored entry plans the baseline, then the score",
  typesOf(plan1) === "quality.audit.completed,quality.assessment.scored", typesOf(plan1));
if (plan1.ok) {
  const [baseline, scored] = plan1.events;
  check("#473.1 the baseline is flagged, names the restored audit, and sorts before the resolution",
    baseline.baseline === true && baseline.audit_id === "2026-08" && baseline.ts < RESOLUTION.ts, JSON.stringify(baseline));
  check("#473.1 the score lands in a new scoped audit measured from 2026-08",
    scored.audit_id === "2026-09-scoped" && scored.scope && scored.scope.since === "2026-08", JSON.stringify(scored));
}
const after1 = plan1.ok ? [...PRIOR, ...plan1.events] : PRIOR;

// 2. The baseline is written once; the open scoped audit is continued.
{
  const plan = planQualityEvents(RESTORED(), after1, [SCORE({ level: 3 })], "arkaik-agent", NOW);
  check("#473.2 a second score plans exactly one scored event and no baseline",
    typesOf(plan) === "quality.assessment.scored", typesOf(plan));
  check("#473.2 it continues the open scoped audit", plan.ok && plan.events[0].audit_id === "2026-09-scoped", JSON.stringify(plan));
}

// 3. A cell no resolution touched is out of scope.
{
  const plan = planQualityEvents(RESTORED(), PRIOR, [SCORE({ criterion_id: "SEC-02" })], "arkaik-agent", NOW);
  check("#473.3 a cell outside the scope refuses out_of_scope with no events",
    plan.ok === false && plan.refusals.map((r) => r.reason).join() === "out_of_scope" && !("events" in plan), JSON.stringify(plan));
}

// 4. Validation against the pack and the profile.
{
  const unknown = planQualityEvents(RESTORED(), PRIOR, [SCORE({ criterion_id: "SEC-99" })], "arkaik-agent", NOW);
  check("#473.4 an unknown criterion refuses invalid_assessment",
    unknown.ok === false && unknown.refusals[0].reason === "invalid_assessment" && unknown.refusals[0].detail.includes("SEC-99"), JSON.stringify(unknown));
  const cross = planQualityEvents(RESTORED(), PRIOR, [SCORE({ surface: "cross-surface" })], "arkaik-agent", NOW);
  check("#473.4 a cross-surface score refuses invalid_assessment",
    cross.ok === false && cross.refusals[0].reason === "invalid_assessment", JSON.stringify(cross));
  const retiredLib = { ...LIB, criteria: [...LIB.criteria, { id: "SEC-00", domain: "SEC", weight: 1, superseded_by: "SEC-01" }] };
  const retired = planQualityEvents(RESTORED({ library: retiredLib }), PRIOR, [SCORE({ criterion_id: "SEC-00" })], "arkaik-agent", NOW);
  check("#473.4 a retired criterion refuses invalid_assessment",
    retired.ok === false && retired.refusals[0].reason === "invalid_assessment" && retired.refusals[0].detail.includes("SEC-01"), JSON.stringify(retired));
  const undeclared = planQualityEvents(RESTORED(), PRIOR, [SCORE({ surface: "ios" })], "arkaik-agent", NOW);
  check("#473.4 an undeclared surface refuses invalid_assessment",
    undeclared.ok === false && undeclared.refusals[0].reason === "invalid_assessment", JSON.stringify(undeclared));
  const twoSurfaces = RESTORED({ profile: { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }] } });
  const excluded = planQualityEvents(twoSurfaces, PRIOR, [SCORE({ surface: "ios" })], "arkaik-agent", NOW);
  check("#473.4 a surface the criterion does not apply to refuses invalid_assessment",
    excluded.ok === false && excluded.refusals[0].reason === "invalid_assessment", JSON.stringify(excluded));
}

// 5. Nothing to measure from.
{
  const plan = planQualityEvents(RESTORED({ assessments: [] }), PRIOR, [SCORE()], "arkaik-agent", NOW);
  check("#473.5 no assessments and no recording refuses no_baseline",
    plan.ok === false && plan.refusals.map((r) => r.reason).join() === "no_baseline", JSON.stringify(plan));
}

// 6. The scoped completion: the server computes the reading.
const completion = planQualityEvents(RESTORED(), after1, [COMPLETE("2026-09-scoped")], "arkaik-agent", NOW);
{
  check("#473.6 a scoped completion plans exactly one audit.completed", typesOf(completion) === "quality.audit.completed", typesOf(completion));
  const expected = deriveQualityMatrix({ quality: foldQualityEvents(RESTORED(), after1) }, LIB).matrix.SEC.web.score;
  const baselineScore = plan1.ok ? plan1.events[0].scores.web.SEC : undefined;
  check("#473.6 precondition: the re-score moved the cell off the baseline's score",
    typeof expected === "number" && typeof baselineScore === "number" && expected !== baselineScore, `${expected} vs ${baselineScore}`);
  if (completion.ok) {
    const [event] = completion.events;
    check("#473.6 the completion is scoped: partial, one cell, since 2026-08",
      JSON.stringify(event.scope) === JSON.stringify({ partial: true, cells: 1, since: "2026-08" }), JSON.stringify(event.scope));
    check("#473.6 its score is the folded matrix's", event.scores.web.SEC === expected, `${event.scores.web.SEC} vs ${expected}`);
    check("#473.6 it is not a baseline", event.baseline === undefined && event.audit_id === "2026-09-scoped", JSON.stringify(event));
  }
}

// 7. Completion refusals.
{
  const unscored = planQualityEvents(RESTORED(), after1, [COMPLETE("2026-09-other")], "arkaik-agent", NOW);
  check("#473.7 completing an audit with no scores refuses not_scored",
    unscored.ok === false && unscored.refusals.map((r) => r.reason).join() === "not_scored", JSON.stringify(unscored));
  const recorded = completion.ok ? [...after1, ...completion.events] : after1;
  const twice = planQualityEvents(RESTORED(), recorded, [COMPLETE("2026-09-scoped")], "arkaik-agent", NOW);
  check("#473.7 completing a recorded audit again refuses already_recorded",
    twice.ok === false && twice.refusals.map((r) => r.reason).join() === "already_recorded", JSON.stringify(twice));
}

// 8. Score and complete in one batch.
{
  const plan = planQualityEvents(RESTORED(), PRIOR, [SCORE(), COMPLETE("2026-09-scoped")], "arkaik-agent", NOW);
  check("#473.8 score + complete in one batch plans baseline, score, completion",
    typesOf(plan) === "quality.audit.completed,quality.assessment.scored,quality.audit.completed", typesOf(plan));
  check("#473.8 the first is the baseline and the last the scoped reading",
    plan.ok && plan.events[0].baseline === true && plan.events[2].audit_id === "2026-09-scoped" && plan.events[2].scope?.since === "2026-08",
    JSON.stringify(plan));
}

// 9. All-or-nothing, with the refused entry's index.
{
  const plan = planQualityEvents(RESTORED(), PRIOR, [SCORE(), SCORE({ criterion_id: "SEC-02" })], "arkaik-agent", NOW);
  check("#473.9 a good score batched with an out-of-scope one refuses the whole batch", plan.ok === false && !("events" in plan), JSON.stringify(plan));
  check("#473.9 the refusal names index 1",
    plan.ok === false && plan.refusals.length === 1 && plan.refusals[0].index === 1 && plan.refusals[0].reason === "out_of_scope", JSON.stringify(plan));
}

// 10. #473's trend acceptance, end to end in pure code.
{
  const all = completion.ok ? [...after1, ...completion.events] : after1;
  const { rows } = trendRows(deriveQualityTrend(all, RESTORED().profile));
  check("#473.10 the trend has the baseline row, then the scoped row",
    rows.map((r) => r.audit_id).join() === "2026-08,2026-09-scoped", JSON.stringify(rows));
  check("#473.10 the first row is the baseline", rows[0]?.baseline === true, JSON.stringify(rows[0]));
  check("#473.10 the second row is scoped from 2026-08 and moved",
    rows[1]?.scope?.since === "2026-08" && rows[1]?.cells?.web?.delta !== null && rows[1]?.cells?.web?.delta !== undefined, JSON.stringify(rows[1]));
}

// Beyond the ten: a recording newer than the scores' `since` moves the scope,
// so completing the older re-audit would record a reading of the wrong window.
{
  const newer = {
    id: "01K0000000000000000000NEW1", ts: "2026-09-20T00:00:00.000Z", type: "quality.audit.completed",
    audit_id: "2026-09-zz", framework_version: "1.0.0", scores: {}, counts: {},
  };
  const plan = planQualityEvents(RESTORED(), [...after1, newer], [COMPLETE("2026-09-scoped")], "arkaik-agent", NOW);
  check("#473 completing a re-audit scored from an older scope refuses scope_mismatch",
    plan.ok === false && plan.refusals.map((r) => r.reason).join() === "scope_mismatch" && plan.refusals[0].detail.includes("2026-09-zz"),
    JSON.stringify(plan));
}
// And a resolution earlier in the SAME batch puts its cell in scope for a score after it.
{
  const plan = planQualityEvents(
    RESTORED(), PRIOR,
    [{ type: "quality.finding.resolved", finding_id: "F-2" }, SCORE({ criterion_id: "SEC-02" })],
    "arkaik-agent", NOW,
  );
  check("#473 a resolution in the batch widens the scope for a later score",
    typesOf(plan) === "quality.audit.completed,quality.finding.resolved,quality.assessment.scored", typesOf(plan));
}

// --- requiredScopeFor --------------------------------------------------------

{
  const trips = parseQualityEventInputs({ events: [TRIP, { ...TRIP, criterion_id: "SEC-supabase-02" }] });
  check("a batch of nothing but trips requires quality:append", requiredScopeFor(trips) === "quality:append");

  const resolution = parseQualityEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "F-1" }] });
  check("a finding decision requires graph:write", requiredScopeFor(resolution) === "graph:write");

  const scored = parseQualityEventInputs({ events: [SCORED] });
  check("a batch holding a scored entry requires graph:write", requiredScopeFor(scored) === "graph:write");

  const mixed = parseQualityEventInputs({
    events: [TRIP, { type: "quality.finding.accepted", finding_id: "F-1", reason: "tracked" }],
  });
  check("a mixed batch requires graph:write", requiredScopeFor(mixed) === "graph:write");

  // `requiredScopeFor` is a FLOOR, not an exact requirement. Enforcing it
  // exactly would have refused every #400 caller — a graph:write-only agent
  // token — the moment it appended a trip.
  const WRITE = ["graph:read", "graph:write"];
  const APPEND = ["quality:append"];
  check("graph:write may send trips", callerMaySendQualityEvents(WRITE, trips));
  check("graph:write may send a decision", callerMaySendQualityEvents(WRITE, resolution));
  check("graph:write may send a mixed batch", callerMaySendQualityEvents(WRITE, mixed));
  check("quality:append may send trips", callerMaySendQualityEvents(APPEND, trips));
  check("quality:append may NOT send a decision", !callerMaySendQualityEvents(APPEND, resolution));
  check("quality:append may NOT send a mixed batch", !callerMaySendQualityEvents(APPEND, mixed));
  check("graph:read alone may send nothing", !callerMaySendQualityEvents(["graph:read"], trips));
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);

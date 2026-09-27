#!/usr/bin/env node

/**
 * The implicit baseline (issue #472): a hosted project whose audit arrived by
 * `arkaik restore` has assessments but no recorded reading, so the scope and
 * the trend had nothing to measure from. Pure and DB-free.
 *
 * The pack's severity scale is the schema default, so the cap assertions below
 * test the status revert, not arithmetic: an open impact-5 x likelihood-5
 * finding is Critical; resolved (or never decided on), it isn't counted.
 */

const { loadSchema } = require("./load-schema");
const {
  implicitAuditBaseline,
  withImplicitBaseline,
  baselineEventPayload,
  deriveAuditScope,
  deriveQualityMatrix,
  deriveQualityTrend,
  recordedAuditIds,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const EPOCH = "1970-01-01T00:00:00.000Z";

const LIBRARY = {
  version: "1.4.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [
    { id: "SEC-01", domain: "SEC", applies_to: ["web"] },
    { id: "SEC-02", domain: "SEC", applies_to: ["web"] },
  ],
};
const assess = (criterion, level, audit, ts) => ({ criterion_id: criterion, surface: "web", level, evidence: "e", audit_id: audit, ...(ts ? { ts } : {}) });
const finding = (id, criterion, over = {}) => ({
  id, criterion_id: criterion, surface: "web", title: id, detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "S", status: "open", ...over,
});
const SECTION = {
  profile: { surfaces: [{ id: "web", title: "Web" }] },
  assessments: [
    assess("SEC-01", 3, "2026-07", "2026-07-03T00:00:00.000Z"),
    assess("SEC-01", 3, "2026-08", "2026-08-04T10:00:00.000Z"),
    assess("SEC-02", 3, "2026-08", "2026-08-05T10:00:00.000Z"),
  ],
  // F-1 is resolved in the folded read, but a hosted resolution below decided it.
  findings: [finding("F-1", "SEC-01", { status: "resolved", resolved_by: "https://pr/1" }), finding("F-2", "SEC-02", { impact: 1, likelihood: 1 })],
};
const resolved = (id, findingId, ts) => ({ id, ts, type: "quality.finding.resolved", finding_id: findingId, actor: "github-app" });
const accepted = (id, findingId, ts) => ({ id, ts, type: "quality.finding.accepted", finding_id: findingId, actor: "github-app" });
const JOURNAL = [
  { id: "01OPEN", ts: "2026-08-04T09:00:00.000Z", type: "quality.finding.opened", finding_id: "F-1", criterion_id: "SEC-01", surface: "web", severity: "critical", priority: "P0", title: "F-1" },
  resolved("01RES2", "F-1", "2026-08-20T00:00:00.000Z"),
  { id: "01NODE", ts: "2026-08-10T00:00:00.000Z", type: "node.created", node_id: "V-x" },
];

// --- when --------------------------------------------------------------------

check("no assessments → no baseline", implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: [] }, LIBRARY) === null);
check(
  "a recorded audit anywhere → no baseline",
  implicitAuditBaseline([...JOURNAL, { id: "01A", ts: "2026-08-06T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-07", framework_version: "1.4.0" }], SECTION, LIBRARY) === null,
);
check("garbage in never throws", implicitAuditBaseline(null, null, undefined) === null && implicitAuditBaseline([null, 3], { assessments: "x" }) === null);

// A `null` row buried inside an otherwise-valid array reaches `deriveQualityMatrix`,
// which dereferences `.surface`/`.status` unguarded — each array is tested on its
// own so a fix that guards only one side still shows up as a failure here.
let threwOnMalformedAssessments = false;
try {
  implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: [null, ...SECTION.assessments] }, LIBRARY);
} catch {
  threwOnMalformedAssessments = true;
}
check("a null row inside assessments never throws", !threwOnMalformedAssessments);

let threwOnMalformedFindings = false;
try {
  implicitAuditBaseline(JOURNAL, { ...SECTION, findings: [null, ...SECTION.findings] }, LIBRARY);
} catch {
  threwOnMalformedFindings = true;
}
check("a null row inside findings never throws", !threwOnMalformedFindings);

const baseline = implicitAuditBaseline(JOURNAL, SECTION, LIBRARY);
check("a restored, unrecorded audit gets a baseline", baseline !== null, JSON.stringify(baseline));

// --- which and when ------------------------------------------------------------

check("it reads the newest stored audit", baseline.audit_id === "2026-08", baseline.audit_id);
check("it is dated when that audit was taken (its newest assessment)", baseline.ts === "2026-08-05T10:00:00.000Z", baseline.ts);
check("it is flagged baseline, has a stable id and no actor", baseline.baseline === true && baseline.id === "implicit-baseline:2026-08" && !("actor" in baseline));

const late = implicitAuditBaseline([resolved("01EARLY", "F-1", "2026-08-05T00:00:00.000Z")], SECTION, LIBRARY);
check(
  "an assessment newer than the first decision is capped to 1 ms before it — no resolution falls out of the window",
  late.ts === "2026-08-04T23:59:59.999Z",
  late.ts,
);
const noTs = implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no assessment ts → 1 ms before the first decision", noTs.ts === "2026-08-19T23:59:59.999Z", noTs.ts);
const nothing = implicitAuditBaseline([], { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no ts and no decision → the epoch", nothing.ts === EPOCH, nothing.ts);
const badTs = implicitAuditBaseline([resolved("01BAD", "F-1", "not a date")], SECTION, LIBRARY);
check("an unparsable decision ts → the epoch, never after the decision", badTs.ts === EPOCH, badTs.ts);

// A non-UTC assessment ts must be normalized to its UTC instant before it is
// compared or returned — not read as a raw string.
const TZ_SECTION = {
  ...SECTION,
  assessments: [
    ...SECTION.assessments.filter((a) => a.criterion_id !== "SEC-02"),
    assess("SEC-02", 3, "2026-08", "2026-08-05T12:00:00+02:00"),
  ],
};
const tzBaseline = implicitAuditBaseline(JOURNAL, TZ_SECTION, LIBRARY);
check("a non-UTC assessment ts is normalized to its UTC instant", tzBaseline.ts === "2026-08-05T10:00:00.000Z", tzBaseline.ts);

// Two decisions out of array order: the chronologically-first one (by
// `orderEvents`, not array position) is what the window is measured against.
const outOfOrder = [
  resolved("01LATER", "F-1", "2026-08-06T00:00:00.000Z"), // later ts, listed first
  resolved("01EARLIER", "F-1", "2026-08-05T09:30:00.000Z"), // earlier ts, listed second
];
const outOfOrderBaseline = implicitAuditBaseline(outOfOrder, SECTION, LIBRARY);
check(
  "the first decision is chosen by chronological order, not array position",
  outOfOrderBaseline.ts === "2026-08-05T09:29:59.999Z",
  outOfOrderBaseline.ts,
);

// An older audit id whose own assessment carries a later ts than anything in
// the actually-newest audit, stored last in the array. The chosen audit must
// still be the lexically-newest id, and `assessedAt` must stay scoped to it.
const ORDER_SECTION = {
  profile: SECTION.profile,
  assessments: [
    assess("SEC-02", 3, "2026-08", "2026-08-05T10:00:00.000Z"),
    assess("SEC-01", 3, "2026-08", "2026-08-04T10:00:00.000Z"),
    assess("SEC-01", 2, "2026-07", "2026-09-01T00:00:00.000Z"), // older audit id, newest ts, last in the array
  ],
  findings: SECTION.findings,
};
const orderBaseline = implicitAuditBaseline([], ORDER_SECTION, LIBRARY);
check(
  "the newest audit is chosen by id, not array position, and assessedAt is scoped to it",
  orderBaseline.audit_id === "2026-08" && orderBaseline.ts === "2026-08-05T10:00:00.000Z",
  JSON.stringify(orderBaseline),
);

// `orderEvents` sorts by the raw ts string. A decision ts with a non-UTC
// offset normalizes to an instant this reading is safely before, but its raw
// string ("2026-08-04...") would sort before a "2026-08-05..." reading once
// merged back into the journal — so the baseline must fall back to the epoch
// rather than risk a resolution reading as pre-dating it.
const offsetDecision = implicitAuditBaseline([resolved("01OFFSET", "F-1", "2026-08-04T23:00:00-02:00")], SECTION, LIBRARY);
check(
  "a decision ts with a non-UTC offset can't be trusted to sort correctly downstream, so the baseline falls back to the epoch",
  offsetDecision.ts === EPOCH,
  offsetDecision.ts,
);

// A decision ts at the very edge of what `Date` can represent: one ms earlier
// falls outside the representable range, and `toISOString()` would throw.
const MIN_DATE = new Date(-8640000000000000).toISOString();
const extremeDecision = implicitAuditBaseline([resolved("01MIN", "F-1", MIN_DATE)], SECTION, LIBRARY);
check(
  "a decision ts at the edge of the representable range never throws computing 1 ms before it",
  extremeDecision !== null && extremeDecision.ts === EPOCH,
  extremeDecision && extremeDecision.ts,
);

// --- the revert shows up in counts, not scores ----------------------------------

const liveMatrix = deriveQualityMatrix({ quality: SECTION }, LIBRARY);
const live = liveMatrix.matrix.SEC.web;
check("precondition: the live matrix has F-1 resolved, so the cell is uncapped", live.capped === false, JSON.stringify(live));
const atAudit = deriveQualityMatrix(
  { quality: { ...SECTION, findings: SECTION.findings.map((f) => (f.id === "F-1" ? { ...f, status: "open" } : f)) } },
  LIBRARY,
).matrix.SEC.web;
check("precondition: with F-1 open the cell is capped", atAudit.capped === true, JSON.stringify(atAudit));
check(
  "the baseline's score for the cell matches the audit's own score",
  baseline.scores.web.SEC === atAudit.score,
  JSON.stringify({ baselineScore: baseline.scores.web.SEC, atAuditScore: atAudit.score }),
);
check(
  "auditCompletedInput records each cell's pre-cap score already, so the revert is observable only through counts, not scores",
  baseline.counts.critical === 1 && liveMatrix.finding_counts.critical === 0,
  JSON.stringify({ baselineCounts: baseline.counts, liveCounts: liveMatrix.finding_counts }),
);
check("the input section is not mutated", SECTION.findings[0].status === "resolved" && SECTION.findings[0].resolved_by === "https://pr/1");

// A resolved finding with no decision event naming it must stay resolved, not
// be swept back to open along with the ones a decision actually names.
const F3_SECTION = {
  ...SECTION,
  findings: [...SECTION.findings, finding("F-3", "SEC-02", { status: "resolved", resolved_by: "https://pr/3", impact: 4, likelihood: 4 })],
};
const f3Baseline = implicitAuditBaseline(JOURNAL, F3_SECTION, LIBRARY);
check(
  "a resolved finding with no decision event stays resolved, not reverted",
  f3Baseline.counts.high === 0,
  JSON.stringify(f3Baseline.counts),
);

// `quality.finding.accepted` is a decision too — an accepted-risk finding a
// decision names reopens exactly like a resolved one.
const ACCEPTED_SECTION = {
  ...SECTION,
  findings: [...SECTION.findings, finding("F-4", "SEC-01", { status: "accepted-risk", impact: 5, likelihood: 5 })],
};
const acceptedBaseline = implicitAuditBaseline([accepted("01ACC", "F-4", "2026-08-21T00:00:00.000Z")], ACCEPTED_SECTION, LIBRARY);
check(
  "an accepted-risk decision reopens its finding too, so the baseline counts it as open",
  acceptedBaseline.counts.critical === 1,
  JSON.stringify(acceptedBaseline.counts),
);

// --- what it unlocks -------------------------------------------------------------

const augmented = withImplicitBaseline(JOURNAL, SECTION, LIBRARY);
check("withImplicitBaseline prepends it", augmented[0] === undefined ? false : augmented[0].id === "implicit-baseline:2026-08" && augmented.length === JOURNAL.length + 1);
check("withImplicitBaseline hands back the same array when there is none", withImplicitBaseline(JOURNAL, { ...SECTION, assessments: [] }, LIBRARY) === JOURNAL);
check("the baseline counts as recorded", recordedAuditIds(augmented).join() === "2026-08");

const scope = deriveAuditScope(augmented, SECTION, LIBRARY);
check(
  "the scope measures from it and lists the resolved finding's cell",
  scope.since === "2026-08" && scope.cells.map((c) => `${c.criterion_id}:${c.kind}`).join() === "SEC-01:direct" && scope.findings.join() === "F-1",
  JSON.stringify(scope),
);
check("without it, the scope was empty (the bug)", deriveAuditScope(JOURNAL, SECTION, LIBRARY).since === null);

const trend = deriveQualityTrend(augmented, SECTION.profile);
check("the trend's first row is the baseline", trend.snapshots.length === 1 && trend.snapshots[0].audit_id === "2026-08" && trend.snapshots[0].baseline === true, JSON.stringify(trend.snapshots));

// --- framework_version precedence -------------------------------------------------

check("framework_version falls back to the pack's when the audit itself recorded none", baseline.framework_version === "1.4.0", baseline.framework_version);

const NO_VERSION_LIBRARY = { domains: LIBRARY.domains, criteria: LIBRARY.criteria };
const versionedBaseline = implicitAuditBaseline(JOURNAL, { ...SECTION, framework_version: "9.9.9" }, NO_VERSION_LIBRARY);
check(
  "framework_version reads what the audit itself recorded before falling back to the pack's",
  versionedBaseline.framework_version === "9.9.9",
  versionedBaseline.framework_version,
);

// --- the envelope --------------------------------------------------------------

const payload = baselineEventPayload(baseline);
check(
  "baselineEventPayload strips the envelope and keeps the reading",
  !("id" in payload) && !("ts" in payload) && !("type" in payload) && payload.audit_id === "2026-08" && payload.baseline === true && payload.scores.web.SEC === baseline.scores.web.SEC,
  JSON.stringify(payload),
);

console.log(`\n${failures === 0 ? "All" : failures} ${failures === 0 ? "checks passed" : "check(s) failed"}`);
process.exit(failures ? 1 : 0);

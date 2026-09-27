#!/usr/bin/env node

/**
 * The implicit baseline (issue #472): a hosted project whose audit arrived by
 * `arkaik restore` has assessments but no recorded reading, so the scope and
 * the trend had nothing to measure from. Pure and DB-free.
 *
 * The pack's severity scale is the schema default, so the cap assertions below
 * test the status revert, not arithmetic: an open impact-5 x likelihood-5
 * finding is Critical and caps its cell; resolved, it doesn't.
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

const baseline = implicitAuditBaseline(JOURNAL, SECTION, LIBRARY);
check("a restored, unrecorded audit gets a baseline", baseline !== null, JSON.stringify(baseline));

// --- which and when ------------------------------------------------------------

check("it reads the newest stored audit", baseline.audit_id === "2026-08", baseline.audit_id);
check("it is dated when that audit was taken (its newest assessment)", baseline.ts === "2026-08-05T10:00:00.000Z", baseline.ts);
check("it is flagged baseline, has a stable id and no actor", baseline.baseline === true && baseline.id === "implicit-baseline:2026-08" && !("actor" in baseline));
check("framework_version falls back to the pack's", baseline.framework_version === "1.4.0", baseline.framework_version);

const late = implicitAuditBaseline([resolved("01EARLY", "F-1", "2026-08-05T00:00:00.000Z")], SECTION, LIBRARY);
check(
  "an assessment newer than the first decision is capped to 1 ms before it — no resolution falls out of the window",
  late.ts === "2026-08-04T23:59:59.999Z",
  late.ts,
);
const noTs = implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no assessment ts → 1 ms before the first decision", noTs.ts === "2026-08-19T23:59:59.999Z", noTs.ts);
const nothing = implicitAuditBaseline([], { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no ts and no decision → the epoch", nothing.ts === "1970-01-01T00:00:00.000Z", nothing.ts);
const badTs = implicitAuditBaseline([resolved("01BAD", "F-1", "not a date")], SECTION, LIBRARY);
check("an unparsable decision ts → the epoch, never after the decision", badTs.ts === "1970-01-01T00:00:00.000Z", badTs.ts);

// --- the scores are the audit's, not today's -----------------------------------

const live = deriveQualityMatrix({ quality: SECTION }, LIBRARY).matrix.SEC.web;
check("precondition: the live matrix has F-1 resolved, so the cell is uncapped", live.capped === false, JSON.stringify(live));
const atAudit = deriveQualityMatrix(
  { quality: { ...SECTION, findings: SECTION.findings.map((f) => (f.id === "F-1" ? { ...f, status: "open" } : f)) } },
  LIBRARY,
).matrix.SEC.web;
check("precondition: with F-1 open the cell is capped", atAudit.capped === true, JSON.stringify(atAudit));
check(
  "the baseline scores the cell as it stood at the audit — F-1 open, capped",
  baseline.scores.web.SEC === atAudit.score && baseline.counts.critical === 1,
  JSON.stringify({ scores: baseline.scores, counts: baseline.counts }),
);
check("the input section is not mutated", SECTION.findings[0].status === "resolved" && SECTION.findings[0].resolved_by === "https://pr/1");

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

const payload = baselineEventPayload(baseline);
check(
  "baselineEventPayload strips the envelope and keeps the reading",
  !("id" in payload) && !("ts" in payload) && !("type" in payload) && payload.audit_id === "2026-08" && payload.baseline === true && payload.scores.web.SEC === baseline.scores.web.SEC,
  JSON.stringify(payload),
);

console.log(`\n${failures === 0 ? "All" : failures} ${failures === 0 ? "checks passed" : "check(s) failed"}`);
process.exit(failures ? 1 : 0);

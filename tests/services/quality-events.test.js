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
const { parseQualityEventInputs, planQualityEvents } = kritik;

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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);

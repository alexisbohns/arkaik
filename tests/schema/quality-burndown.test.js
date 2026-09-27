#!/usr/bin/env node

/**
 * The findings burndown (issue #441): the finding stream replayed into open
 * counts over time, re-baselined at each recorded audit.
 *
 * Pure and fs-free, so this runs in CI's fast build job beside the other
 * quality suites. The golden at the end restores the Pebbles pilot the way a
 * hosted project receives it — findings with no `opened` event behind them —
 * and asserts two closes move the line by exactly their own severities.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const {
  deriveFindingsBurndown,
  openTotal,
  findingOpenedInput,
  findingResolvedInput,
  makeEvent,
  severityOf,
  withImplicitBaseline,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const counts = (over = {}) => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, ...over });

let counter = 0;
const stamp = (day) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const ev = (day, type, payload) => ({ id: `01EVT${String(++counter).padStart(4, "0")}`, ts: stamp(day), type, ...payload });
const opened = (day, id, severity, surface = "web", criterion_id = "SEC-01") =>
  ev(day, "quality.finding.opened", { finding_id: id, severity, priority: "P2", surface, criterion_id, title: id });
const resolved = (day, id) => ev(day, "quality.finding.resolved", { finding_id: id });
const accepted = (day, id) => ev(day, "quality.finding.accepted", { finding_id: id, reason: "owned" });
const audit = (day, auditId, c) => ev(day, "quality.audit.completed", { audit_id: auditId, framework_version: "1.0.0", counts: c });

// --- empty -------------------------------------------------------------------

const empty = deriveFindingsBurndown([]);
check("an empty journal is an empty burndown", eq(empty, { points: [], opened: 0, resolved: 0, accepted: 0, since: null }), JSON.stringify(empty));
check("no journal at all is the same empty burndown", eq(deriveFindingsBurndown(undefined), empty));

// --- arithmetic --------------------------------------------------------------

{
  const events = [
    opened(1, "F-1", "critical"),
    opened(2, "F-2", "high"),
    opened(3, "F-3", "high"),
    resolved(4, "F-2"),
    accepted(5, "F-1"),
  ];
  const b = deriveFindingsBurndown(events);
  check("one point per event", b.points.length === 5, String(b.points.length));
  check("opens fill their severity's bucket", eq(b.points[2].open, counts({ critical: 1, high: 2 })), JSON.stringify(b.points[2].open));
  check("a resolve empties the bucket it was opened in", eq(b.points[3].open, counts({ critical: 1, high: 1 })));
  check("an accept closes a finding too", eq(b.points[4].open, counts({ high: 1 })));
  check("each point names its cause", eq(b.points.map((p) => p.cause), [
    { type: "opened", id: "F-1" }, { type: "opened", id: "F-2" }, { type: "opened", id: "F-3" },
    { type: "resolved", id: "F-2" }, { type: "accepted", id: "F-1" },
  ]));
  check("totals count every open and close", b.opened === 3 && b.resolved === 1 && b.accepted === 1);
  check("no audit: no since", b.since === null);
  check("openTotal sums every bucket", openTotal(b.points[2].open) === 3);

  const shuffled = deriveFindingsBurndown([...events].reverse());
  check("replayed in ts order, not array order", eq(shuffled.points.map((p) => p.open), b.points.map((p) => p.open)));
}

// --- the stored severity wins over the finding's current one -----------------

{
  // The section would derive this finding as low; the event said critical at
  // the time, and a retuned pack must not rewrite that.
  const finding = { id: "F-9", criterion_id: "SEC-01", surface: "web", impact: 1, likelihood: 1, status: "open" };
  const b = deriveFindingsBurndown([opened(1, "F-9", "critical"), resolved(2, "F-9")], { findings: [finding] });
  check("an opened finding counts at the severity on its event", b.points[0].open.critical === 1 && b.points[0].open.low === 0, JSON.stringify(b.points[0].open));
  check("and closes out of that same bucket", eq(b.points[1].open, counts()));
}

// --- idempotence and reopening ----------------------------------------------

{
  const b = deriveFindingsBurndown([
    opened(1, "F-1", "medium"),
    opened(2, "F-1", "medium"),
    resolved(3, "F-1"),
    resolved(4, "F-1"),
    opened(5, "F-1", "medium"),
  ]);
  check("a re-run open of an open finding moves nothing", b.points.length === 3 && b.opened === 2, JSON.stringify(b.points.map((p) => p.cause)));
  check("a second close of a closed finding counts once", b.resolved === 1);
  check("an open after a close reopens it", b.points[2].cause.type === "opened" && b.points[2].open.medium === 1);
}

// --- a close nobody saw open -------------------------------------------------

{
  const b = deriveFindingsBurndown([opened(1, "F-1", "high"), resolved(2, "F-ghost"), accepted(3, "F-ghost-2")]);
  check("a resolve of an unknown id still counts", b.resolved === 1 && b.accepted === 1);
  check("and decrements nothing", eq(b.points[1].open, counts({ high: 1 })) && eq(b.points[2].open, counts({ high: 1 })));
  check("and still marks the series", b.points[1].cause.id === "F-ghost");
}

// --- re-baseline on audit ----------------------------------------------------

{
  const b = deriveFindingsBurndown([
    opened(1, "F-1", "high"),
    opened(2, "F-2", "high"),
    // One of the two was closed by hand; the audit's counts say so.
    audit(3, "2026-09", { high: 1, low: 4 }),
    resolved(4, "F-1"),
    opened(5, "F-3", "low"),
    accepted(6, "F-2"),
  ]);
  check("an audit re-baselines the open counts", eq(b.points[2].open, counts({ high: 1, low: 4 })), JSON.stringify(b.points[2].open));
  check("the audit point names the audit", eq(b.points[2].cause, { type: "audit", id: "2026-09" }));
  check("closes after the audit move off the re-based counts", eq(b.points[3].open, counts({ low: 4 })));
  check("and never below zero", eq(b.points[5].open, counts({ low: 5 })), JSON.stringify(b.points[5].open));
  check("since names the newest audit", b.since?.audit_id === "2026-09" && b.since.ts === stamp(3));
  check("since counts only what moved after it", b.since.opened === 1 && b.since.resolved === 1 && b.since.accepted === 1, JSON.stringify(b.since));
  check("whole-journal totals include what came before it", b.opened === 3);

  const garbled = deriveFindingsBurndown([opened(1, "F-1", "high"), audit(2, "2026-09", { high: "two", medium: -1, low: 2 })]);
  check("a malformed count bucket reads as zero", eq(garbled.points[1].open, counts({ low: 2 })), JSON.stringify(garbled.points[1].open));

  const later = deriveFindingsBurndown([audit(1, "2026-08", {}), resolved(2, "F-x"), audit(3, "2026-09", {})]);
  check("since moves to the newest audit and restarts its counters", later.since.audit_id === "2026-09" && later.since.resolved === 0 && later.resolved === 1);
}

// --- filters -----------------------------------------------------------------

{
  const events = [
    opened(1, "F-web-sec", "high", "web", "SEC-01"),
    opened(2, "F-api-sec", "critical", "api", "SEC-02"),
    opened(3, "F-web-prf", "low", "web", "PRF-01"),
    audit(4, "2026-09", { critical: 9, high: 9, low: 9 }),
    resolved(5, "F-web-sec"),
    resolved(6, "F-api-sec"),
    resolved(7, "F-unplaced"),
  ];
  const web = deriveFindingsBurndown(events, { surface: "web" });
  check("a surface filter keeps that surface's findings", web.opened === 2 && web.resolved === 1, JSON.stringify(web));
  check("a filtered view is never re-baselined from project-wide counts", eq(web.points.find((p) => p.cause.type === "audit").open, counts({ high: 1, low: 1 })));
  check("a filtered view still marks the audit", web.points.some((p) => p.cause.type === "audit"));
  check("a close that cannot be placed is left out of a filtered view", !web.points.some((p) => p.cause.id === "F-unplaced"));

  const sec = deriveFindingsBurndown(events, { domain: "SEC" });
  check("a domain filter reads the criterion's prefix", sec.opened === 2 && sec.resolved === 2, JSON.stringify(sec));
  check("and ends where its findings do", eq(sec.points[sec.points.length - 1].open, counts()));

  const both = deriveFindingsBurndown(events, { surface: "web", domain: "SEC" });
  check("surface and domain narrow together", both.opened === 1 && both.resolved === 1);

  const library = { criteria: [{ id: "SEC-01", domain: "AUTH" }] };
  const own = deriveFindingsBurndown(events, { domain: "AUTH", library });
  check("a criterion's own domain wins over its prefix", own.opened === 1 && own.points[0].cause.id === "F-web-sec", JSON.stringify(own.points.map((p) => p.cause)));
}

// --- findings no event opened -----------------------------------------------

{
  const findings = [
    { id: "F-r1", criterion_id: "SEC-01", surface: "web", impact: 5, likelihood: 5, cost: "S", status: "open" },
    { id: "F-r2", criterion_id: "PRF-01", surface: "api", impact: 2, likelihood: 2, cost: "S", status: "resolved" },
    { id: "F-r3", criterion_id: "SEC-01", surface: "web", impact: 3, likelihood: 3, cost: "S", status: "refuted" },
    { id: "F-early", criterion_id: "SEC-01", surface: "web", impact: 4, likelihood: 4, cost: "S", status: "resolved" },
  ];
  const sevR1 = severityOf(findings[0]);
  const sevR2 = severityOf(findings[1]);
  const events = [
    resolved(1, "F-early"),
    audit(2, "2026-08", counts({ [sevR1]: 1, [sevR2]: 1 })),
    resolved(3, "F-r2"),
  ];
  const b = deriveFindingsBurndown(events, { findings });
  check("a restored finding closed after the audit leaves its bucket", eq(b.points[2].open, counts({ [sevR1]: 1 })), JSON.stringify(b.points[2].open));

  const web = deriveFindingsBurndown(events, { findings, surface: "web" });
  check("a filtered view starts from the section's findings at the first audit", eq(web.points.find((p) => p.cause.type === "audit").open, counts({ [sevR1]: 1 })), JSON.stringify(web.points));
  check("a refuted finding is never seeded", !web.points.some((p) => openTotal(p.open) > 1));
  check("a finding closed before the first audit is not reopened by the seed", web.resolved === 1 && web.points[0].cause.id === "F-early" && openTotal(web.points[1].open) === 1);

  const api = deriveFindingsBurndown(events, { findings, surface: "api" });
  check("a restored finding's close is placed through the section", api.resolved === 1 && eq(api.points[api.points.length - 1].open, counts()), JSON.stringify(api.points));
  check("seeded findings are not counted as opened", api.opened === 0);
}

// --- noise -------------------------------------------------------------------

{
  const b = deriveFindingsBurndown([
    null,
    "not an event",
    { id: "x", ts: stamp(1), type: "journal.baseline", node_ids: ["V-a"] },
    { id: "y", ts: stamp(1), type: "quality.signal.tripped", criterion_id: "SEC-01", surface: "web", signal: "s" },
    { id: "z", ts: stamp(1), type: "node.created", node_id: "V-a" },
    { id: "w", ts: stamp(1), type: "quality.finding.resolved" },
    opened(2, "F-1", "urgent"),
  ]);
  check("journal.baseline, unknown types and id-less events are ignored", b.points.length === 1, JSON.stringify(b.points));
  check("an unknown severity is tracked but fills no bucket", b.opened === 1 && openTotal(b.points[0].open) === 0);
}

// --- the builders' own shapes ------------------------------------------------

{
  const finding = { id: "F-2026-09-SEC-web-01", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 4, cost: "S", status: "open" };
  const events = [
    makeEvent(findingOpenedInput(finding).type, findingOpenedInput(finding).payload, { ts: stamp(1) }),
    makeEvent(findingResolvedInput(finding).type, findingResolvedInput(finding).payload, { ts: stamp(2) }),
  ];
  const b = deriveFindingsBurndown(events, { surface: "web", domain: "SEC" });
  check("the events the tools write replay through the filters", b.opened === 1 && b.resolved === 1 && openTotal(b.points[0].open) === 1, JSON.stringify(b));
}

// --- golden: the pilot, restored ----------------------------------------------

{
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"));
  const library = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));
  const [a, b2] = fixture.section.findings;
  // What a hosted fold reads after two closes: the findings resolved in the
  // section, and the decisions in the journal — with no opened events at all.
  const section = {
    ...fixture.section,
    findings: fixture.section.findings.map((f) => (f.id === a.id || f.id === b2.id ? { ...f, status: "resolved" } : f)),
  };
  const journal = [
    { id: "01RES1", ts: "2026-09-02T00:00:00.000Z", type: "quality.finding.resolved", finding_id: a.id },
    { id: "01RES2", ts: "2026-09-03T00:00:00.000Z", type: "quality.finding.resolved", finding_id: b2.id },
  ];
  const events = withImplicitBaseline(journal, section, library);
  const burn = deriveFindingsBurndown(events, { findings: section.findings, library });
  const first = burn.points[0];
  const last = burn.points[burn.points.length - 1];
  check("the restored audit is the first point", first.cause.type === "audit" && openTotal(first.open) === fixture.section.findings.length, `${openTotal(first.open)}`);
  check("two closes take two findings off the line", openTotal(last.open) === fixture.section.findings.length - 2, `${openTotal(last.open)}`);
  const expected = { ...first.open };
  expected[severityOf(a, library)]--;
  expected[severityOf(b2, library)]--;
  check("each out of its own severity", eq(last.open, expected), JSON.stringify({ first: first.open, last: last.open }));
  check("both count as closed since the restored audit", burn.since?.resolved === 2);
}

console.log(failures === 0 ? "\nAll quality-burndown tests OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

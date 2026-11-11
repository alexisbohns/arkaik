#!/usr/bin/env node

/**
 * The scoped re-audit's work list (issue #443): which cells a batch of fixes
 * made stale since the last recorded audit.
 *
 * Pure and DB-free — the module imports nothing at runtime but `orderEvents`
 * and a constant — so this runs in CI's fast build job beside the other
 * quality suites.
 *
 * The library below is a test pack, not the shipped one, and its `applies_to`
 * lists are deliberately narrower than the profile: every cross-surface and
 * widening assertion would pass against a module that ignored `applies_to`
 * entirely if the pack applied everything everywhere.
 */

const { loadSchema } = require("./load-schema");
const {
  deriveAuditScope,
  isPlanRecord,
  recordedAuditIds,
  recordedPlans,
  recordedSinceIds,
  scopeAnchorId,
  scopeSummary,
  scopedAuditId,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const LIBRARY = {
  version: "test-1.0",
  domains: [{ code: "SEC", name: "Security" }, { code: "A11Y", name: "Accessibility" }],
  criteria: [
    { id: "SEC-01", domain: "SEC", applies_to: ["web", "ios", "supabase"] },
    { id: "SEC-02", domain: "SEC", applies_to: ["supabase"] },
    { id: "SEC-03", domain: "SEC", applies_to: ["web", "ios"] },
    { id: "SEC-09", domain: "SEC", applies_to: ["web"], superseded_by: "SEC-03" },
    { id: "A11Y-01", domain: "A11Y", applies_to: ["web", "ios"] },
    { id: "A11Y-02", domain: "A11Y" }, // no applies_to: everywhere
  ],
};

const PROFILE = { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }, { id: "supabase", title: "DB" }] };

const assess = (criterion, surface, level, audit = "2026-08") => ({
  criterion_id: criterion, surface, level, evidence: "e", audit_id: audit, ts: `${audit}-01T00:00:00.000Z`,
});
const find = (id, criterion, surface, over = {}) => ({
  id, criterion_id: criterion, surface, title: `t ${id}`, detail: "d", evidence: "e",
  impact: 3, likelihood: 3, cost: "M", status: "resolved", ...over,
});

let seq = 0;
const ev = (type, ts, payload = {}) => ({ id: `01EV${String(++seq).padStart(4, "0")}`, ts, type, actor: "test", ...payload });
const audit = (auditId, ts, payload = {}) => ev("quality.audit.completed", ts, { audit_id: auditId, framework_version: "1.0.0", ...payload });
const resolved = (findingId, ts, payload = {}) => ev("quality.finding.resolved", ts, { finding_id: findingId, ...payload });

const SECTION = {
  profile: PROFILE,
  assessments: [
    assess("SEC-01", "web", 2),
    assess("SEC-01", "ios", 2),
    assess("SEC-03", "web", 1),
    assess("A11Y-01", "web", 2),
    assess("A11Y-01", "ios", 3),
    assess("A11Y-02", "supabase", 2),
    assess("SEC-09", "web", 1),
  ],
  findings: [
    find("F-1", "SEC-01", "web", { node_ids: ["V-home"] }),
    find("F-2", "SEC-03", "web", { status: "open", node_ids: ["V-home", "V-login"] }),
    find("F-3", "A11Y-01", "ios", { status: "open", node_ids: ["V-settings"] }),
    find("F-4", "SEC-09", "web", { status: "open", node_ids: ["V-home"] }),
    find("F-5", "A11Y-01", "web", { status: "accepted-risk" }),
    find("F-6", "SEC-01", "cross-surface"),
    find("F-7", "A11Y-02", "supabase", { status: "open", node_ids: ["V-login"] }),
  ],
};

const cellIds = (scope) => scope.cells.map((cell) => `${cell.surface}:${cell.criterion_id}:${cell.kind}`);

// --- empty ------------------------------------------------------------------

{
  const none = deriveAuditScope([], SECTION, LIBRARY);
  check("no events is an empty scope, not a throw", none.cells.length === 0 && none.findings.length === 0 && none.since === null);

  const noAudit = deriveAuditScope([resolved("F-1", "2026-09-01T00:00:00.000Z")], SECTION, LIBRARY);
  check(
    "a resolution with no recorded audit before it scopes nothing",
    noAudit.cells.length === 0 && noAudit.since === null && noAudit.since_ts === null,
    JSON.stringify(noAudit),
  );

  const quiet = deriveAuditScope([audit("2026-08", "2026-08-31T00:00:00.000Z")], SECTION, LIBRARY);
  check(
    "an audit with nothing resolved since still says what it measured from",
    quiet.cells.length === 0 && quiet.since === "2026-08" && quiet.since_ts === "2026-08-31T00:00:00.000Z",
    JSON.stringify(quiet),
  );

  const bare = deriveAuditScope(
    [audit("2026-08", "2026-08-31T00:00:00.000Z"), resolved("F-1", "2026-09-01T00:00:00.000Z")],
    { assessments: [], findings: [] },
    { criteria: [] },
  );
  check("no findings makes every resolution unknown, never a throw", bare.cells.length === 0 && bare.unknown[0] === "F-1", JSON.stringify(bare));

  let threw = false;
  try {
    deriveAuditScope(null, undefined, undefined);
    deriveAuditScope([null, 7, { type: "quality.audit.completed" }, { type: "quality.finding.resolved", ts: "z", finding_id: "F-1" }], { assessments: "x", findings: {}, profile: { surfaces: 3 } }, { criteria: null });
  } catch (error) {
    threw = error;
  }
  check("malformed input degrades rather than throws", threw === false, String(threw));
}

// --- direct cells -----------------------------------------------------------

{
  const events = [
    audit("2026-08", "2026-08-31T00:00:00.000Z"),
    resolved("F-1", "2026-09-02T00:00:00.000Z", { resolved_by: "https://github.com/o/r/pull/1" }),
  ];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("a resolved finding scopes its own cell", cellIds(scope).join() === "web:SEC-01:direct", cellIds(scope).join());
  check("the direct cell says which finding put it there", scope.cells[0].because.join() === "F-1");
  check("the driving finding is listed", scope.findings.join() === "F-1");
  check("the resolving PR is kept for the run sheet", scope.resolved_by["F-1"] === "https://github.com/o/r/pull/1");
  check("the score a re-score would replace comes along", scope.cells[0].current?.level === 2 && scope.cells[0].current?.audit_id === "2026-08");
  check("nothing was widened with widening off", scope.widened === 0);
}

// --- the window: since, default and explicit ---------------------------------

{
  const events = [
    audit("2026-07", "2026-07-31T00:00:00.000Z"),
    resolved("F-6", "2026-08-10T00:00:00.000Z"),
    audit("2026-08", "2026-08-31T00:00:00.000Z"),
    resolved("F-1", "2026-09-02T00:00:00.000Z"),
  ];
  // Shuffled: the window is decided by orderEvents (ts, then id), never by
  // the array's own order.
  const shuffled = [events[3], events[1], events[2], events[0]];

  const latest = deriveAuditScope(shuffled, SECTION, LIBRARY, { widen: false });
  check("since defaults to the newest recorded audit", latest.since === "2026-08", latest.since);
  check(
    "a resolution before that audit is already in its scores",
    latest.findings.join() === "F-1" && !latest.findings.includes("F-6"),
    latest.findings.join(),
  );

  const older = deriveAuditScope(shuffled, SECTION, LIBRARY, { since: "2026-07", widen: false });
  check("an explicit since widens the window back to that audit", older.since === "2026-07" && older.findings.join() === "F-6,F-1", older.findings.join());

  const never = deriveAuditScope(shuffled, SECTION, LIBRARY, { since: "2026-01" });
  check(
    "a since that was never recorded is an empty scope that says so",
    never.cells.length === 0 && never.since === "2026-01" && never.since_ts === null,
    JSON.stringify(never),
  );

  const rerecorded = deriveAuditScope(
    [
      audit("2026-08", "2026-08-31T00:00:00.000Z"),
      resolved("F-1", "2026-09-02T00:00:00.000Z"),
      audit("2026-08", "2026-09-03T00:00:00.000Z"),
    ],
    SECTION,
    LIBRARY,
    { since: "2026-08" },
  );
  check(
    "a re-recorded audit is measured from its latest recording",
    rerecorded.cells.length === 0 && rerecorded.since_ts === "2026-09-03T00:00:00.000Z",
    JSON.stringify(rerecorded),
  );

  check("recordedAuditIds lists each recorded audit once, in recording order", recordedAuditIds([...shuffled, audit("2026-07", "2026-09-09T00:00:00.000Z")]).join() === "2026-07,2026-08");
}

// --- accepted and unknown ----------------------------------------------------

{
  const events = [
    audit("2026-08", "2026-08-31T00:00:00.000Z"),
    ev("quality.finding.accepted", "2026-09-01T00:00:00.000Z", { finding_id: "F-3", reason: "owned" }),
    resolved("F-5", "2026-09-02T00:00:00.000Z"),
    resolved("F-404", "2026-09-03T00:00:00.000Z"),
  ];
  // Precondition, so the next check cannot pass vacuously: F-3 IS scopable —
  // resolving it puts its cell in scope. Only the accepted event must not.
  const ifResolved = deriveAuditScope([events[0], resolved("F-3", "2026-09-01T00:00:00.000Z")], SECTION, LIBRARY, { widen: false });
  check("(precondition) resolving F-3 would scope its cell", cellIds(ifResolved).join() === "ios:A11Y-01:direct", cellIds(ifResolved).join());

  const scope = deriveAuditScope(events, SECTION, LIBRARY);
  check("an accepted event scopes nothing — the code did not change", !cellIds(scope).some((id) => id.includes("A11Y-01")), cellIds(scope).join());
  check("a finding the section holds as accepted-risk is not a fix either", !scope.findings.includes("F-5"), scope.findings.join());
  check("a resolved id naming no finding is reported, not dropped", scope.unknown.join() === "F-404", scope.unknown.join());
  check("an unknown id drives no cell", scope.cells.length === 0, cellIds(scope).join());
}

// --- cross-surface ------------------------------------------------------------

{
  const events = [audit("2026-08", "2026-08-31T00:00:00.000Z"), resolved("F-6", "2026-09-02T00:00:00.000Z")];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check(
    "a contract finding scopes every surface its criterion applies to, in profile order",
    cellIds(scope).join() === "web:SEC-01:direct,ios:SEC-01:direct,supabase:SEC-01:direct",
    cellIds(scope).join(),
  );
  check("the contract lens never becomes a column of its own", !scope.cells.some((cell) => cell.surface === "cross-surface"));

  const narrow = deriveAuditScope(
    events,
    { ...SECTION, findings: [find("F-6", "SEC-03", "cross-surface")] },
    LIBRARY,
    { widen: false },
  );
  check(
    "applies_to is read from the pack, not assumed",
    cellIds(narrow).join() === "web:SEC-03:direct,ios:SEC-03:direct",
    cellIds(narrow).join(),
  );

  const oneSurface = deriveAuditScope(events, { ...SECTION, profile: { surfaces: [{ id: "ios", title: "iOS" }] } }, LIBRARY, { widen: false });
  check("and only across the surfaces this project declared", cellIds(oneSurface).join() === "ios:SEC-01:direct", cellIds(oneSurface).join());
}

// --- widening -------------------------------------------------------------------

{
  const events = [audit("2026-08", "2026-08-31T00:00:00.000Z"), resolved("F-1", "2026-09-02T00:00:00.000Z")];
  const scope = deriveAuditScope(events, SECTION, LIBRARY);
  const widened = scope.cells.filter((cell) => cell.kind === "widened");
  check(
    "a neighbour sharing a node with the fix is widened in",
    widened.some((cell) => cell.criterion_id === "SEC-03" && cell.surface === "web"),
    cellIds(scope).join(),
  );
  check(
    "a widened cell says which node put it there",
    widened.find((cell) => cell.criterion_id === "SEC-03")?.because.join() === "V-home",
    JSON.stringify(widened),
  );
  check("a retired criterion is never widened into — score would refuse it", !widened.some((cell) => cell.criterion_id === "SEC-09"), cellIds(scope).join());
  check(
    "the hop stops at one: V-login's other neighbour is not pulled in",
    !scope.cells.some((cell) => cell.criterion_id === "A11Y-02"),
    cellIds(scope).join(),
  );
  check("a cell sharing no node stays out", !scope.cells.some((cell) => cell.criterion_id === "A11Y-01"), cellIds(scope).join());
  check("widened counts only the hop's own cells", scope.widened === widened.length && scope.widened === 1, String(scope.widened));

  const off = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("widen: false keeps the scope exact", off.cells.length === 1 && off.widened === 0, cellIds(off).join());

  const viaEvent = deriveAuditScope(
    [audit("2026-08", "2026-08-31T00:00:00.000Z"), resolved("F-6", "2026-09-02T00:00:00.000Z", { node_ids: ["V-settings"] })],
    SECTION,
    LIBRARY,
  );
  check(
    "node ids carried on the resolved event widen too",
    viaEvent.cells.some((cell) => cell.kind === "widened" && cell.criterion_id === "A11Y-01" && cell.surface === "ios"),
    cellIds(viaEvent).join(),
  );

  const unassessed = deriveAuditScope(
    events,
    { ...SECTION, assessments: SECTION.assessments.filter((a) => a.criterion_id !== "SEC-03") },
    LIBRARY,
  );
  check("only an assessed cell is widened into — there is nothing to re-score otherwise", unassessed.widened === 0, cellIds(unassessed).join());

  const notApplicable = deriveAuditScope(
    events,
    { ...SECTION, assessments: [...SECTION.assessments, assess("SEC-02", "web", 1)], findings: [...SECTION.findings, find("F-8", "SEC-02", "web", { status: "open", node_ids: ["V-home"] })] },
    LIBRARY,
  );
  check("a cell whose criterion does not apply to its surface is not widened into", !notApplicable.cells.some((cell) => cell.criterion_id === "SEC-02"), cellIds(notApplicable).join());
}

// --- unscorable: cells score would refuse ----------------------------------------

{
  const section = {
    ...SECTION,
    findings: [
      ...SECTION.findings,
      find("F-9", "SEC-01", "android"),
      find("F-10", "SEC-02", "cross-surface", { status: "open" }),
    ],
  };
  const events = [
    audit("2026-08", "2026-08-31T00:00:00.000Z"),
    resolved("F-4", "2026-09-01T00:00:00.000Z"), // SEC-09 is retired
    resolved("F-9", "2026-09-02T00:00:00.000Z"), // android is not declared
    resolved("F-10", "2026-09-03T00:00:00.000Z"), // SEC-02 applies to supabase only…
  ];
  const narrowProfile = { ...section, profile: { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }] } };
  const scope = deriveAuditScope(events, narrowProfile, LIBRARY);
  check(
    "a resolved finding on a retired criterion is not a cell — score would refuse it",
    !scope.cells.some((cell) => cell.criterion_id === "SEC-09" && cell.kind === "direct") && scope.unscorable.includes("F-4"),
    JSON.stringify({ cells: cellIds(scope), unscorable: scope.unscorable }),
  );
  check("nor is one on a surface the profile does not declare", scope.unscorable.includes("F-9") && !cellIds(scope).some((id) => id.startsWith("android")));
  check(
    "nor a contract finding whose criterion reaches none of the declared surfaces",
    scope.unscorable.includes("F-10") && !cellIds(scope).some((id) => id.includes("SEC-02")),
    JSON.stringify(scope.unscorable),
  );
  check("an unscorable finding is not counted as a driver", !scope.findings.some((id) => ["F-4", "F-9", "F-10"].includes(id)), scope.findings.join());
  check(
    "but its fix still widens: the retired finding's V-home reaches SEC-03 x web",
    scope.cells.some((cell) => cell.criterion_id === "SEC-03" && cell.surface === "web" && cell.kind === "widened"),
    cellIds(scope).join(),
  );
  check("the empty scope carries an empty unscorable list", Array.isArray(deriveAuditScope([], SECTION, LIBRARY).unscorable));
}

// --- resolution details -----------------------------------------------------------

{
  const events = [
    audit("2026-08", "2026-08-31T00:00:00.000Z"),
    resolved("F-1", "2026-09-01T00:00:00.000Z", { resolved_by: "https://pr/1" }),
    resolved("F-1", "2026-09-02T00:00:00.000Z"),
    resolved("F-1", "2026-09-03T00:00:00.000Z", { resolved_by: "https://pr/2" }),
  ];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("a finding resolved three times drives one cell once", scope.findings.join() === "F-1" && scope.cells[0].because.join() === "F-1");
  check("the latest named resolver wins, an unnamed one never erases it", scope.resolved_by["F-1"] === "https://pr/2", scope.resolved_by["F-1"]);
}

// --- immutability and the summary --------------------------------------------------

{
  const events = [audit("2026-08", "2026-08-31T00:00:00.000Z"), resolved("F-1", "2026-09-02T00:00:00.000Z"), resolved("F-6", "2026-09-02T00:00:01.000Z")];
  const before = JSON.stringify([events, SECTION, LIBRARY]);
  const scope = deriveAuditScope(events, SECTION, LIBRARY);
  check("nothing is mutated", JSON.stringify([events, SECTION, LIBRARY]) === before);
  check(
    "the summary counts cells, splits direct from widened, and names the audit",
    scopeSummary(scope) === "4 cells to re-score (3 direct, 1 widened) from 2 resolved findings since 2026-08",
    scopeSummary(scope),
  );
  check(
    "a summary with no widening says nothing about it",
    scopeSummary(deriveAuditScope(events.slice(0, 2), SECTION, LIBRARY, { widen: false })) === "1 cell to re-score from 1 resolved finding since 2026-08",
  );
}

// --- no plan record: exactly as before ------------------------------------------
//
// The two literals were printed by deriveAuditScope on main, before the planner
// existed, over this same journal: a July audit, a scoped re-audit's
// record, a re-resolved finding, an unknown id, a retired criterion, an
// accepted risk, a cross-surface finding and event-carried node ids. Every
// change the planner makes to the scope must leave them byte-identical.

const NO_PLAN_JOURNAL = [
  audit("2026-07", "2026-07-31T00:00:00.000Z"),
  resolved("F-7", "2026-08-05T00:00:00.000Z"),
  audit("2026-08", "2026-08-31T00:00:00.000Z"),
  audit("2026-09-scoped", "2026-09-01T00:00:00.000Z", { scope: { partial: true, cells: 1, since: "2026-08" } }),
  resolved("F-1", "2026-09-02T00:00:00.000Z", { resolved_by: "https://pr/1" }),
  resolved("F-3", "2026-09-03T00:00:00.000Z", { node_ids: ["V-login"] }),
  resolved("F-4", "2026-09-04T00:00:00.000Z"),
  resolved("F-5", "2026-09-05T00:00:00.000Z"),
  resolved("F-404", "2026-09-06T00:00:00.000Z"),
  resolved("F-6", "2026-09-07T00:00:00.000Z", { resolved_by: "https://pr/6" }),
  resolved("F-1", "2026-09-08T00:00:00.000Z"),
];
const NO_PLAN_SHUFFLED = [...NO_PLAN_JOURNAL].reverse();
const GOLDEN_DEFAULT =
  "{\"since\":\"2026-09-scoped\",\"since_ts\":\"2026-09-01T00:00:00.000Z\",\"cells\":[{\"criterion_id\":\"SEC-01\",\"surface\":\"web\",\"kind\":\"direct\",\"because\":[\"F-1\",\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-03\",\"surface\":\"web\",\"kind\":\"widened\",\"because\":[\"V-home\",\"V-login\"],\"current\":{\"level\":1,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-3\"],\"current\":{\"level\":3,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-02\",\"surface\":\"supabase\",\"kind\":\"widened\",\"because\":[\"V-login\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-6\"]}],\"findings\":[\"F-1\",\"F-3\",\"F-6\"],\"resolved_by\":{\"F-1\":\"https://pr/1\",\"F-6\":\"https://pr/6\"},\"unknown\":[\"F-404\"],\"unscorable\":[\"F-4\"],\"widened\":2}";
const GOLDEN_SINCE_JULY =
  "{\"since\":\"2026-07\",\"since_ts\":\"2026-07-31T00:00:00.000Z\",\"cells\":[{\"criterion_id\":\"SEC-01\",\"surface\":\"web\",\"kind\":\"direct\",\"because\":[\"F-1\",\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-03\",\"surface\":\"web\",\"kind\":\"widened\",\"because\":[\"V-home\",\"V-login\"],\"current\":{\"level\":1,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-3\"],\"current\":{\"level\":3,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-02\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-7\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-6\"]}],\"findings\":[\"F-7\",\"F-1\",\"F-3\",\"F-6\"],\"resolved_by\":{\"F-1\":\"https://pr/1\",\"F-6\":\"https://pr/6\"},\"unknown\":[\"F-404\"],\"unscorable\":[\"F-4\"],\"widened\":1}";

{
  check(
    "no plan record: the default scope is byte-identical to main's",
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY)) === GOLDEN_DEFAULT,
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY)),
  );
  check(
    "no plan record: an explicit since is byte-identical to main's",
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY, { since: "2026-07" })) === GOLDEN_SINCE_JULY,
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY, { since: "2026-07" })),
  );
  check(
    "no plan record: recordedAuditIds is unchanged",
    recordedAuditIds(NO_PLAN_SHUFFLED).join() === "2026-07,2026-08,2026-09-scoped",
    recordedAuditIds(NO_PLAN_SHUFFLED).join(),
  );
}

// --- plan records (the Kritik planner): reading them ----------------------------
//
// A plan record is a `quality.audit.completed` whose `scope` names a plan
// (stack contract, "The recorded event"). Built by hand here: this suite needs
// only the event's shape, not the command that writes it.

const PLAN = "2026-09-zplan-1000";
const PART_SEC_WEB = `${PLAN}-sec-web`;
const PART_A11Y_IOS = `${PLAN}-a11y-ios`;
const planRecord = (planId, ts, scored, parts = [`${planId}-sec-web`]) =>
  audit(planId, ts, {
    scope: {
      partial: true,
      cells: scored.length,
      since: "2026-08",
      plan: planId,
      parts,
      scored,
      coverage: { scored: scored.length, assessed: 7, applicable: 12, surfaces: { web: { assessed: 4, applicable: 5 } } },
    },
  });
const T = (day, hour = 0) => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const AUG = () => audit("2026-08", "2026-08-31T00:00:00.000Z");

{
  const record = planRecord(PLAN, T(10), ["SEC-01::web", "A11Y-01::ios"], [PART_SEC_WEB, PART_A11Y_IOS]);
  const scopedRecord = audit("2026-09-scoped", T(11), { scope: { partial: true, cells: 1, since: "2026-08" } });
  check("a plan record is one", isPlanRecord(record) === true);
  check("a scoped re-audit's record is not a plan record", isPlanRecord(scopedRecord) === false);
  check("a plain record is not a plan record", isPlanRecord(AUG()) === false);
  check("a scope.plan on any other event type is not a plan record", isPlanRecord(resolved("F-1", T(10), { scope: { plan: PLAN } })) === false);
  check(
    "an empty or missing plan id is not a plan record, and nothing malformed throws",
    [null, undefined, 7, "x", {}, audit(PLAN, T(10), { scope: { plan: "" } }), audit(PLAN, T(10), { scope: null })].every(
      (value) => isPlanRecord(value) === false,
    ),
  );

  const journal = [record, AUG(), scopedRecord];
  check(
    "recordedAuditIds returns each plan record's parts right after its plan id",
    recordedAuditIds(journal).join() === `2026-08,${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS},2026-09-scoped`,
    recordedAuditIds(journal).join(),
  );
  check(
    "a part named by two records is listed once",
    recordedAuditIds([...journal, planRecord("2026-09-zplan-1100", T(12), ["SEC-03::web"], [PART_SEC_WEB])]).join() ===
      `2026-08,${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS},2026-09-scoped,2026-09-zplan-1100`,
  );
  check("recordedSinceIds leaves plan ids and part ids out", recordedSinceIds(journal).join() === "2026-08,2026-09-scoped", recordedSinceIds(journal).join());

  const plans = recordedPlans(journal);
  check(
    "recordedPlans reads the plan, its parts, its scored cells and when",
    plans.length === 1 &&
      plans[0].plan === PLAN &&
      plans[0].parts.join() === `${PART_SEC_WEB},${PART_A11Y_IOS}` &&
      plans[0].scored.join() === "SEC-01::web,A11Y-01::ios" &&
      plans[0].ts === T(10),
    JSON.stringify(plans),
  );
  check(
    "recordedPlans keeps journal order, not array order",
    recordedPlans([planRecord("2026-09-zplan-1100", T(12), ["SEC-03::web"]), record]).map((plan) => plan.plan).join() ===
      `${PLAN},2026-09-zplan-1100`,
  );
  check("the readers never throw on malformed rows", recordedAuditIds([null, 7, record]).join() === `${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS}`);

  check("no plan record: recordedPlans is empty", recordedPlans(NO_PLAN_SHUFFLED).length === 0);
  check(
    "no plan record: recordedSinceIds equals recordedAuditIds",
    recordedSinceIds(NO_PLAN_SHUFFLED).join() === recordedAuditIds(NO_PLAN_SHUFFLED).join(),
  );
}

// --- rule 1: a plan record is never the audit a scope is measured from ---------

{
  const events = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["A11Y-01::ios"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 1: since skips the plan record", scope.since === "2026-08" && scope.since_ts === "2026-08-31T00:00:00.000Z", JSON.stringify(scope));
  check("rule 1: a fix before the plan still counts for a cell the plan did not re-score", cellIds(scope).join() === "web:SEC-01:direct", cellIds(scope).join());
  check("rule 1: scopeAnchorId names the same audit", scopeAnchorId(events) === "2026-08", String(scopeAnchorId(events)));

  const onlyPlans = [planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-3", T(11))];
  const first = deriveAuditScope(onlyPlans, SECTION, LIBRARY);
  check(
    "rule 1: with only plan records there is nothing to measure from — an empty scope",
    first.since === null && first.since_ts === null && first.cells.length === 0 && first.findings.length === 0,
    JSON.stringify(first),
  );
  check("rule 1: scopeAnchorId is null with only plan records", scopeAnchorId(onlyPlans) === null);

  const byPlan = deriveAuditScope(events, SECTION, LIBRARY, { since: PLAN });
  check("rule 1: since naming a plan finds no anchor", byPlan.since === PLAN && byPlan.since_ts === null && byPlan.cells.length === 0, JSON.stringify(byPlan));
  const byPart = deriveAuditScope(events, SECTION, LIBRARY, { since: PART_SEC_WEB });
  check("rule 1: nor does since naming a part", byPart.since === PART_SEC_WEB && byPart.since_ts === null && byPart.cells.length === 0, JSON.stringify(byPart));

  check("no plan record: scopeAnchorId is the scope's since", scopeAnchorId(NO_PLAN_SHUFFLED) === "2026-09-scoped");
  check("scopeAnchorId of nothing is null, never a throw", scopeAnchorId([]) === null && scopeAnchorId(null) === null && scopeAnchorId([null, 7]) === null);
  check(
    "a plan record that re-scored nothing changes nothing",
    JSON.stringify(deriveAuditScope([...NO_PLAN_JOURNAL, planRecord(PLAN, "2026-09-09T00:00:00.000Z", [])], SECTION, LIBRARY)) === GOLDEN_DEFAULT,
    JSON.stringify(deriveAuditScope([...NO_PLAN_JOURNAL, planRecord(PLAN, "2026-09-09T00:00:00.000Z", [])], SECTION, LIBRARY)),
  );
}

// --- rules 2, 3, 4, 6 and 7: a resolution counts per cell ----------------------

// Rule 2: one clearing rule, in orderEvents order.
{
  const before = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check(
    "rule 2: a resolution before the plan that re-scored its cell no longer counts",
    deriveAuditScope(before, SECTION, LIBRARY, { widen: false }).cells.length === 0,
    cellIds(deriveAuditScope(before, SECTION, LIBRARY, { widen: false })).join(),
  );
  check(
    "rule 2: the journal's order decides, never the array's",
    deriveAuditScope([...before].reverse(), SECTION, LIBRARY, { widen: false }).cells.length === 0,
  );

  const after = [AUG(), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-1", T(11))];
  check(
    "rule 2: a resolution after the plan counts",
    cellIds(deriveAuditScope(after, SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );

  // Same ts: orderEvents falls back to the event id, and `ev` mints ids in call order.
  const tieResolved = resolved("F-1", T(10));
  const tiePlan = planRecord(PLAN, T(10), ["SEC-01::web"]);
  check(
    "rule 2: on a ts tie, the id order orderEvents uses decides",
    deriveAuditScope([AUG(), tiePlan, tieResolved], SECTION, LIBRARY, { widen: false }).cells.length === 0,
  );
  const tiePlanFirst = planRecord(PLAN, T(10), ["SEC-01::web"]);
  const tieResolvedSecond = resolved("F-1", T(10));
  check(
    "rule 2: and the other way round, a resolution whose id sorts after the plan's counts",
    cellIds(deriveAuditScope([AUG(), tieResolvedSecond, tiePlanFirst], SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );

  const twice = [AUG(), resolved("F-1", T(2), { resolved_by: "https://pr/1" }), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-1", T(11))];
  const again = deriveAuditScope(twice, SECTION, LIBRARY, { widen: false });
  check(
    "rule 2: a finding resolved before and after the plan counts by its latest resolution",
    cellIds(again).join() === "web:SEC-01:direct" && again.findings.join() === "F-1",
    JSON.stringify(again),
  );
  check("rule 2: its named resolver is still the latest named one", again.resolved_by["F-1"] === "https://pr/1", JSON.stringify(again.resolved_by));

  const explicit = [audit("2026-07", "2026-07-31T00:00:00.000Z"), AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check(
    "rule 2: with an explicit older since, a plan after it still clears the cells it re-scored",
    deriveAuditScope(explicit, SECTION, LIBRARY, { since: "2026-07", widen: false }).cells.length === 0,
    cellIds(deriveAuditScope(explicit, SECTION, LIBRARY, { since: "2026-07", widen: false })).join(),
  );

  const stale = [AUG(), planRecord(PLAN, T(1), ["SEC-01::web"]), audit("2026-09", T(5)), resolved("F-1", T(6))];
  check(
    "rule 2: a plan record before the anchor clears nothing after it",
    cellIds(deriveAuditScope(stale, SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );
}

// Rule 3: direct cells.
{
  const events = [AUG(), resolved("F-1", T(2)), resolved("F-3", T(3)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 3: the cell the plan re-scored leaves; the one it did not stays", cellIds(scope).join() === "ios:A11Y-01:direct", cellIds(scope).join());
  check("rule 3: the kept cell's because names its own finding", scope.cells[0]?.because.join() === "F-3", JSON.stringify(scope.cells));

  const section = { ...SECTION, findings: [...SECTION.findings, find("F-11", "SEC-01", "web")] };
  const mixed = deriveAuditScope(
    [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-11", T(11))],
    section,
    LIBRARY,
    { widen: false },
  );
  check(
    "rule 3: a listed cell's because holds only the findings that still count",
    cellIds(mixed).join() === "web:SEC-01:direct" && mixed.cells[0].because.join() === "F-11",
    JSON.stringify(mixed.cells),
  );
}

// Rule 4: a cross-surface finding fans out, then each cell is judged alone.
{
  const events = [AUG(), resolved("F-6", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check(
    "rule 4: a plan that re-scored web clears web and leaves the other surfaces listed",
    cellIds(scope).join() === "ios:SEC-01:direct,supabase:SEC-01:direct",
    cellIds(scope).join(),
  );
  check("rule 4: the finding still drives the cells it left", scope.findings.join() === "F-6", scope.findings.join());

  const all = deriveAuditScope(
    [AUG(), resolved("F-6", T(2)), planRecord(PLAN, T(10), ["SEC-01::web", "SEC-01::ios", "SEC-01::supabase"])],
    SECTION,
    LIBRARY,
    { widen: false },
  );
  check("rule 4: a plan that re-scored every surface clears the finding", all.cells.length === 0 && all.findings.length === 0, JSON.stringify(all));
}

// Rule 6: a cell can come back.
{
  const section = {
    ...SECTION,
    assessments: [...SECTION.assessments, assess("SEC-01", "web", 3, PART_SEC_WEB)],
    findings: [...SECTION.findings, find("F-11", "SEC-01", "web")],
  };
  const cleared = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check("rule 6 (precondition): the plan cleared SEC-01 x web", deriveAuditScope(cleared, section, LIBRARY, { widen: false }).cells.length === 0);

  const back = deriveAuditScope([...cleared, resolved("F-11", T(12))], section, LIBRARY, { widen: false });
  check("rule 6: a finding resolved after the plan makes the cell stale again", cellIds(back).join() === "web:SEC-01:direct", cellIds(back).join());
  check(
    "rule 6: the score it would replace is the plan part's",
    back.cells[0]?.current?.level === 3 && back.cells[0]?.current?.audit_id === PART_SEC_WEB,
    JSON.stringify(back.cells[0]),
  );

  const secondPlan = deriveAuditScope(
    [...cleared, resolved("F-11", T(12)), planRecord("2026-09-zplan-2000", T(20), ["SEC-01::web"])],
    section,
    LIBRARY,
    { widen: false },
  );
  check("rule 6: the LAST plan record that re-scored the cell is the one that counts", secondPlan.cells.length === 0, cellIds(secondPlan).join());

  const otherPlan = deriveAuditScope(
    [...cleared, resolved("F-11", T(12)), planRecord("2026-09-zplan-2000", T(20), ["SEC-03::web"])],
    section,
    LIBRARY,
    { widen: false },
  );
  check("rule 6: a later plan that did not re-score the cell leaves it listed", cellIds(otherPlan).join() === "web:SEC-01:direct", cellIds(otherPlan).join());
}

// Rule 7: the reported lists.
{
  const events = [
    AUG(),
    resolved("F-1", T(2), { resolved_by: "https://pr/1" }),
    resolved("F-3", T(3), { resolved_by: "https://pr/3" }),
    resolved("F-404", T(4)),
    resolved("F-4", T(5)),
    planRecord(PLAN, T(10), ["SEC-01::web", "SEC-09::web"]),
  ];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 7: findings keeps only the findings that still drive a listed cell", scope.findings.join() === "F-3", scope.findings.join());
  check(
    "rule 7: resolved_by keeps only those findings too",
    JSON.stringify(scope.resolved_by) === JSON.stringify({ "F-3": "https://pr/3" }),
    JSON.stringify(scope.resolved_by),
  );
  check("rule 7: unknown is computed as before", scope.unknown.join() === "F-404", scope.unknown.join());
  check("rule 7: unscorable is computed as before, plan or no plan", scope.unscorable.join() === "F-4", scope.unscorable.join());
  check(
    "rule 7: the summary counts what is left",
    scopeSummary(scope) === "1 cell to re-score from 1 resolved finding since 2026-08",
    scopeSummary(scope),
  );
}

// A full record, or a scoped re-audit's, still clears everything.
{
  const plan = [AUG(), resolved("F-1", T(2)), resolved("F-3", T(3)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check("(precondition) after the plan, A11Y-01 x ios is listed", cellIds(deriveAuditScope(plan, SECTION, LIBRARY, { widen: false })).join() === "ios:A11Y-01:direct");
  const full = deriveAuditScope([...plan, audit("2026-10", "2026-10-01T00:00:00.000Z")], SECTION, LIBRARY);
  check("a full record after a plan still moves since and clears all", full.since === "2026-10" && full.cells.length === 0, JSON.stringify(full));
  const scoped = deriveAuditScope(
    [...plan, audit("2026-09-scoped", T(20), { scope: { partial: true, cells: 1, since: "2026-08" } })],
    SECTION,
    LIBRARY,
  );
  check("so does a scoped re-audit's record", scoped.since === "2026-09-scoped" && scoped.cells.length === 0, JSON.stringify(scoped));
}

// --- rule 5: widened cells ------------------------------------------------------

// Rule 5: widened cells count a node only through a resolution that counts for them.
{
  const base = [AUG(), resolved("F-1", T(2))];
  check(
    "(precondition) without a plan, F-1's V-home widens SEC-03 x web in",
    cellIds(deriveAuditScope(base, SECTION, LIBRARY)).join() === "web:SEC-01:direct,web:SEC-03:widened",
    cellIds(deriveAuditScope(base, SECTION, LIBRARY)).join(),
  );

  const rescored = deriveAuditScope([...base, planRecord(PLAN, T(10), ["SEC-03::web"])], SECTION, LIBRARY);
  check(
    "rule 5: a widened cell the plan re-scored leaves the scope",
    cellIds(rescored).join() === "web:SEC-01:direct" && rescored.widened === 0,
    cellIds(rescored).join(),
  );

  const directOnly = deriveAuditScope([...base, planRecord(PLAN, T(10), ["SEC-01::web"])], SECTION, LIBRARY);
  check(
    "rule 5: one it did not re-score stays widened, though the direct cell that pulled it in was cleared",
    cellIds(directOnly).join() === "web:SEC-03:widened" && directOnly.cells[0].because.join() === "V-home" && directOnly.findings.length === 0,
    JSON.stringify(directOnly),
  );

  const later = deriveAuditScope(
    [...base, planRecord(PLAN, T(10), ["SEC-03::web"]), resolved("F-3", T(11), { node_ids: ["V-home"] })],
    SECTION,
    LIBRARY,
  );
  check(
    "rule 5: a later fix touching one of its nodes widens it back in",
    cellIds(later).join() === "web:SEC-01:direct,web:SEC-03:widened,ios:A11Y-01:direct" &&
      later.cells.find((cell) => cell.criterion_id === "SEC-03")?.because.join() === "V-home",
    cellIds(later).join(),
  );

  // F-1's event before the plan carries V-settings; its resolution after the
  // plan does not. V-settings dates from the first event, so A11Y-01 x ios —
  // re-scored by the plan in between — is not widened back by it.
  const dated = deriveAuditScope(
    [AUG(), resolved("F-1", T(2), { node_ids: ["V-settings"] }), planRecord(PLAN, T(10), ["A11Y-01::ios"]), resolved("F-1", T(11))],
    SECTION,
    LIBRARY,
  );
  check(
    "rule 5: a node an event carried dates from that event, not from the finding's latest resolution",
    !cellIds(dated).includes("ios:A11Y-01:widened"),
    cellIds(dated).join(),
  );
  const undated = deriveAuditScope(
    [AUG(), resolved("F-1", T(2), { node_ids: ["V-settings"] }), resolved("F-1", T(11))],
    SECTION,
    LIBRARY,
  );
  check("(precondition) without the plan, that V-settings does widen A11Y-01 x ios", cellIds(undated).includes("ios:A11Y-01:widened"), cellIds(undated).join());
}

// --- scopedAuditId (issue #473): the shared naming rule ----------------------

{
  const throws = (fn) => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error.message;
    }
  };

  check(
    "with nothing requested and nothing open, the default is <month>-scoped",
    scopedAuditId({ since: "2026-08", month: "2026-09", known: ["2026-08"], recorded: ["2026-08"] }) === "2026-09-scoped",
  );
  check(
    "a taken default rolls to -02",
    scopedAuditId({ since: "2026-08", month: "2026-09", known: ["2026-08", "2026-09-scoped"], recorded: ["2026-08"] }) === "2026-09-scoped-02",
  );
  check(
    "an open scoped audit is continued rather than forked",
    scopedAuditId({ since: "2026-08", month: "2026-09", known: ["2026-08", "2026-09-scoped"], recorded: ["2026-08"], open: "2026-09-scoped" }) === "2026-09-scoped",
  );
  check(
    "an open audit a newer known id already outsorts is not continued",
    scopedAuditId({
      since: "2026-08",
      month: "2026-10",
      known: ["2026-08", "2026-09-scoped", "2026-10"],
      recorded: ["2026-08", "2026-09-scoped", "2026-10"],
      open: "2026-09-scoped",
    }) === "2026-10-scoped",
  );
  check(
    "an open audit equal to the newest known id is still continued",
    scopedAuditId({
      since: "2026-08",
      month: "2026-10",
      known: ["2026-08", "2026-10"],
      recorded: ["2026-08", "2026-10"],
      open: "2026-10",
    }) === "2026-10",
  );
  check(
    "a requested id measured from itself throws",
    /is the audit this scope is measured from/.test(
      throws(() => scopedAuditId({ since: "2026-08", month: "2026-09", requested: "2026-08", known: ["2026-08"], recorded: ["2026-08"] })),
    ),
  );
  check(
    "a requested id already recorded throws — its reading is history",
    throws(() =>
      scopedAuditId({ since: "2026-08", month: "2026-09", requested: "2026-08-scoped", known: ["2026-08", "2026-08-scoped"], recorded: ["2026-08", "2026-08-scoped"] }),
    ) === `"2026-08-scoped" is already recorded — its reading is history. Name a new audit.`,
  );
  check(
    "a requested id sorting before the newest known id throws",
    /sorts before/.test(
      throws(() => scopedAuditId({ since: "2026-08", month: "2026-09", requested: "2026-09-01", known: ["2026-08", "2026-09-scoped"], recorded: ["2026-08"] })),
    ),
  );
  check(
    "known need not arrive sorted — the newest is found regardless of order",
    /sorts before "2026-10"/.test(
      throws(() => scopedAuditId({ since: "2026-08", month: "2026-09", requested: "2026-09-x", known: ["2026-10", "2026-08"], recorded: ["2026-08", "2026-10"] })),
    ),
  );
  check(
    "a requested id is otherwise returned",
    scopedAuditId({ since: "2026-08", month: "2026-09", requested: "2026-09-custom", known: ["2026-08"], recorded: ["2026-08"] }) === "2026-09-custom",
  );
  // The example id a refusal suggests must be one the agent can actually use:
  // never the id it just asked for, never one that already exists, and one that
  // would itself pass. A suggestion that loops the agent back is worse than none.
  const suggested = (message) => (/e\.g\. `([^`]+)`/.exec(message ?? "") ?? [])[1];
  const usable = (message, input) => {
    const id = suggested(message);
    if (id === undefined || id === input.requested || input.known.includes(id) || input.recorded.includes(id)) return false;
    try {
      return scopedAuditId({ ...input, requested: id }) === id;
    } catch {
      return false;
    }
  };
  {
    // The since audit is itself a scoped one from this month: `${month}-scoped`
    // IS the refused id.
    const input = { since: "2026-09-scoped", month: "2026-09", requested: "2026-09-scoped", known: ["2026-08", "2026-09-scoped"], recorded: ["2026-08", "2026-09-scoped"] };
    const message = throws(() => scopedAuditId(input));
    check("the since refusal suggests an id that is neither the requested one nor a known one", usable(message, input), message);
  }
  {
    // Requested `${month}-scoped` sorts before a known `-02`: suggesting
    // `${month}-scoped` again would loop.
    const input = { since: "2026-08", month: "2026-09", requested: "2026-09-scoped", known: ["2026-08", "2026-09-scoped-02"], recorded: ["2026-08"] };
    const message = throws(() => scopedAuditId(input));
    check("the sorts-before refusal never suggests the id it just refused", /sorts before/.test(message) && usable(message, input), message);
  }
  {
    // `${month}-scoped` is already known, and the requested id sorts before it.
    const input = { since: "2026-08", month: "2026-09", requested: "2026-09-a", known: ["2026-08", "2026-09-scoped"], recorded: ["2026-08"] };
    const message = throws(() => scopedAuditId(input));
    check("the sorts-before refusal never suggests a known id", /sorts before/.test(message) && usable(message, input), message);
  }
  {
    // No `${month}-scoped[-NN]` can sort after a later month: the suggestion
    // falls back to one that sorts after the newest known id.
    const input = { since: "2026-08", month: "2026-09", requested: "2026-09-x", known: ["2026-08", "2026-10"], recorded: ["2026-08", "2026-10"] };
    const message = throws(() => scopedAuditId(input));
    check("with no month candidate left, the suggestion sorts after the newest known id", usable(message, input), message);
  }
  check(
    "a candidate sorting before a known later audit throws",
    /would sort before "2026-10"/.test(
      throws(() => scopedAuditId({ since: "2026-08", month: "2026-09", known: ["2026-08", "2026-10"], recorded: ["2026-08", "2026-10"] })),
    ),
  );
}

// --- scopedAuditId after a plan (the planner, part 1) ------------------------
//
// A plan's parts (`2026-11-zplan-1100-sec-web`) sort after every same-month id
// by design, so `<month>-scoped` would sort before them and be refused. The
// candidates start from the newest part instead.

{
  const throws = (fn) => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error.message;
    }
  };
  const PARTS = ["2026-11-zplan-1100-agt-ios", "2026-11-zplan-1100-sec-web"];
  const base = { since: "2026-10", month: "2026-11", recorded: ["2026-10", "2026-11-zplan-1100", ...PARTS] };

  check(
    "after a plan in the same month, the scoped audit is named after the newest part",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS] }) === "2026-11-zplan-1100-sec-web-scoped",
  );
  check(
    "a taken <partId>-scoped rolls to -02, read off the scoped id's stem",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS, "2026-11-zplan-1100-sec-web-scoped"] }) === "2026-11-zplan-1100-sec-web-scoped-02",
  );
  check(
    "-02 taken rolls to -03",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS, "2026-11-zplan-1100-sec-web-scoped", "2026-11-zplan-1100-sec-web-scoped-02"] }) ===
      "2026-11-zplan-1100-sec-web-scoped-03",
  );
  check(
    "known need not arrive sorted",
    scopedAuditId({ ...base, known: ["2026-11-zplan-1100-sec-web", "2026-10", "2026-11-zplan-1100-agt-ios"] }) === "2026-11-zplan-1100-sec-web-scoped",
  );
  check(
    "a plan in an earlier month leaves the month base alone",
    scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-10-zplan-3100-sec-web"], recorded: ["2026-10", "2026-10-zplan-3100"] }) ===
      "2026-11-scoped",
  );
  check(
    "a plan id alone (no part on disk) is not a part: the month base still applies, and still refuses",
    /would sort before "2026-11-zplan-1100"/.test(
      throws(() => scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-11-zplan-1100"], recorded: ["2026-10", "2026-11-zplan-1100"] })),
    ),
  );
  check(
    "a newest id that is not a plan part still refuses as before",
    /would sort before "2026-11-zz"/.test(throws(() => scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-11-zz"], recorded: ["2026-10"] }))),
  );
  {
    const input = { ...base, requested: "2026-11-scoped", known: ["2026-10", ...PARTS] };
    const message = throws(() => scopedAuditId(input));
    const suggestion = (/e\.g\. `([^`]+)`/.exec(message ?? "") ?? [])[1];
    check(
      "a refused request after a plan suggests <partId>-scoped, which is accepted",
      /sorts before/.test(message) && suggestion === "2026-11-zplan-1100-sec-web-scoped" && scopedAuditId({ ...input, requested: suggestion }) === suggestion,
      message,
    );
  }
  check(
    "a requested <partId>-scoped is accepted",
    scopedAuditId({ ...base, requested: "2026-11-zplan-1100-sec-web-scoped", known: ["2026-10", ...PARTS] }) === "2026-11-zplan-1100-sec-web-scoped",
  );

  // A requested id shaped like a plan or a part would make an audit directory
  // that can never be recorded or read as a plan: refused, whatever it sorts after.
  for (const requested of ["2026-11-zplan-1199", "2026-11-zplan-1199-sec-web", "2026-11-zplan-1100-sec-ios"]) {
    const input = { ...base, requested, known: ["2026-10", ...PARTS] };
    const message = throws(() => scopedAuditId(input));
    check(`a requested "${requested}" is refused as reserved for plans and their parts`, /reserved for plans and their parts/.test(message ?? ""), message);
    const suggestion = (/e\.g\. `([^`]+)`/.exec(message ?? "") ?? [])[1];
    check(
      `the refusal of "${requested}" suggests an id that is accepted`,
      suggestion !== undefined && scopedAuditId({ ...input, requested: suggestion }) === suggestion,
      message,
    );
  }
  check(
    "a recorded part asked for by name still says it is already recorded",
    /already recorded/.test(throws(() => scopedAuditId({ ...base, requested: "2026-11-zplan-1100-sec-web", known: ["2026-10", ...PARTS] })) ?? ""),
  );
  check(
    "a reserved id is refused with nothing else known, too",
    /reserved for plans and their parts/.test(
      throws(() => scopedAuditId({ since: "2026-10", month: "2026-11", requested: "2026-11-zplan-1199", known: ["2026-10"], recorded: ["2026-10"] })) ?? "",
    ),
  );
}

console.log(failures === 0 ? "\nAll quality-scope checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

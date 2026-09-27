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
const { deriveAuditScope, recordedAuditIds, scopeSummary, scopedAuditId } = loadSchema();

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
const audit = (auditId, ts) => ev("quality.audit.completed", ts, { audit_id: auditId, framework_version: "1.0.0" });
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
  check(
    "a candidate sorting before a known later audit throws",
    /would sort before "2026-10"/.test(
      throws(() => scopedAuditId({ since: "2026-08", month: "2026-09", known: ["2026-08", "2026-10"], recorded: ["2026-08", "2026-10"] })),
    ),
  );
}

console.log(failures === 0 ? "\nAll quality-scope checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

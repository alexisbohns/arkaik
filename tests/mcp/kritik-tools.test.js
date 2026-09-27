#!/usr/bin/env node

/**
 * The `kritik_*` tool catalog over stdio (issue #382 phase C) — the CLI harness
 * pattern from run-mcp-tests.js, against a tmpdir repo with a bundle, a
 * journal, and a Kritik profile.
 *
 * What this covers that `tests/cli/kritik.test.js` cannot: that an agent gets
 * the *same* answers through MCP as a person gets through the CLI, that quality
 * events go through the store's validator-gated write path rather than around
 * it, and that a session pointed at a hosted project refuses these tools with an
 * explanation instead of half-working.
 *
 * Run via `npm run test:mcp` (builds `arkaik` for dist/io.js, then `arkaik-mcp`).
 */

const { spawn } = require("child_process");
const http = require("node:http");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");

if (!existsSync(SERVER)) {
  console.error("arkaik-mcp is not built. Run: npm run build -w arkaik-mcp (test:mcp does this).");
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BUNDLE = JSON.stringify(
  {
    schema_version: 3,
    project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
    edges: [],
  },
  null,
  2,
);
const CREATED = JSON.stringify({
  id: "01A",
  ts: "2026-01-01T00:00:00.000Z",
  type: "node.created",
  node_id: "V-home",
  species: "view",
  title: "Home",
});

/** Spawn a server over a fresh tmpdir repo; returns an rpc client. */
function startSession(extraArgs = [], env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-kritik-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  writeFileSync(bundlePath, BUNDLE);
  writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), `${CREATED}\n`);
  mkdirSync(path.join(dir, "docs", "quality"), { recursive: true });
  writeFileSync(
    path.join(dir, "docs", "quality", "profile.json"),
    JSON.stringify(
      { surfaces: [{ id: "web", title: "Web app", platform: "web" }, { id: "supabase", title: "Database contract" }] },
      null,
      2,
    ),
  );

  const args = extraArgs.length > 0 ? extraArgs : ["--bundle", bundlePath];
  const child = spawn(process.execPath, [SERVER, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: dir,
    env: { ...process.env, ...env },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;

  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000).unref?.();
    });

  const call = async (name, args = {}) => {
    const response = await request("tools/call", { name, arguments: args });
    const text = response.result?.content?.[0]?.text ?? "";
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
    return { isError: response.result?.isError === true, json, text };
  };

  return {
    dir,
    request,
    call,
    readJson: (...parts) => JSON.parse(readFileSync(path.join(dir, ...parts), "utf8")),
    journal: () =>
      readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function run() {
  const session = startSession();
  try {
    await session.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kritik-test", version: "0" },
    });

    const listed = await session.request("tools/list");
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    for (const name of [
      "kritik_matrix",
      "kritik_findings",
      "kritik_signals",
      "kritik_issue",
      "kritik_score",
      "kritik_open_finding",
      "kritik_resolve_finding",
      "kritik_accept_finding",
      "kritik_trip_signal",
      "kritik_regressions",
      "kritik_trend",
      "kritik_burndown",
      "kritik_scope",
    ]) {
      check(`catalog includes ${name}`, names.includes(name));
    }

    const scoreDef = (listed.result?.tools ?? []).find((tool) => tool.name === "kritik_score");
    check("kritik_score advertises the maturity scale as an enum", JSON.stringify(scoreDef.inputSchema.properties.level.enum) === "[0,1,2,3,4]");
    check("kritik_score requires evidence", scoreDef.inputSchema.required.includes("evidence"));

    // --- scoring ---------------------------------------------------------------

    const scored = await session.call("kritik_score", {
      criterion_id: "SEC-01",
      surface: "web",
      level: 2,
      evidence: "middleware.ts:14-31",
      commit: "abc1234",
    });
    check("kritik_score writes an assessment", !scored.isError && scored.json.assessment.level === 2, scored.text.slice(0, 200));
    check("it lands in the sidecar, which is canonical in a repo", session.readJson("docs", "quality", "audits", scored.json.audit_id, "scores.json").assessments.length === 1);
    check("it comes back with the anchor it scored against", typeof scored.json.anchor === "string");
    // Scoring alone appends nothing: quality.audit.completed covers the run.
    check("scoring appends no journal event", session.journal().length === 1, JSON.stringify(session.journal().map((e) => e.type)));

    const rescored = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "now covers refresh" });
    check("re-scoring replaces in place", rescored.json.assessment_count === 1 && rescored.json.replaced_level === 2);

    const badSurface = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "android", level: 1, evidence: "x" });
    check("an undeclared surface is an actionable tool error", badSurface.isError && badSurface.json.message.includes("not declared"), badSurface.text);

    const cross = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "cross-surface", level: 1, evidence: "x" });
    check("cross-surface refuses a score", cross.isError && cross.json.message.includes("findings-only lens"));

    const retired = await session.call("kritik_score", { criterion_id: "SEC-99", surface: "web", level: 1, evidence: "x" });
    check("an unknown criterion names its siblings", retired.isError && retired.json.message.includes("SEC-01"), retired.text);

    // --- findings --------------------------------------------------------------

    const opened = await session.call("kritik_open_finding", {
      criterion_id: "SEC-02",
      surface: "supabase",
      title: "RLS off on two tables",
      evidence: "migrations/003.sql:8",
      impact: 5,
      likelihood: 4,
      cost: "M",
      node_ids: ["V-home"],
    });
    check("kritik_open_finding writes and ranks", !opened.isError && opened.json.severity === "critical" && opened.json.priority === "P0", opened.text.slice(0, 200));
    check("the id follows the readable convention", opened.json.finding.id === `F-${opened.json.audit_id}-SEC-supabase-01`, opened.json.finding.id);
    check("severity is never stored on the finding itself", opened.json.finding.severity === undefined);
    check("the event went through the store's own write path", opened.json.events.length === 1 && opened.json.events[0].type === "quality.finding.opened");
    check("and it is stamped with the agent-plane actor", opened.json.events[0].actor === "arkaik-mcp", JSON.stringify(opened.json.events[0]));
    check("the event carries the derived severity", opened.json.events[0].severity === "critical");
    check("the event carries the graph tie", JSON.stringify(opened.json.events[0].node_ids) === JSON.stringify(["V-home"]));

    const journalTypes = session.journal().map((event) => event.type);
    check("the sidecar journal received it", journalTypes.includes("quality.finding.opened"), journalTypes.join(", "));
    check("the snapshot was not rewritten", readFileSync(path.join(session.dir, "docs", "arkaik", "bundle.json"), "utf8") === BUNDLE);

    // A refuted finding is disclosed, not deleted — and not announced either.
    const refuted = await session.call("kritik_open_finding", {
      criterion_id: "SEC-02",
      surface: "supabase",
      title: "Storage bucket public",
      evidence: "storage.sql:2",
      impact: 4,
      likelihood: 2,
      cost: "S",
      verification: { verdict: "REFUTED", note: "The bucket is documented as intentionally public." },
    });
    check("a refuted finding is still recorded", !refuted.isError && refuted.json.finding.status === "refuted", refuted.text.slice(0, 200));
    check("but nothing is announced for it", refuted.json.events.length === 0);
    check("its verification verdict is kept, so a reader learns what was dismissed", refuted.json.finding.verification.verdict === "REFUTED");

    const findings = await session.call("kritik_findings", { priority: "P0" });
    check("kritik_findings derives severity and priority on read", findings.json.findings.every((f) => f.severity && f.priority));
    check("filtering by priority works", findings.json.findings.every((f) => f.priority === "P0"));

    const openOnly = await session.call("kritik_findings", { status: "refuted" });
    check("filtering by status works", openOnly.json.total === 1 && openOnly.json.findings[0].title === "Storage bucket public");

    // --- resolve / accept ------------------------------------------------------

    const resolved = await session.call("kritik_resolve_finding", {
      finding_id: opened.json.finding.id,
      resolved_by: "https://github.com/x/y/pull/9",
    });
    check("kritik_resolve_finding closes it", !resolved.isError && resolved.json.finding.status === "resolved", resolved.text.slice(0, 200));
    check("it appends the resolution event", resolved.json.events[0].type === "quality.finding.resolved");
    check("carrying what closed it", resolved.json.events[0].resolved_by === "https://github.com/x/y/pull/9");

    const again = await session.call("kritik_resolve_finding", { finding_id: opened.json.finding.id });
    check("resolving twice writes nothing", !again.isError && again.json.events.length === 0, again.text.slice(0, 200));

    const ghost = await session.call("kritik_resolve_finding", { finding_id: "F-nope" });
    check("resolving an unknown id is an actionable error", ghost.isError && ghost.json.message.includes("No finding"));

    const accepted = await session.call("kritik_accept_finding", {
      finding_id: refuted.json.finding.id,
      note: "Documented as public on purpose.",
    });
    check("kritik_accept_finding records the decision", !accepted.isError && accepted.json.finding.status === "accepted-risk");
    check("the note lands where the validator looks for it", accepted.json.finding.detail.includes("Documented as public on purpose."));
    check("acceptance appends no event", accepted.json.events.length === 0);

    // --- matrix ----------------------------------------------------------------

    const matrix = await session.call("kritik_matrix");
    check("kritik_matrix rolls up", !matrix.isError && typeof matrix.json.matrix === "object", matrix.text.slice(0, 200));
    check("the columns are exactly the profile's surfaces", "web" in matrix.json.overall && "supabase" in matrix.json.overall);
    check("it reports the priority lanes", typeof matrix.json.lanes.P0 === "number");
    check("it refreshes matrix.json", existsSync(path.join(session.dir, "docs", "quality", "audits", matrix.json.audit_id, "matrix.json")));
    check("it appends nothing without record", matrix.json.events.length === 0);
    check("a plain repo-mode read carries no notes", matrix.json.notes === undefined, JSON.stringify(matrix.json.notes));

    // commit is a hosted-record argument: repo mode reads the commit from the
    // audit's scores.json, so a commit passed here is named as unused rather
    // than silently dropped.
    const matrixWithCommit = await session.call("kritik_matrix", { commit: "abc123" });
    check(
      "repo-mode kritik_matrix notes that commit is only used when recording in a hosted session",
      !matrixWithCommit.isError &&
        (matrixWithCommit.json.notes ?? []).some((n) => /hosted session/.test(n) && /scores\.json/.test(n)),
      JSON.stringify(matrixWithCommit.json.notes),
    );

    const recorded = await session.call("kritik_matrix", { record: true });
    check("record:true appends quality.audit.completed", recorded.json.events[0]?.type === "quality.audit.completed", recorded.text.slice(0, 200));
    check("the event's scores are the roll-up itself", recorded.json.events[0].scores.web.SEC === recorded.json.matrix.SEC.web.score);

    // --- trend (issue #442) ----------------------------------------------------

    const trend = await session.call("kritik_trend", {});
    check("kritik_trend replays the recorded audit", !trend.isError && trend.json.total === 1 && trend.json.rows.length === 1, trend.text.slice(0, 300));
    check("the row's roll-up is the matrix's own", trend.json.rows[0].cells.web.score === recorded.json.overall.web, JSON.stringify(trend.json.rows[0]));
    check("a first row has no delta", trend.json.rows[0].cells.web.delta === null);
    const trendDomain = await session.call("kritik_trend", { domain: "SEC", surface: "web" });
    check("kritik_trend narrows to a domain and a surface", !trendDomain.isError && trendDomain.json.surfaces.length === 1 && trendDomain.json.rows[0].cells.web.score === recorded.json.matrix.SEC.web.score, trendDomain.text.slice(0, 300));

    // --- burndown (issue #441) --------------------------------------------------

    // This session opened one Critical and resolved it before recording the
    // audit — so the whole journal saw one open and one close, and nothing has
    // moved since the audit.
    const burn = await session.call("kritik_burndown", {});
    check(
      "kritik_burndown replays this session's open and close",
      !burn.isError && burn.json.opened === 1 && burn.json.resolved === 1 && burn.json.points[0].cause.id === opened.json.finding.id && burn.json.points[0].open.critical === 1,
      burn.text.slice(0, 400),
    );
    check(
      "and measures from the audit it recorded",
      burn.json.since?.audit_id === recorded.json.events[0].audit_id && burn.json.since.resolved === 0 && /^0 closed since the /.test(burn.json.summary),
      JSON.stringify(burn.json.since),
    );
    const burnElsewhere = await session.call("kritik_burndown", { surface: "no-such-surface" });
    check("a surface nothing was found on has no opens", !burnElsewhere.isError && burnElsewhere.json.opened === 0 && burnElsewhere.json.resolved === 0, burnElsewhere.text.slice(0, 300));

    // --- scope (issue #443) -----------------------------------------------------

    const quietScope = await session.call("kritik_scope", {});
    check(
      "kritik_scope right after a recorded audit has nothing stale",
      !quietScope.isError && quietScope.json.cells.length === 0 && quietScope.json.since === scored.json.audit_id,
      quietScope.text.slice(0, 300),
    );

    const fix = await session.call("kritik_open_finding", {
      criterion_id: "SEC-01",
      surface: "web",
      title: "Session id not rotated on login",
      evidence: "auth.ts:3",
      impact: 2,
      likelihood: 2,
      cost: "S",
      node_ids: ["V-home"],
    });
    await session.call("kritik_resolve_finding", { finding_id: fix.json.finding.id, resolved_by: "https://github.com/x/y/pull/10" });

    const scope = await session.call("kritik_scope", {});
    const scoped = scope.json.cells ?? [];
    check(
      "a finding resolved since the audit scopes its cell",
      !scope.isError && scoped.length === 1 && scoped[0].criterion_id === "SEC-01" && scoped[0].surface === "web" && scoped[0].kind === "direct",
      scope.text.slice(0, 400),
    );
    check("the cell says which finding and which PR", scoped[0]?.because?.[0] === fix.json.finding.id && scope.json.resolved_by[fix.json.finding.id] === "https://github.com/x/y/pull/10");
    check("the cell carries the score a re-score would replace", scoped[0]?.current?.level === 3, JSON.stringify(scoped[0]));
    check(
      "the summary is the CLI's own totals line",
      scope.json.summary === `1 cell to re-score from 1 resolved finding since ${scored.json.audit_id}`,
      scope.json.summary,
    );

    const unrecorded = await session.call("kritik_scope", { since: "1999-01" });
    check(
      "a since that was never recorded is refused, naming what was",
      unrecorded.isError && unrecorded.json.message.includes("No recorded audit") && unrecorded.json.message.includes(scored.json.audit_id),
      unrecorded.text.slice(0, 300),
    );

    // --- signals ---------------------------------------------------------------

    const signals = await session.call("kritik_signals", { criterion_id: "SEC-02", surface: "supabase" });
    check("kritik_signals returns the run sheet", !signals.isError && signals.json.signals.length > 0, signals.text.slice(0, 200));
    check("every row names its cell and index", signals.json.signals.every((row) => row.criterion_id === "SEC-02" && row.surface === "supabase" && typeof row.index === "number"));
    check("nothing has tripped since the audit just recorded", signals.json.tripped_since_last_audit.length === 0);

    const trip = await session.call("kritik_trip_signal", {
      criterion_id: "SEC-02",
      surface: "supabase",
      signal: "1",
      detail: "3 hits in migrations/012.sql",
    });
    check("kritik_trip_signal appends its event", !trip.isError && trip.json.events[0].type === "quality.signal.tripped", trip.text.slice(0, 200));
    check("an index resolves to the statement itself", trip.json.signal === signals.json.signals[1].signal, trip.json.signal);

    const afterTrip = await session.call("kritik_signals", { criterion_id: "SEC-02" });
    check("the trip shows up in the window since the last audit", afterTrip.json.tripped_since_last_audit.length === 1);

    // --- issue -----------------------------------------------------------------

    const issue = await session.call("kritik_issue", { criterion_id: "SEC-01", surface: "web", level: 2 });
    check("kritik_issue renders a skeleton", !issue.isError && issue.json.title.includes("SEC-01"), issue.text.slice(0, 200));
    check("the surface becomes a label", issue.json.labels.includes("web"));
    check("unknown placeholders are left for the author", issue.json.body.includes("{"));

    const fromFinding = await session.call("kritik_issue", {
      criterion_id: "SEC-02",
      surface: "supabase",
      finding_id: opened.json.finding.id,
    });
    check("finding_id lands the finding's evidence", fromFinding.json.body.includes("migrations/003.sql:8"), fromFinding.json.body.slice(-300));

    // --- regressions (phase E) --------------------------------------------------

    // detectRegressions needs two audits with a comparable cell to say anything.
    // Everything above scored SEC-01 x web at level 3 in the one audit the run
    // has used so far (`scored.json.audit_id`) — write a second audit, lexically
    // after the first so it sorts as the newer one, scoring the same cell lower.
    const auditA = scored.json.audit_id;
    const auditB = `${auditA}-2`;
    const tripsBefore = session.journal().filter((event) => event.type === "quality.signal.tripped").length;

    const regressedScore = await session.call("kritik_score", {
      criterion_id: "SEC-01",
      surface: "web",
      level: 1,
      evidence: "regressed on purpose, for the regressions test",
      audit_id: auditB,
    });
    check("a second audit can be scored explicitly by audit_id", !regressedScore.isError && regressedScore.json.audit_id === auditB, regressedScore.text.slice(0, 200));

    const regressions = await session.call("kritik_regressions", {});
    check("kritik_regressions names both audits", !regressions.isError && typeof regressions.json.from === "string" && typeof regressions.json.to === "string", regressions.text.slice(0, 200));
    check("it picked the two audits on disk, oldest to newest", regressions.json.from === auditA && regressions.json.to === auditB, JSON.stringify({ from: regressions.json.from, to: regressions.json.to }));
    check("kritik_regressions reports the level drop", regressions.json.regressions.some((r) => r.kind === "level-drop"), JSON.stringify(regressions.json.regressions));
    check("it appends nothing without record", regressions.json.events.length === 0);

    const recordedRegressions = await session.call("kritik_regressions", { record: true });
    check("record=true returns the events it appended", Array.isArray(recordedRegressions.json.events) && recordedRegressions.json.events.length === recordedRegressions.json.regressions.length, recordedRegressions.text.slice(0, 300));
    check("every appended event is a trip", recordedRegressions.json.events.every((e) => e.type === "quality.signal.tripped"), JSON.stringify(recordedRegressions.json.events));
    const tripsAfter = session.journal().filter((event) => event.type === "quality.signal.tripped").length;
    check("exactly one trip per regression landed in the journal", tripsAfter - tripsBefore === recordedRegressions.json.regressions.length, `${tripsBefore} -> ${tripsAfter}, ${recordedRegressions.json.regressions.length} regression(s)`);

    const refused = await session.call("kritik_regressions", { from: "nope" });
    check("an unknown audit is refused", refused.isError && refused.json.message.includes("nope"), refused.text);

    const onlyOne = await session.call("kritik_regressions", { from: auditA, to: auditA });
    check("from and to naming the same audit is refused", onlyOne.isError && onlyOne.json.message.includes("same audit"), onlyOne.text);

    const noOlder = await session.call("kritik_regressions", { to: auditA });
    check("the oldest audit has nothing before it to compare against", noOlder.isError && noOlder.json.message.includes("oldest"), noOlder.text);

    // --- the scoped re-audit (issue #443, part 2) -------------------------------
    //
    // After the regressions block on purpose: a `<month>-scoped` audit sorts
    // after `${auditA}-2`, and would otherwise become the "newest" that block
    // defaults its comparison to. The scope is still the one opened above —
    // the fix resolved since `auditA` was recorded.

    // A cell the scoped pass will not touch, so the record can prove it merged.
    await session.call("kritik_score", { criterion_id: "SEC-02", surface: "supabase", level: 2, evidence: "rls.sql:4", audit_id: auditB });

    // SEC-02 x supabase is IN scope now — widened, its RLS finding shares
    // V-home with the fix — so the refusal is tested on a cell tied to nothing.
    const widenedIn = await session.call("kritik_scope", {});
    check(
      "a scored neighbour sharing a node with the fix is widened into the scope",
      widenedIn.json.cells.some((cell) => cell.criterion_id === "SEC-02" && cell.surface === "supabase" && cell.kind === "widened" && cell.because.includes("V-home")),
      widenedIn.text.slice(0, 400),
    );
    const outOfScope = await session.call("kritik_score", { criterion_id: "SEC-04", surface: "web", level: 3, evidence: "x", scope: true });
    check(
      "kritik_score scope=true refuses a cell kritik_scope does not list",
      outOfScope.isError && outOfScope.json.message.includes("not in the current scope") && outOfScope.json.message.includes("kritik_scope"),
      outOfScope.text.slice(0, 300),
    );

    const intoMeasured = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "auth.ts:3 rotates on login", scope: true, audit_id: auditA });
    check(
      "scope=true refuses to re-score inside the audit it is measured from, and stays mode-neutral — no --audit flag, this is MCP",
      intoMeasured.isError && intoMeasured.json.message.includes("measured from") && !intoMeasured.json.message.includes("--audit"),
      intoMeasured.text.slice(0, 300),
    );

    const inScope = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "auth.ts:3 rotates on login", scope: true });
    const scopedAudit = `${auditA}-scoped`;
    check(
      "an in-scope cell lands in a scoped audit of its own",
      !inScope.isError && inScope.json.audit_id === scopedAudit && inScope.json.scoped_from === auditA,
      inScope.text.slice(0, 300),
    );
    check("the scoped audit is stamped", session.readJson("docs", "quality", "audits", scopedAudit, "scores.json").scope?.since === auditA);

    const scopedMatrix = await session.call("kritik_matrix", { audit_id: scopedAudit, record: true });
    check(
      "kritik_matrix reports the scope it detected from the stamp",
      !scopedMatrix.isError && JSON.stringify(scopedMatrix.json.scope) === JSON.stringify({ partial: true, cells: 1, since: auditA }),
      scopedMatrix.text.slice(0, 300),
    );
    check("matrix.json stays this audit alone — supabase is N/A there", scopedMatrix.json.matrix.SEC.supabase === null, JSON.stringify(scopedMatrix.json.matrix.SEC));
    check(
      "the reply names the scoped cell left unscored as the window closes",
      JSON.stringify(scopedMatrix.json.left_unscored) === JSON.stringify([{ criterion_id: "SEC-02", surface: "supabase", kind: "widened" }]),
      JSON.stringify(scopedMatrix.json.left_unscored),
    );
    const scopedEvent = scopedMatrix.json.events[0] ?? {};
    check("the recorded event carries the scope marker", scopedEvent.scope?.partial === true && scopedEvent.scope?.since === auditA, JSON.stringify(scopedEvent));
    check(
      "and the merged picture — the supabase cell this pass never touched keeps its score",
      typeof scopedEvent.scores?.supabase?.SEC === "number",
      JSON.stringify(scopedEvent.scores),
    );

    const afterScoped = await session.call("kritik_scope", {});
    check("recording the scoped audit opens a fresh window from it", afterScoped.json.since === scopedAudit && afterScoped.json.cells.length === 0, afterScoped.text.slice(0, 300));

    // auditB (`<month>-2`) sorts BEFORE the scoped audit, so what it was
    // measured from is the newest recorded audit sorting before it — auditA —
    // never the later scoped one.
    const declared = await session.call("kritik_matrix", { audit_id: auditB, scope: true });
    check(
      "scope=true declares an unstamped audit scoped, measured from the newest recorded audit sorting before it",
      !declared.isError && declared.json.scope?.since === auditA,
      declared.text.slice(0, 300),
    );
    const declaredRecorded = await session.call("kritik_matrix", { audit_id: auditA, scope: true, record: true });
    check(
      "scope=true refuses an audit already recorded",
      declaredRecorded.isError && declaredRecorded.json.message.includes("already recorded"),
      declaredRecorded.text.slice(0, 300),
    );

    const plainIntoRecorded = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "unchanged", audit_id: auditA });
    const notes = plainIntoRecorded.json.notes ?? [];
    check(
      "a plain score into a recorded audit that sorts early carries both notes",
      !plainIntoRecorded.isError && notes.some((n) => n.includes("already recorded")) && notes.some((n) => n.includes("sorts before")),
      JSON.stringify(notes),
    );

    // --- the whole journal -----------------------------------------------------

    const kinds = new Set(session.journal().map((event) => event.type));
    check(
      "only quality.* events were appended to an existing journal",
      [...kinds].every((type) => type.startsWith("quality.") || type === "node.created"),
      [...kinds].join(", "),
    );

    const validated = await session.call("validate_bundle");
    check("the bundle is still valid after every quality write", validated.json.valid === true, JSON.stringify(validated.json.errors ?? []).slice(0, 300));
  } finally {
    session.stop();
  }

  // --- hosted mode -------------------------------------------------------------
  //
  // A stub server stands in for the hosted API. It covers: the reads
  // (kritik_findings/matrix/regressions/issue/trend/scope) over the folded
  // quality section; the scoped-only hosted writes (kritik_score, kritik_matrix
  // record=true, resolve/accept) and the refusals the server sends back; the
  // repo-only tools refusing with a reason of their own; and the hints a
  // hosted project with nothing to measure from gives instead of pointing at
  // a write that would refuse.

  const HOSTED_BUNDLE = {
    schema_version: 3,
    project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
    edges: [],
    quality: {
      framework_version: "1.0.0",
      profile: { surfaces: [{ id: "web", title: "Web" }] },
      assessments: [
        { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "2026-07", ts: "2026-07-01T00:00:00.000Z" },
        { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
        // A second assessed cell, never directly touched by a resolution —
        // only reachable through the node-neighbour widening hop below. This
        // is what gives the demo project's scope TWO cells, so a real
        // record's left_unscored has something to list.
        { criterion_id: "SEC-02", surface: "web", level: 2, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
      ],
      findings: [
        { id: "F-A", criterion_id: "SEC-01", surface: "web", title: "Open crit", detail: "d", evidence: "Open crit — middleware.ts:14", impact: 5, likelihood: 5, cost: "M", status: "open" },
        // node_ids on the resolved finding is what the widening hop follows.
        { id: "F-B", criterion_id: "SEC-01", surface: "web", title: "Done", detail: "d", evidence: "e", impact: 2, likelihood: 2, cost: "S", status: "resolved", node_ids: ["V-home"] },
        // A finding at the SEC-02 x web cell sharing V-home with F-B — no
        // journal event of its own (resolved before this journal's window),
        // so it drives no direct cell; it only gives that cell a node to be
        // widened in by. Already resolved so it never counts as open.
        { id: "F-C", criterion_id: "SEC-02", surface: "web", title: "Also touched by the same fix", detail: "d", evidence: "e", impact: 1, likelihood: 1, cost: "S", status: "resolved", node_ids: ["V-home"] },
      ],
    },
  };

  // A hosted project whose audit arrived by restore with no recorded reading
  // (issue #472) — its assessments/findings sit in `quality`, but the journal
  // holds only resolutions, never a `quality.audit.completed`.
  const RESTORED_BUNDLE = {
    ...HOSTED_BUNDLE,
    project: { ...HOSTED_BUNDLE.project, id: "restored" },
    quality: {
      ...HOSTED_BUNDLE.quality,
      assessments: [{ criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
    },
  };
  const RESTORED_JOURNAL = [
    { id: "01RRES", ts: "2026-08-20T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-B", resolved_by: "https://pr/3", actor: "github-app" },
  ];

  // Read-only hosted projects the stub serves as-is, journal and all.
  //
  // `empty` has a quality section but no assessments: no audit ever arrived,
  // so there is nothing to measure from — and a hosted record=true would
  // refuse, so the hints must point at a restore instead.
  //
  // `twoopen` has two unrecorded scoped audits measured from the same since,
  // written in an order that disagrees with their ids' lexical order: the
  // open audit is the LAST one in journal order (the server planner's rule),
  // never the lexically newest.
  const STATIC_PROJECTS = {
    empty: {
      bundle: {
        ...HOSTED_BUNDLE,
        project: { ...HOSTED_BUNDLE.project, id: "empty" },
        quality: { ...HOSTED_BUNDLE.quality, assessments: [], findings: [] },
      },
      journal: [],
    },
    twoopen: {
      bundle: { ...HOSTED_BUNDLE, project: { ...HOSTED_BUNDLE.project, id: "twoopen" } },
      journal: [
        { id: "01AUDIT", ts: "2026-08-02T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-08", framework_version: "1.0.0", scores: { web: { SEC: 70 } }, counts: {}, actor: "arkaik-cli" },
        { id: "01RESOLVED", ts: "2026-08-20T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-B", resolved_by: "https://pr/3", actor: "github-app" },
        { id: "01SCA", ts: "2026-09-10T00:00:00.000Z", type: "quality.assessment.scored", audit_id: "2026-09-scoped-02", criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", scope: { since: "2026-08" }, actor: "arkaik-agent" },
        { id: "01SCB", ts: "2026-09-11T00:00:00.000Z", type: "quality.assessment.scored", audit_id: "2026-09-scoped", criterion_id: "SEC-02", surface: "web", level: 3, evidence: "e", scope: { since: "2026-08" }, actor: "arkaik-agent" },
      ],
    },
  };

  // Recorded POST bodies to /quality/events, and a mode switch for the 422
  // "refused" response the server sends when a status transition targets a
  // finding that is not open post-fold (`true` for the plain not_open case;
  // a whole body for a specific refusal a test wants to see surfaced).
  const eventsReceived = [];
  let refuseEvents = false;
  // Each project's journal gains the quality.assessment.scored and
  // quality.audit.completed events this stub echoes back as a POST succeeds
  // — a reload (GET .../journal) then sees them, the way a real hosted score
  // or completion actually would. Finding decisions are deliberately NOT
  // folded in here: nothing under test reads one back through the journal,
  // and leaving them out keeps HOSTED_BUNDLE's static journal the one source
  // of truth for kritik_scope's resolution window. Declared per project, at
  // stub start — "reset between sessions" holds trivially, since each
  // project has exactly one session in this file.
  const journalExtra = { demo: [], restored: [] };
  // The real server records a restored audit's baseline once, on its first
  // hosted score — this mirrors that by firing only the first time.
  let restoredBaselineWritten = false;

  function startHostedStub() {
    return http.createServer((req, res) => {
      const json = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/api/graph/projects/demo" && req.method === "GET") return json(200, { bundle: HOSTED_BUNDLE, version: "v1" });
      if (req.url === "/api/graph/projects/demo/journal" && req.method === "GET") {
        // One recorded audit, so kritik_trend has a hosted row to replay.
        return json(200, {
          journal: [
            { id: "01AUDIT", ts: "2026-08-02T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-08", framework_version: "1.0.0", scores: { web: { SEC: 70 } }, counts: { critical: 1 }, actor: "arkaik-cli" },
            // Resolutions after it, so kritik_scope has a hosted window to read —
            // one real, one naming a finding the section does not hold.
            { id: "01RESOLVED", ts: "2026-08-20T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-B", resolved_by: "https://pr/3", actor: "github-app" },
            { id: "01RESOLVEDGONE", ts: "2026-08-21T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-GONE", actor: "github-app" },
            ...journalExtra.demo,
          ],
        });
      }
      const staticMatch = req.method === "GET" && req.url.match(/^\/api\/graph\/projects\/([^/]+)(\/journal)?$/);
      if (staticMatch && STATIC_PROJECTS[staticMatch[1]]) {
        const project = STATIC_PROJECTS[staticMatch[1]];
        return staticMatch[2] ? json(200, { journal: project.journal }) : json(200, { bundle: project.bundle, version: "v1" });
      }
      if (req.url === "/api/graph/projects/restored" && req.method === "GET") return json(200, { bundle: RESTORED_BUNDLE, version: "v1" });
      if (req.url === "/api/graph/projects/restored/journal" && req.method === "GET") {
        return json(200, { journal: [...RESTORED_JOURNAL, ...journalExtra.restored] });
      }
      const qualityMatch = req.url.match(/^\/api\/graph\/projects\/([^/]+)\/quality\/events$/);
      if (qualityMatch && req.method === "POST") {
        const projectId = qualityMatch[1];
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw);
          eventsReceived.push(body);
          if (refuseEvents) {
            const failure =
              refuseEvents === true
                ? { error: "refused", refusals: [{ index: 0, finding_id: "F-B", reason: "not_open" }] }
                : refuseEvents;
            return json(422, failure);
          }
          const events = [];
          for (const input of body.events) {
            if (input.type === "quality.assessment.scored") {
              const scored = {
                id: "01SC",
                ts: "2026-09-15T00:00:00.000Z",
                type: input.type,
                audit_id: input.audit_id ?? "2026-09-scoped",
                criterion_id: input.criterion_id,
                surface: input.surface,
                level: input.level,
                evidence: input.evidence,
                scope: { since: "2026-08" },
                ...(input.commit !== undefined ? { commit: input.commit } : {}),
                actor: "arkaik-agent",
              };
              // A restored project's FIRST hosted score records the implicit
              // baseline for real before the score itself — the way
              // `planQualityEvents` puts the baseline first in its plan.
              // Pushed SECOND here into the reply, deliberately: the tool
              // must find it by its `baseline` flag, never by position, and
              // a stub that always put it first could never catch a lookup
              // that assumed it was.
              if (projectId === "restored" && !restoredBaselineWritten) {
                restoredBaselineWritten = true;
                const baseline = {
                  id: "01BL",
                  ts: "2026-08-01T00:00:00.000Z",
                  type: "quality.audit.completed",
                  audit_id: "2026-08",
                  baseline: true,
                  framework_version: "1.0.0",
                  scores: { web: { SEC: 70 } },
                  counts: {},
                  actor: "arkaik-agent",
                };
                events.push(scored, baseline);
                journalExtra[projectId].push(scored, baseline);
              } else {
                events.push(scored);
                journalExtra[projectId].push(scored);
              }
            } else if (input.type === "quality.audit.completed") {
              const completed = {
                id: "01REC",
                ts: "2026-09-16T00:00:00.000Z",
                type: input.type,
                audit_id: input.audit_id,
                framework_version: "1.0.0",
                scores: { web: { SEC: 80 } },
                counts: { critical: 0 },
                scope: { partial: true, cells: 1, since: "2026-08" },
                ...(input.commit !== undefined ? { commit: input.commit } : {}),
                actor: "arkaik-agent",
              };
              events.push(completed);
              journalExtra[projectId].push(completed);
            } else {
              events.push({
                id: "01X",
                ts: "2026-09-02T00:00:00.000Z",
                type: input.type,
                finding_id: input.finding_id,
                actor: "arkaik-agent",
              });
            }
          }
          return json(200, { events });
        });
        return;
      }
      return json(404, { error: "not_found" });
    });
  }

  const stub = startHostedStub();
  await new Promise((resolvePromise) => stub.listen(0, resolvePromise));
  const baseUrl = `http://127.0.0.1:${stub.address().port}`;

  const hosted = startSession(["--remote", "--project", "demo"], {
    ARKAIK_TOKEN: "t",
    ARKAIK_URL: baseUrl,
  });
  try {
    await hosted.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kritik-test", version: "0" },
    });

    // kritik_score joins the hosted tools, scoped-only (issue #473) — the
    // repo-only three still refuse with a reason specific to why THEY need a
    // checkout.
    eventsReceived.length = 0;
    const scoreNoScope = await hosted.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "x" });
    check(
      "kritik_score without scope=true refuses, pointing at a scoped re-audit",
      scoreNoScope.isError && /scoped re-audit/.test(scoreNoScope.text),
      scoreNoScope.text.slice(0, 300),
    );
    check("and nothing was posted", eventsReceived.length === 0, JSON.stringify(eventsReceived));

    eventsReceived.length = 0;
    const scoreScoped = await hosted.call("kritik_score", {
      criterion_id: "SEC-01",
      surface: "web",
      level: 3,
      evidence: "src/a.ts:3",
      commit: "abc",
      scope: true,
    });
    check(
      "kritik_score scope=true posts exactly the scored entry",
      eventsReceived.length === 1 &&
        JSON.stringify(eventsReceived[0]) ===
          JSON.stringify({
            events: [{ type: "quality.assessment.scored", criterion_id: "SEC-01", surface: "web", level: 3, evidence: "src/a.ts:3", commit: "abc" }],
          }),
      JSON.stringify(eventsReceived),
    );
    check(
      "the reply carries the audit_id the server named and where it scoped from",
      !scoreScoped.isError && scoreScoped.json.audit_id === "2026-09-scoped" && scoreScoped.json.scoped_from === "2026-08",
      scoreScoped.text.slice(0, 300),
    );
    check("an already-audited project's first hosted score carries no notes", scoreScoped.json.notes === undefined, scoreScoped.text.slice(0, 300));

    refuseEvents = { error: "refused", refusals: [{ index: 0, reason: "out_of_scope", detail: "not in the current scope" }] };
    eventsReceived.length = 0;
    const scoreOutOfScope = await hosted.call("kritik_score", {
      criterion_id: "SEC-04",
      surface: "web",
      level: 2,
      evidence: "x",
      scope: true,
      audit_id: "2026-09-scoped-custom",
    });
    check(
      "a server out_of_scope refusal surfaces as the tool error text",
      scoreOutOfScope.isError && /out_of_scope/.test(scoreOutOfScope.text),
      scoreOutOfScope.text.slice(0, 300),
    );
    check(
      "an explicit audit_id is sent through in the POST body",
      eventsReceived[0]?.events?.[0]?.audit_id === "2026-09-scoped-custom",
      JSON.stringify(eventsReceived),
    );
    refuseEvents = false;

    const openFindingRefused = await hosted.call("kritik_open_finding", {
      criterion_id: "SEC-01",
      surface: "web",
      title: "x",
      evidence: "x",
      impact: 1,
      likelihood: 1,
      cost: "S",
    });
    check("kritik_open_finding refuses in hosted mode", openFindingRefused.isError, openFindingRefused.text.slice(0, 200));
    check("kritik_open_finding's refusal says why: cites code", /cites code/.test(openFindingRefused.text), openFindingRefused.text.slice(0, 300));

    const signalsRefused = await hosted.call("kritik_signals", { criterion_id: "SEC-01" });
    check("kritik_signals refuses in hosted mode", signalsRefused.isError, signalsRefused.text.slice(0, 200));
    check("kritik_signals' refusal says why: live with the code", /live with the code/.test(signalsRefused.text), signalsRefused.text.slice(0, 300));

    const tripSignalRefused = await hosted.call("kritik_trip_signal", { criterion_id: "SEC-01", surface: "web", signal: "x" });
    check("kritik_trip_signal refuses in hosted mode", tripSignalRefused.isError, tripSignalRefused.text.slice(0, 200));
    check(
      "kritik_trip_signal's refusal says why: live with the code",
      /live with the code/.test(tripSignalRefused.text),
      tripSignalRefused.text.slice(0, 300),
    );

    const byId = await hosted.call("kritik_findings", { finding_id: "F-A" });
    check(
      "kritik_findings finds by finding_id",
      !byId.isError && byId.json.total === 1 && byId.json.findings[0].id === "F-A" && byId.json.findings[0].severity === "critical" && byId.json.findings[0].priority === "P0",
      byId.text.slice(0, 300),
    );

    const openOnly = await hosted.call("kritik_findings", { status: "open" });
    check("kritik_findings filters by status", !openOnly.isError && openOnly.json.total === 1, openOnly.text.slice(0, 200));

    const partitioned = await hosted.call("kritik_findings", { audit_id: "2026-08" });
    check(
      "hosted findings refuse audit_id partitioning",
      partitioned.isError && /living pool/.test(partitioned.json.message),
      partitioned.text.slice(0, 300),
    );

    const matrix = await hosted.call("kritik_matrix", {});
    check(
      "kritik_matrix reads the hosted section, flat like repo mode's ...file spread",
      !matrix.isError &&
        "web" in matrix.json.overall &&
        typeof matrix.json.matrix === "object" &&
        matrix.json.matrix.SEC?.web !== undefined &&
        matrix.json.open_findings === 1,
      matrix.text.slice(0, 300),
    );
    check(
      "hosted matrix carries no audit_id/commit — there is no audit file to carry them",
      !("audit_id" in matrix.json) && !("commit" in matrix.json),
      matrix.text.slice(0, 300),
    );

    eventsReceived.length = 0;
    const matrixRecordNoId = await hosted.call("kritik_matrix", { record: true });
    check(
      "hosted matrix record=true without audit_id refuses, naming what to pass",
      matrixRecordNoId.isError && /audit_id/.test(matrixRecordNoId.json.message),
      matrixRecordNoId.text.slice(0, 300),
    );
    check("and nothing was posted", eventsReceived.length === 0, JSON.stringify(eventsReceived));

    // The genuine record — the one that actually lands a completion in the
    // journal — runs LAST in this session (below, after every other read that
    // assumes "2026-08" is still the newest recorded audit and the trend has
    // one row). Only the refusal above is safe to run here.

    // Refused, not silently ignored — an agent that asked for one audit's
    // matrix must not be handed the whole pool as though it were scoped.
    const hostedScopeMatrix = await hosted.call("kritik_matrix", { scope: true });
    check(
      "hosted matrix refuses scope — a scoped re-audit is recorded with record=true",
      hostedScopeMatrix.isError && /record=true/.test(hostedScopeMatrix.json.message),
      hostedScopeMatrix.text.slice(0, 300),
    );

    const matrixScoped = await hosted.call("kritik_matrix", { audit_id: "2026-08" });
    check(
      "hosted matrix refuses audit_id rather than ignoring it",
      matrixScoped.isError && /does not partition/.test(matrixScoped.json.message),
      matrixScoped.text.slice(0, 300),
    );

    const regressions = await hosted.call("kritik_regressions", {});
    check(
      "hosted regressions compares the assessment groups it can see",
      !regressions.isError && regressions.json.total === 1 && regressions.json.regressions[0]?.kind === "level-drop" && /living pool/.test(regressions.json.note),
      regressions.text.slice(0, 300),
    );

    const regressionsRecord = await hosted.call("kritik_regressions", { record: true });
    check("hosted regressions refuses record", regressionsRecord.isError && /audit run/.test(regressionsRecord.json.message), regressionsRecord.text.slice(0, 300));

    const hostedTrend = await hosted.call("kritik_trend", {});
    check(
      "kritik_trend reads the hosted journal",
      !hostedTrend.isError && hostedTrend.json.total === 1 && hostedTrend.json.rows[0].audit_id === "2026-08" && hostedTrend.json.rows[0].cells.web.score === 70,
      hostedTrend.text.slice(0, 300),
    );

    const hostedScope = await hosted.call("kritik_scope", {});
    check(
      "kritik_scope plans from the hosted journal and section — no checkout needed",
      !hostedScope.isError &&
        hostedScope.json.since === "2026-08" &&
        JSON.stringify(hostedScope.json.cells.map((cell) => [cell.surface, cell.criterion_id, cell.kind, cell.because])) ===
          JSON.stringify([
            ["web", "SEC-01", "direct", ["F-B"]],
            ["web", "SEC-02", "widened", ["V-home"]],
          ]),
      hostedScope.text.slice(0, 400),
    );
    check("the hosted scope reports the id that names no finding", (hostedScope.json.unknown ?? []).join() === "F-GONE", hostedScope.text.slice(0, 400));

    // Hosted-only (issue #473): open_audit and rescored show what the scoped
    // re-audit already in progress (kritik_score scoped SEC-01 x web above)
    // has covered, without replaying kritik_score's own replies.
    check(
      "hosted kritik_scope's open_audit names the re-audit in progress and what it scored",
      hostedScope.json.open_audit?.audit_id === "2026-09-scoped" &&
        JSON.stringify(hostedScope.json.open_audit.scored) === JSON.stringify([{ criterion_id: "SEC-01", surface: "web" }]),
      JSON.stringify(hostedScope.json.open_audit),
    );
    check(
      "the cell that audit already scored reads rescored: true; the untouched one doesn't",
      hostedScope.json.cells.find((c) => c.criterion_id === "SEC-01")?.rescored === true &&
        hostedScope.json.cells.find((c) => c.criterion_id === "SEC-02")?.rescored === undefined,
      JSON.stringify(hostedScope.json.cells),
    );

    const issue = await hosted.call("kritik_issue", { criterion_id: "SEC-01", surface: "web", finding_id: "F-A" });
    check(
      "kritik_issue renders from a hosted finding",
      !issue.isError && ((issue.json.body && issue.json.body.includes("Open crit")) || (issue.json.title && issue.json.title.includes("Open crit"))),
      issue.text.slice(0, 300),
    );

    // --- hosted resolve/accept -------------------------------------------------

    eventsReceived.length = 0;
    const resolvedA = await hosted.call("kritik_resolve_finding", { finding_id: "F-A", resolved_by: "https://pr/9" });
    check(
      "hosted resolve posts exactly one resolved event",
      eventsReceived.length === 1 &&
        JSON.stringify(eventsReceived[0]) ===
          JSON.stringify({ events: [{ type: "quality.finding.resolved", finding_id: "F-A", resolved_by: "https://pr/9" }] }),
      JSON.stringify(eventsReceived),
    );
    check(
      "hosted resolve returns a resolved finding",
      !resolvedA.isError && resolvedA.json.finding.status === "resolved" && resolvedA.json.finding.resolved_by === "https://pr/9" && resolvedA.json.events.length > 0,
      resolvedA.text.slice(0, 300),
    );

    eventsReceived.length = 0;
    const resolvedB = await hosted.call("kritik_resolve_finding", { finding_id: "F-B" });
    check(
      "hosted resolve of an already-resolved finding is idempotent — no POST",
      !resolvedB.isError && eventsReceived.length === 0 && /Already resolved/.test(resolvedB.json.note),
      resolvedB.text.slice(0, 300),
    );

    eventsReceived.length = 0;
    const accepted = await hosted.call("kritik_accept_finding", { finding_id: "F-A", note: "owned" });
    check(
      "hosted accept posts exactly one accepted event",
      eventsReceived.length === 1 &&
        JSON.stringify(eventsReceived[0]) === JSON.stringify({ events: [{ type: "quality.finding.accepted", finding_id: "F-A", reason: "owned" }] }),
      JSON.stringify(eventsReceived),
    );
    check(
      "hosted accept returns accepted-risk with the note appended",
      !accepted.isError && accepted.json.finding.status === "accepted-risk" && accepted.json.finding.detail.endsWith("Accepted risk: owned"),
      accepted.text.slice(0, 300),
    );

    refuseEvents = true;
    const resolveRefused = await hosted.call("kritik_resolve_finding", { finding_id: "F-A" });
    check(
      "hosted resolve surfaces the server's not_open refusal",
      resolveRefused.isError && /not_open/.test(resolveRefused.text),
      resolveRefused.text.slice(0, 300),
    );
    const acceptRefused = await hosted.call("kritik_accept_finding", { finding_id: "F-A", note: "owned" });
    check(
      "hosted accept surfaces the server's not_open refusal",
      acceptRefused.isError && /not_open/.test(acceptRefused.text),
      acceptRefused.text.slice(0, 300),
    );
    refuseEvents = false;

    const resolveMissing = await hosted.call("kritik_resolve_finding", { finding_id: "F-NOPE" });
    check(
      "hosted resolve of an unknown finding_id",
      resolveMissing.isError && /No finding "F-NOPE"/.test(resolveMissing.json.message),
      resolveMissing.text.slice(0, 300),
    );

    // --- the genuine record, and its retries (issue #473 review fixes) --------
    //
    // Runs LAST in this session: it actually lands a completion in the
    // journal, which re-anchors the scope and adds a row to the trend — every
    // earlier check above assumed "2026-08" was still the newest recorded
    // audit and the trend had exactly one row.

    eventsReceived.length = 0;
    const matrixRecord = await hosted.call("kritik_matrix", { record: true, audit_id: "2026-09-scoped", commit: "abc" });
    check(
      "hosted matrix record=true posts exactly the scoped completion",
      eventsReceived.length === 1 &&
        JSON.stringify(eventsReceived[0]) ===
          JSON.stringify({ events: [{ type: "quality.audit.completed", scope: true, audit_id: "2026-09-scoped", commit: "abc" }] }),
      JSON.stringify(eventsReceived),
    );
    check(
      "the reply carries the recorded scope and the merged read",
      !matrixRecord.isError && matrixRecord.json.scope?.since === "2026-08" && typeof matrixRecord.json.matrix === "object",
      matrixRecord.text.slice(0, 300),
    );
    check(
      "left_unscored on a real record lists the scope cell this audit never scored",
      JSON.stringify(matrixRecord.json.left_unscored) === JSON.stringify([{ criterion_id: "SEC-02", surface: "web", kind: "widened" }]),
      JSON.stringify(matrixRecord.json.left_unscored),
    );
    check(
      "the stub's echo round-trips commit and counts",
      matrixRecord.json.events[0]?.commit === "abc" &&
        JSON.stringify(matrixRecord.json.events[0]?.counts) === JSON.stringify({ critical: 0 }),
      JSON.stringify(matrixRecord.json.events),
    );

    // A retry after a dropped response, now against a REAL landed recording:
    // the server refuses the same audit_id as already_recorded, and this
    // time the journal genuinely holds it — success, with left_unscored
    // dropped rather than guessed at (the scope has re-anchored on the
    // reading that just landed).
    refuseEvents = { error: "refused", refusals: [{ index: 0, reason: "already_recorded" }] };
    const retriedGenuine = await hosted.call("kritik_matrix", { record: true, audit_id: "2026-09-scoped" });
    check(
      "a retry against a genuinely landed scoped recording returns it as success",
      !retriedGenuine.isError &&
        retriedGenuine.json.audit_id === "2026-09-scoped" &&
        /Already recorded/.test(retriedGenuine.json.note ?? "") &&
        /left_unscored/.test(retriedGenuine.json.note ?? ""),
      retriedGenuine.text.slice(0, 400),
    );
    check(
      "left_unscored is omitted, not guessed at, on that retry",
      !("left_unscored" in retriedGenuine.json),
      JSON.stringify(retriedGenuine.json),
    );

    // The bug the review caught: already_recorded fires for ANY recorded
    // audit_id sharing this name — an agent that passed kritik_scope's
    // `since` ("2026-08", the comprehensive/baseline audit) by mistake, not
    // a scoped re-audit's own id, must NOT get "success" back just because
    // SOMETHING is recorded under that id.
    const retriedComprehensive = await hosted.call("kritik_matrix", { record: true, audit_id: "2026-08" });
    check(
      "a retry colliding with the comprehensive/baseline audit is refused, not reported as success",
      retriedComprehensive.isError,
      retriedComprehensive.text.slice(0, 400),
    );

    // And when nothing in the journal matches the audit_id at all, the
    // refusal surfaces as an error too — there is no landed reading to stand in.
    const retriedGhost = await hosted.call("kritik_matrix", { record: true, audit_id: "2026-05-ghost" });
    check(
      "a retry against an audit_id nothing in the journal recorded is refused",
      retriedGhost.isError,
      retriedGhost.text.slice(0, 400),
    );
    refuseEvents = false;
  } finally {
    hosted.stop();
  }

  // --- restored: a hosted project whose audit arrived with no recorded
  // reading (issue #472) --------------------------------------------------

  const restored = startSession(["--remote", "--project", "restored"], {
    ARKAIK_TOKEN: "t",
    ARKAIK_URL: baseUrl,
  });
  try {
    await restored.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kritik-test", version: "0" },
    });

    const restoredScope = await restored.call("kritik_scope", {});
    check(
      "a restored project with no recorded audit scopes from its stored audit",
      !restoredScope.isError &&
        restoredScope.json.since === "2026-08" &&
        restoredScope.json.since_ts === "2026-08-01T00:00:00.000Z" &&
        JSON.stringify(restoredScope.json.cells.map((c) => [c.criterion_id, c.kind, c.because])) === JSON.stringify([["SEC-01", "direct", ["F-B"]]]),
      restoredScope.text.slice(0, 400),
    );
    const restoredSince = await restored.call("kritik_scope", { since: "2026-08" });
    check("since=<the stored audit> resolves", !restoredSince.isError && restoredSince.json.since === "2026-08", restoredSince.text.slice(0, 300));
    // F-B has no opened event — the restored audit's findings never had one.
    // The synthesized baseline counts it open (it was, when the audit ran),
    // and its close after the audit takes it back off the line.
    const restoredBurn = await restored.call("kritik_burndown", {});
    check(
      "the restored audit is the burndown's first point, and F-B's close moves it",
      !restoredBurn.isError &&
        restoredBurn.json.points[0].cause.type === "audit" &&
        restoredBurn.json.since?.audit_id === "2026-08" &&
        restoredBurn.json.since.resolved === 1 &&
        restoredBurn.json.open === 1 &&
        restoredBurn.json.rows.find((row) => row.severity === "critical").now === 1 &&
        restoredBurn.json.rows.reduce((sum, row) => sum + row.now, 0) === 1 &&
        restoredBurn.json.rows.reduce((sum, row) => sum + row.at_reference, 0) === 2,
      restoredBurn.text.slice(0, 500),
    );
    const restoredTrend = await restored.call("kritik_trend", {});
    check(
      "the trend's first row is the restored audit, flagged baseline",
      !restoredTrend.isError &&
        restoredTrend.json.total === 1 &&
        restoredTrend.json.rows[0].audit_id === "2026-08" &&
        restoredTrend.json.rows[0].baseline === true &&
        /rebuilt/.test(restoredTrend.json.note) &&
        /no reading was recorded/.test(restoredTrend.json.note),
      restoredTrend.text.slice(0, 400),
    );

    // The first hosted score of a restored project's audit: the server
    // records that implicit reading for real before this score can overwrite
    // the level it was computed from, and says so.
    eventsReceived.length = 0;
    const restoredScored = await restored.call("kritik_score", {
      criterion_id: "SEC-01",
      surface: "web",
      level: 3,
      evidence: "auth.ts:9",
      scope: true,
    });
    check(
      "scoring a restored project with no recorded reading notes the baseline and the missing commit",
      !restoredScored.isError &&
        (restoredScored.json.notes ?? []).some((n) => /baseline/.test(n)) &&
        (restoredScored.json.notes ?? []).some((n) => /commit/.test(n)),
      restoredScored.text.slice(0, 400),
    );
    check(
      "the baseline event is found by its flag even though the stub does not put it first",
      restoredScored.json.events?.[0]?.type === "quality.assessment.scored" &&
        restoredScored.json.events?.[1]?.type === "quality.audit.completed" &&
        restoredScored.json.events[1].baseline === true,
      JSON.stringify(restoredScored.json.events),
    );

    // Once the first hosted score has written the baseline for real, the
    // first row is that recording — "no reading was recorded" would be false.
    const recordedBaselineTrend = await restored.call("kritik_trend", {});
    check(
      "after the first hosted score, the trend note says the baseline was recorded, not rebuilt",
      !recordedBaselineTrend.isError &&
        recordedBaselineTrend.json.rows[0]?.audit_id === "2026-08" &&
        recordedBaselineTrend.json.note === "The first row is the restored audit's reading, recorded when the first hosted score landed.",
      recordedBaselineTrend.text.slice(0, 400),
    );
  } finally {
    restored.stop();
  }

  // --- hosted: nothing to measure from, and two open audits ---------------

  const empty = startSession(["--remote", "--project", "empty"], { ARKAIK_TOKEN: "t", ARKAIK_URL: baseUrl });
  try {
    await empty.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kritik-test", version: "0" },
    });
    // A hosted record=true would refuse here (it records a scoped re-audit,
    // which needs an audit to measure from), so no hint may send the agent
    // there — each names the restore instead.
    const pointsAtRestore = (text) => /arkaik restore/.test(text ?? "") && !/record=true/.test(text ?? "");
    const emptyTrend = await empty.call("kritik_trend", {});
    check(
      "hosted kritik_trend with no audit points at a restore, not record=true",
      !emptyTrend.isError && emptyTrend.json.total === 0 && pointsAtRestore(emptyTrend.json.note),
      emptyTrend.text.slice(0, 400),
    );
    const emptyScope = await empty.call("kritik_scope", {});
    check(
      "hosted kritik_scope with no audit points at a restore, not record=true",
      !emptyScope.isError && emptyScope.json.since === null && emptyScope.json.open_audit === null && pointsAtRestore(emptyScope.json.note),
      emptyScope.text.slice(0, 400),
    );
    const emptySince = await empty.call("kritik_scope", { since: "2026-08" });
    check(
      "hosted kritik_scope since=<unknown> with no audit points at a restore, not record=true",
      emptySince.isError && pointsAtRestore(emptySince.json.message),
      emptySince.text.slice(0, 400),
    );
  } finally {
    empty.stop();
  }

  const twoOpen = startSession(["--remote", "--project", "twoopen"], { ARKAIK_TOKEN: "t", ARKAIK_URL: baseUrl });
  try {
    await twoOpen.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kritik-test", version: "0" },
    });
    const twoOpenScope = await twoOpen.call("kritik_scope", {});
    check(
      "open_audit is the last unrecorded audit in journal order from this since, as the server picks it — not the lexically newest",
      !twoOpenScope.isError &&
        twoOpenScope.json.open_audit?.audit_id === "2026-09-scoped" &&
        JSON.stringify(twoOpenScope.json.open_audit.scored) === JSON.stringify([{ criterion_id: "SEC-02", surface: "web" }]),
      JSON.stringify(twoOpenScope.json.open_audit),
    );
    // With recorded audits to choose from, an unknown since is answered with
    // the list — neither a restore nor a record=true would help.
    const twoOpenBadSince = await twoOpen.call("kritik_scope", { since: "2026-05" });
    check(
      "hosted kritik_scope since=<unknown> with recorded audits lists them and points at neither restore nor record=true",
      twoOpenBadSince.isError &&
        /2026-08/.test(twoOpenBadSince.json.message) &&
        !/record=true/.test(twoOpenBadSince.json.message) &&
        !/arkaik restore/.test(twoOpenBadSince.json.message),
      twoOpenBadSince.text.slice(0, 400),
    );
  } finally {
    twoOpen.stop();
    stub.close();
  }
}

run()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} Kritik MCP test(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll Kritik MCP tests passed");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

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

    const recorded = await session.call("kritik_matrix", { record: true });
    check("record:true appends quality.audit.completed", recorded.json.events[0]?.type === "quality.audit.completed", recorded.text.slice(0, 200));
    check("the event's scores are the roll-up itself", recorded.json.events[0].scores.web.SEC === recorded.json.matrix.SEC.web.score);

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
  // kritik_score (and the other writes) still refuse outright — Task 9 owns
  // their message. kritik_findings/matrix/regressions/issue are hosted reads
  // over the folded quality section a stub server stands in for.

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
      ],
      findings: [
        { id: "F-A", criterion_id: "SEC-01", surface: "web", title: "Open crit", detail: "d", evidence: "Open crit — middleware.ts:14", impact: 5, likelihood: 5, cost: "M", status: "open" },
        { id: "F-B", criterion_id: "SEC-01", surface: "web", title: "Done", detail: "d", evidence: "e", impact: 2, likelihood: 2, cost: "S", status: "resolved" },
      ],
    },
  };

  // Recorded POST bodies to /quality/events, and a mode switch for the 422
  // "refused" response the server sends when a status transition targets a
  // finding that is not open post-fold.
  const eventsReceived = [];
  let refuseEvents = false;

  function startHostedStub() {
    return http.createServer((req, res) => {
      const json = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/api/graph/projects/demo" && req.method === "GET") return json(200, { bundle: HOSTED_BUNDLE, version: "v1" });
      if (req.url === "/api/graph/projects/demo/journal" && req.method === "GET") return json(200, { journal: [] });
      if (req.url === "/api/graph/projects/demo/quality/events" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw);
          eventsReceived.push(body);
          if (refuseEvents) {
            return json(422, { error: "refused", refusals: [{ finding_id: "F-B", reason: "not_open" }] });
          }
          return json(
            200,
            {
              events: body.events.map((input) => ({
                id: "01X",
                ts: "2026-09-02T00:00:00.000Z",
                type: input.type,
                finding_id: input.finding_id,
                actor: "arkaik-agent",
              })),
            },
          );
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

    // kritik_score's own hosted refusal message is Task 9's to change — only
    // assert isError here so this test doesn't pin text that is about to move.
    const scoreRefused = await hosted.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "x" });
    check("kritik_score still refuses in hosted mode", scoreRefused.isError, scoreRefused.text.slice(0, 200));

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

    const matrixRecord = await hosted.call("kritik_matrix", { record: true });
    check("hosted matrix refuses record", matrixRecord.isError && /audit run/.test(matrixRecord.json.message), matrixRecord.text.slice(0, 300));

    const regressions = await hosted.call("kritik_regressions", {});
    check(
      "hosted regressions compares the assessment groups it can see",
      !regressions.isError && regressions.json.total === 1 && regressions.json.regressions[0]?.kind === "level-drop" && /living pool/.test(regressions.json.note),
      regressions.text.slice(0, 300),
    );

    const regressionsRecord = await hosted.call("kritik_regressions", { record: true });
    check("hosted regressions refuses record", regressionsRecord.isError && /audit run/.test(regressionsRecord.json.message), regressionsRecord.text.slice(0, 300));

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
  } finally {
    hosted.stop();
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

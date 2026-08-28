#!/usr/bin/env node

/**
 * Exercises `arkaik kritik` end to end (issue #382 phase C): install a profile
 * into a fresh repo, score cells, open/resolve/accept findings, roll up the
 * matrix, add a custom criterion, and check that the journal receives exactly
 * the `quality.*` events it should and no others.
 *
 * Drives the BUILT CLI in mkdtemp dirs, never the repo itself — so it covers
 * the shipped artifact including its bundled criteria pack, which is the half
 * a unit test of the pure module cannot see.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});

const now = new Date();
const currentAudit = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-"));
const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
const readJson = (...parts) => JSON.parse(readFileSync(path.join(dir, ...parts), "utf8"));
const journal = () =>
  existsSync(path.join(dir, "docs", "arkaik", "journal.jsonl"))
    ? readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

try {
  // --- nothing installed yet -------------------------------------------------

  const cold = run(["matrix"]);
  check("a repo with no audits says so plainly", cold.status === 1 && cold.stderr.includes("no audits directory"), cold.stderr);

  const noProfile = run(["score", "SEC-01", "web", "2", "--evidence", "x"]);
  check(
    "scoring before picking surfaces points at the fix",
    noProfile.status === 1 && noProfile.stderr.includes("arkaik kritik profile"),
    noProfile.stderr,
  );

  // --- the surface picker ----------------------------------------------------

  const profile = run(["profile", "--surface", "web:Web app:web", "--surface", "supabase:Database contract", "--weight", "SEC=2"]);
  check("profile writes the surface list", profile.status === 0, profile.stderr);
  const written = readJson("docs", "quality", "profile.json");
  check("both surfaces land", written.surfaces.length === 2 && written.surfaces[0].id === "web");
  check("the platform bridge is kept where given", written.surfaces[0].platform === "web");
  check("a surface that ships no views simply has none", written.surfaces[1].platform === undefined);
  check("domain weights land", written.domain_weights.SEC === 2);

  const reProfile = run(["profile", "--surface", "web"]);
  check(
    "re-running refuses rather than invalidating every recorded score",
    reProfile.status === 1 && reProfile.stderr.includes("--force"),
    reProfile.stderr,
  );

  const badSurface = run(["profile", "--surface", "Web App", "--force"]);
  check("a non-kebab surface id is refused", badSurface.status === 1 && badSurface.stderr.includes("kebab-case"));

  // --- scoring ---------------------------------------------------------------

  const scored = run(["score", "SEC-01", "web", "2", "--evidence", "middleware.ts:14-31", "--audit", "2026-08", "--commit", "abc1234"]);
  check("a score lands", scored.status === 0, scored.stderr);
  check("scoring below the target says so", scored.stdout.includes("below the level-3 target"), scored.stdout);
  const scores = readJson("docs", "quality", "audits", "2026-08", "scores.json");
  check("the assessment carries its evidence", scores.assessments[0].evidence === "middleware.ts:14-31");
  check("the assessment is pinned to the audit and commit", scores.assessments[0].audit_id === "2026-08" && scores.commit === "abc1234");
  check("the pack version is recorded, so scores stay comparable", typeof scores.framework_version === "string");

  const rescored = run(["score", "SEC-01", "web", "3", "--evidence", "middleware.ts:14-40 now covers refresh"]);
  check("re-scoring reports the move", rescored.stdout.includes("2 -> 3"), rescored.stdout);
  check("a cell still holds exactly one level", readJson("docs", "quality", "audits", "2026-08", "scores.json").assessments.length === 1);

  const noEvidence = run(["score", "SEC-02", "supabase", "1"]);
  check(
    "a score with no citation is refused as an opinion",
    noEvidence.status === 1 && noEvidence.stderr.includes("--evidence is required"),
    noEvidence.stderr,
  );

  const typo = run(["score", "SEC-99", "web", "1", "--evidence", "x"]);
  check("a typo'd criterion fails here, not two audits later", typo.status === 1 && typo.stderr.includes("no criterion"));
  check("and it names the ids that would have worked", typo.stderr.includes("SEC-01"), typo.stderr);

  const wrongSurface = run(["score", "SEC-01", "android", "1", "--evidence", "x"]);
  check("an undeclared surface is refused", wrongSurface.status === 1 && wrongSurface.stderr.includes("not declared"));

  const crossScore = run(["score", "SEC-01", "cross-surface", "1", "--evidence", "x"]);
  check(
    "cross-surface refuses a score, because it has no column to render in",
    crossScore.status === 1 && crossScore.stderr.includes("findings-only lens"),
    crossScore.stderr,
  );

  const badLevel = run(["score", "SEC-01", "web", "5", "--evidence", "x"]);
  check("a level outside 0-4 is refused", badLevel.status === 1 && badLevel.stderr.includes("0-4"));

  // --- findings, without a journal to write to -------------------------------

  const noJournal = run([
    "finding", "open", "SEC-01", "web",
    "--title", "Sign-out leaves the refresh token live",
    "--impact", "4", "--likelihood", "4", "--cost", "S",
    "--evidence", "auth/signout.ts:12",
  ]);
  check("a finding lands with no Arkaik map present", noJournal.status === 0, noJournal.stderr);
  check(
    "and says why nothing was journaled rather than failing",
    noJournal.stdout.includes("Kritik does not need one"),
    noJournal.stdout,
  );
  check("severity and priority are reported, derived", noJournal.stdout.includes("high / P0"), noJournal.stdout);
  check("the id follows the readable convention", noJournal.stdout.includes("F-2026-08-SEC-web-01"));

  const stored = readJson("docs", "quality", "audits", "2026-08", "findings.json");
  check("the findings wrapper is written, not a bare array", Array.isArray(stored.findings));
  // Storing severity would let it drift from the numbers it is derived from.
  check("severity is never stored on the finding", stored.findings[0].severity === undefined);
  check("priority is never stored on the finding", stored.findings[0].priority === undefined);
  check("detail defaults to the title rather than being hollow", stored.findings[0].detail === stored.findings[0].title);

  const noCost = run([
    "finding", "open", "SEC-02", "supabase",
    "--title", "x", "--impact", "3", "--likelihood", "3", "--evidence", "y",
  ]);
  check("--cost is required, because it decides priority", noCost.status === 1 && noCost.stderr.includes("--cost"));

  // --- findings, with a journal ----------------------------------------------

  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);

  const journaled = run([
    "finding", "open", "SEC-02", "supabase",
    "--title", "RLS off on two tables",
    "--impact", "5", "--likelihood", "4", "--cost", "M",
    "--evidence", "migrations/003.sql:8",
    "--nodes", "V-home",
    "--actor", "claude-code",
  ]);
  check("a finding opens against a mapped repo", journaled.status === 0, journaled.stderr);
  check("it is ranked critical / P0", journaled.stdout.includes("critical / P0"), journaled.stdout);

  const events = journal();
  // #357: this append is what makes the journal non-empty and therefore
  // cross-checked, so a pre-journal snapshot must be adopted first.
  check("the journal adopts pre-existing nodes before its first quality event", events[0].type === "journal.baseline");
  check("exactly one quality.finding.opened is appended", events.filter((e) => e.type === "quality.finding.opened").length === 1);
  const opened = events.find((e) => e.type === "quality.finding.opened");
  check("the event carries the derived severity", opened.severity === "critical", JSON.stringify(opened));
  check("the event carries the derived priority", opened.priority === "P0");
  check("the event carries the graph tie", JSON.stringify(opened.node_ids) === JSON.stringify(["V-home"]));
  check("--actor is honoured, so scores stay attributable", opened.actor === "claude-code");

  const crossFinding = run([
    "finding", "open", "SEC-01", "cross-surface",
    "--title", "Payload the web client accepts and iOS rejects",
    "--impact", "3", "--likelihood", "3", "--cost", "M", "--evidence", "api/schema.ts:40",
  ]);
  check("a finding MAY carry cross-surface, where a score may not", crossFinding.status === 0, crossFinding.stderr);

  // --- resolve, accept -------------------------------------------------------

  const resolved = run(["finding", "resolve", "F-2026-08-SEC-web-01", "--by", "https://github.com/x/y/pull/9"]);
  check("resolve closes it", resolved.status === 0, resolved.stderr);
  const resolvedEvent = journal().find((e) => e.type === "quality.finding.resolved");
  check("resolve appends its event", resolvedEvent !== undefined);
  check("resolve records what closed it", resolvedEvent.resolved_by === "https://github.com/x/y/pull/9");

  const again = run(["finding", "resolve", "F-2026-08-SEC-web-01"]);
  // Phase E's webhook will call this on every PR naming the id.
  check("resolving twice is idempotent", again.status === 0 && again.stdout.includes("already resolved"), again.stdout);
  check("and appends no second event", journal().filter((e) => e.type === "quality.finding.resolved").length === 1);

  const beforeAccept = journal().length;
  const noNote = run(["finding", "accept", "F-2026-08-SEC-supabase-01"]);
  check("accepting without a note is refused", noNote.status === 1 && noNote.stderr.includes("--note is required"));

  const accepted = run(["finding", "accept", "F-2026-08-SEC-supabase-01", "--note", "Staging only; the migration lands next sprint."]);
  check("accept records the decision", accepted.status === 0, accepted.stderr);
  const acceptedFinding = readJson("docs", "quality", "audits", "2026-08", "findings.json").findings.find(
    (f) => f.id === "F-2026-08-SEC-supabase-01",
  );
  check("the status moves to accepted-risk", acceptedFinding.status === "accepted-risk");
  check("the note lands where the validator looks for it", acceptedFinding.detail.includes("Staging only"));
  check(
    "acceptance appends no event — it is a state, not something that happened",
    journal().length === beforeAccept,
    `${beforeAccept} -> ${journal().length}`,
  );

  const ghost = run(["finding", "resolve", "F-nope"]);
  check("resolving an unknown id fails loudly", ghost.status === 1 && ghost.stderr.includes("no finding"));

  // --- the matrix ------------------------------------------------------------

  const matrix = run(["matrix"]);
  check("matrix rolls up", matrix.status === 0, matrix.stderr);
  check("the columns are exactly the declared surfaces", matrix.stdout.includes("| Domain | web | supabase |"), matrix.stdout);
  check("an unscored cell is an em dash, never a zero", matrix.stdout.includes("—"));
  check("matrix.json is written", existsSync(path.join(dir, "docs", "quality", "audits", "2026-08", "matrix.json")));

  const asJson = run(["matrix", "--json"]);
  const parsed = JSON.parse(asJson.stdout);
  check("--json prints the file's own shape", parsed.audit_id === "2026-08" && typeof parsed.overall === "object");
  check("the counts exclude resolved and accepted findings", parsed.finding_counts.critical === 0, JSON.stringify(parsed.finding_counts));

  const recorded = run(["matrix", "--record"]);
  const audit = journal().find((e) => e.type === "quality.audit.completed");
  check("--record appends the audit event", recorded.status === 0 && audit !== undefined, recorded.stderr);
  check("the event's scores are the roll-up, not a separate claim", audit.scores.web.SEC === parsed.matrix.SEC.web.score);
  check("the event carries the pack version", audit.framework_version === parsed.framework_version);

  // --- the anti-averaging cap ------------------------------------------------

  const capDir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-cap-"));
  const capRun = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: capDir });
  try {
    capRun(["profile", "--surface", "web"]);
    for (const [criterion, level] of [["SEC-01", "4"], ["SEC-02", "4"], ["SEC-04", "4"]]) {
      capRun(["score", criterion, "web", level, "--evidence", "e"]);
    }
    const clean = JSON.parse(capRun(["matrix", "--json"]).stdout);
    check("a fully-verified domain grades A", clean.matrix.SEC.web.grade === "A", JSON.stringify(clean.matrix.SEC.web));

    capRun([
      "finding", "open", "SEC-01", "web",
      "--title", "Account takeover via stale refresh token",
      "--impact", "5", "--likelihood", "5", "--cost", "M", "--evidence", "auth.ts:1",
    ]);
    const capped = JSON.parse(capRun(["matrix", "--json"]).stdout);
    check("one open Critical caps the cell at D", capped.matrix.SEC.web.grade === "D", JSON.stringify(capped.matrix.SEC.web));
    check("the cap is flagged, not hidden", capped.matrix.SEC.web.capped === true);
    check("the score itself is untouched — the cap is a grade, not a lie about the level", capped.matrix.SEC.web.score === clean.matrix.SEC.web.score);
  } finally {
    rmSync(capDir, { recursive: true, force: true });
  }

  // --- signals ---------------------------------------------------------------

  const signals = run(["signals"]);
  check("an unfiltered run sheet summarises rather than dumping four figures", signals.status === 0 && signals.stdout.includes("Narrow it"), signals.stdout);

  const filtered = run(["signals", "--criterion", "SEC-02", "--surface", "supabase"]);
  check("a filtered run sheet lists the checks", filtered.status === 0 && filtered.stdout.includes("[0]"), filtered.stdout);
  check("the rows name their cell", filtered.stdout.includes("SEC-02 x supabase"));

  const tripped = run(["signals", "--trip", "SEC-02", "--surface", "supabase", "--signal", "1", "--detail", "3 hits in migrations/012.sql"]);
  check("a trip is recorded", tripped.status === 0, tripped.stderr);
  const tripEvent = journal().find((e) => e.type === "quality.signal.tripped");
  check("the trip resolves the index to the statement itself", tripEvent.signal.startsWith("Grep"), tripEvent.signal);
  check("the trip carries what was observed", tripEvent.detail === "3 hits in migrations/012.sql");

  const afterTrip = run(["signals"]);
  check("signals exits 1 once something has tripped since the last audit", afterTrip.status === 1, String(afterTrip.status));
  check("and says what tripped", afterTrip.stdout.includes("tripped since the last recorded audit"), afterTrip.stdout);

  run(["matrix", "--record"]);
  const afterAudit = run(["signals"]);
  check("a fresh audit clears the window, so the gate goes green again", afterAudit.status === 0, afterAudit.stdout);

  // --- issue skeletons -------------------------------------------------------

  const issue = run(["issue", "SEC-01", "--surface", "web", "--level", "2"]);
  check("issue prints a title and labels", issue.status === 0 && issue.stdout.startsWith("Title: [Quality] SEC-01"), issue.stdout.slice(0, 120));
  check("the surface becomes a label", /Labels:.*\bweb\b/.test(issue.stdout));
  check("placeholders we cannot fill are left for the author", issue.stdout.includes("{"), issue.stdout);

  const wrongIssueSurface = run(["issue", "SEC-01", "--surface", "nope"]);
  check(
    "a typo'd surface is caught before an issue gets filed under it",
    wrongIssueSurface.status === 1 && wrongIssueSurface.stderr.includes("not declared"),
    wrongIssueSurface.stderr,
  );

  const fromFinding = run(["issue", "SEC-02", "--surface", "supabase", "--finding", "F-2026-08-SEC-supabase-01"]);
  check("--finding lands the finding's evidence whatever the template calls it", fromFinding.stdout.includes("migrations/003.sql:8"), fromFinding.stdout.slice(-400));
  check("--finding names and ranks the finding", fromFinding.stdout.includes("critical / P0"), fromFinding.stdout.slice(-400));

  // --- a criterion of this project's own -------------------------------------

  const custom = run([
    "criterion", "add",
    "--id", "X-01", "--domain", "RIT", "--domain-name", "House rituals",
    "--name", "Changelog discipline",
    "--question", "Does every user-facing merge carry a changelog note?",
    "--applies-to", "web,supabase",
    "--anchor", "l0=No notes.",
    "--anchor", "l1=Occasional notes.",
    "--anchor", "l2=Notes expected, unenforced.",
    "--anchor", "l3=Notes on every user-facing PR, reviewed.",
    "--anchor", "l4=CI fails a user-facing PR with no note.",
    "--weight", "2", "--signal", "grep the last 20 merged PRs for a note",
  ]);
  check("a custom criterion is added", custom.status === 0, custom.stderr);
  check("a new domain is declared alongside it", custom.stdout.includes("declared a new domain: RIT"), custom.stdout);

  const overlay = readJson("docs", "quality", "criteria.custom.json");
  check("it lands in the overlay, not the pack", overlay.criteria[0].id === "X-01");
  check("it gets an issue skeleton like every pack criterion", typeof overlay.criteria[0].issue.body_skeleton === "string");
  check("the overlay records the pack it extends", typeof overlay.extends === "string");

  const missingAnchor = run([
    "criterion", "add", "--id", "X-02", "--domain", "RIT", "--name", "n", "--question", "q?",
    "--applies-to", "web", "--anchor", "l0=a", "--anchor", "l1=b",
  ]);
  check("a criterion missing anchors is refused", missingAnchor.status === 1 && missingAnchor.stderr.includes("missing anchors l2, l3, l4"), missingAnchor.stderr);

  const shadow = run([
    "criterion", "add", "--id", "SEC-01", "--domain", "SEC", "--name", "n", "--question", "q?", "--applies-to", "web",
    "--anchor", "l0=a", "--anchor", "l1=b", "--anchor", "l2=c", "--anchor", "l3=d", "--anchor", "l4=e",
  ]);
  check("shadowing a pack id is refused without --force", shadow.status === 1 && shadow.stderr.includes("already a pack criterion"));

  run(["score", "X-01", "web", "3", "--evidence", ".github/workflows/notes.yml:1"]);
  const withCustom = JSON.parse(run(["matrix", "--json"]).stdout);
  check("the custom criterion rolls up into its own domain row", withCustom.matrix.RIT?.web?.score === 75, JSON.stringify(withCustom.matrix.RIT));
  check("and it moves the surface's overall", withCustom.overall.web !== null);

  const customIssue = run(["issue", "X-01", "--surface", "web"]);
  check("and it emits its issue skeleton through the same path", customIssue.stdout.includes("Title: [Quality] X-01"), customIssue.stdout.slice(0, 120));

  // --- a vendored pack outranks the one the CLI ships ------------------------

  // The pack a score was taken against decides what the score means, so a
  // project pinning its own copy must be obeyed by every entry point — not just
  // whichever one happened to ship the version it wanted.
  const pinDir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-pin-"));
  const pinRun = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: pinDir });
  try {
    mkdirSync(path.join(pinDir, "docs", "quality"), { recursive: true });
    writeFileSync(
      path.join(pinDir, "docs", "quality", "library.json"),
      JSON.stringify({
        version: "9.9.9-vendored",
        domains: [{ code: "OWN", name: "House rules" }],
        criteria: [
          {
            id: "OWN-01",
            domain: "OWN",
            name: "Only criterion",
            applies_to: ["web"],
            weight: 1,
            level_anchors: { l0: "a", l1: "b", l2: "c", l3: "d", l4: "e" },
          },
        ],
      }),
    );
    pinRun(["profile", "--surface", "web"]);
    const pinned = pinRun(["score", "OWN-01", "web", "3", "--evidence", "e"]);
    check("a vendored pack's own criterion scores", pinned.status === 0, pinned.stderr);
    const pinnedScores = JSON.parse(readFileSync(path.join(pinDir, "docs", "quality", "audits", currentAudit, "scores.json"), "utf8"));
    check("and the vendored version is what gets recorded", pinnedScores.framework_version === "9.9.9-vendored", pinnedScores.framework_version);

    const shipped = pinRun(["score", "SEC-01", "web", "3", "--evidence", "e"]);
    check("while the shipped pack's criteria are no longer in scope", shipped.status === 1 && shipped.stderr.includes("no criterion"), shipped.stderr);
  } finally {
    rmSync(pinDir, { recursive: true, force: true });
  }

  // --- the journal is the only thing this touched ---------------------------

  const kinds = new Set(journal().map((e) => e.type));
  check(
    "only quality.* events (plus the baseline) were ever appended",
    [...kinds].every((type) => type.startsWith("quality.") || type === "journal.baseline"),
    [...kinds].join(", "),
  );
  check("the snapshot was never rewritten", readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8") === BUNDLE);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} kritik CLI test(s) failed.`);
  process.exit(1);
}
console.log("\nAll kritik CLI tests passed.");

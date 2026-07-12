#!/usr/bin/env node

/**
 * Exercises `arkaik log` + `arkaik release` (issue #221) by spawning the built
 * CLI (packages/cli/dist/index.js) against hand-written bundle + journal.jsonl
 * fixtures in fresh `fs.mkdtemp` dirs under `os.tmpdir()` — never the repo
 * itself, so a bug here can't scaffold stray journal/archive files into this
 * working tree.
 *
 * Covers:
 *  - `log` renders the project changelog (events in order, releases as markers);
 *  - `log --node <id>` renders that node's timeline;
 *  - `log` on an empty/absent journal prints an empty-state line, exit 0;
 *  - `release <v>` appends exactly ONE release.tagged line (ULID id + actor)
 *    and prints a note draft covering the correct since-last-release slice;
 *  - `release <v> --compact` relocates that slice to
 *    journal/archive-<v>.jsonl (kept), leaving journal.jsonl valid;
 *  - `arkaik validate` stays VALID after a release, with and without --compact.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

let failures = 0;
let passes = 0;
function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}`);
    if (detail) console.log(detail);
  }
}

// A snapshot whose two nodes are both `live`, with all their history recorded.
const BUNDLE = JSON.stringify(
  {
    schema_version: 1,
    project: {
      id: "demo",
      title: "Demo",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    },
    nodes: [
      { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web", "ios"] },
      { id: "V-settings", project_id: "demo", species: "view", title: "Settings", status: "live", platforms: ["ios"] },
    ],
    edges: [],
  },
  null,
  2,
);

// Journal: both nodes created before 1.0; the 1.0→(next) slice is status
// changes + an idea — none of which crossCheckJournal needs once compacted
// (provenance predates 1.0; removing the only status changes leaves no stale
// "last status" to disagree with the snapshot).
const JOURNAL_LINES = [
  { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
  { id: "01B", ts: "2026-01-01T02:00:00.000Z", type: "node.created", node_id: "V-settings", species: "view", title: "Settings" },
  { id: "01E", ts: "2026-01-02T00:00:00.000Z", type: "release.tagged", version: "1.0" },
  { id: "01F", ts: "2026-01-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
  { id: "01G", ts: "2026-01-03T01:00:00.000Z", type: "node.status_changed", node_id: "V-settings", from: "idea", to: "live" },
  { id: "01H", ts: "2026-01-03T02:00:00.000Z", type: "idea.proposed", title: "Dark mode" },
];
const JOURNAL = JOURNAL_LINES.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** Fresh temp dir with bundle.json (+ optional journal.jsonl). Returns its bundle path. */
function fixture(journal = JOURNAL) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-logrel-"));
  const bundlePath = path.join(dir, "bundle.json");
  writeFileSync(bundlePath, BUNDLE);
  if (journal !== null) writeFileSync(path.join(dir, "journal.jsonl"), journal);
  return { dir, bundlePath };
}

function readEvents(journalPath) {
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

const created = [];

// ---------------------------------------------------------------------------
// log: project changelog, node timeline, empty-state.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath } = fixture();
  created.push(dir);

  const changelog = runCli(["log", bundlePath]);
  check("log exits 0", changelog.status === 0, `${changelog.stdout}\n${changelog.stderr}`);
  const out = changelog.stdout;
  check("log prints the Changelog header", /Changelog/.test(out));
  check("log renders node.created events", /Home created/.test(out) && /Settings created/.test(out));
  check("log marks the release as a version boundary", /== 1\.0 ==/.test(out), out);
  check("log renders a status change", /Home: idea -> live/.test(out), out);
  check("log renders the idea", /Idea: Dark mode/.test(out), out);
  // Ordering: node.created lines come before the 1.0 marker.
  check(
    "log orders events (created before the 1.0 marker)",
    out.indexOf("Home created") < out.indexOf("== 1.0 =="),
    out,
  );

  const timeline = runCli(["log", "--node", "V-home", bundlePath]);
  check("log --node exits 0", timeline.status === 0);
  check("log --node prints a Timeline header for the node", /Timeline — Home/.test(timeline.stdout), timeline.stdout);
  check(
    "log --node V-home shows only V-home's events",
    /Home created/.test(timeline.stdout) &&
      /Home: idea -> live/.test(timeline.stdout) &&
      !/Settings created/.test(timeline.stdout),
    timeline.stdout,
  );
}

// Empty journal → empty-state, never an error.
{
  const { dir, bundlePath } = fixture("");
  created.push(dir);
  const empty = runCli(["log", bundlePath]);
  check("log on empty journal exits 0", empty.status === 0);
  check("log on empty journal prints an empty-state line", /No journal events yet/.test(empty.stdout), empty.stdout);

  const emptyNode = runCli(["log", "--node", "V-home", bundlePath]);
  check("log --node on empty journal exits 0", emptyNode.status === 0);
  check(
    "log --node on empty journal prints a node empty-state line",
    /No journal events for node V-home/.test(emptyNode.stdout),
    emptyNode.stdout,
  );
}

// Absent journal (no sidecar at all) → still the empty state, not a crash.
{
  const { dir, bundlePath } = fixture(null);
  created.push(dir);
  const absent = runCli(["log", bundlePath]);
  check("log with no sidecar exits 0", absent.status === 0);
  check("log with no sidecar prints the empty state", /No journal events yet/.test(absent.stdout), absent.stdout);
}

// ---------------------------------------------------------------------------
// release (no --compact): appends exactly one release.tagged line, drafts notes,
// leaves validate green.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath } = fixture();
  created.push(dir);
  const journalPath = path.join(dir, "journal.jsonl");

  const before = readEvents(journalPath);
  const beforeReleases = before.filter((e) => e.type === "release.tagged").length;

  const result = runCli(["release", "1.1", bundlePath]);
  check("release exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);

  const after = readEvents(journalPath);
  const added = after.length - before.length;
  check("release appends exactly one journal line", added === 1, `added=${added}`);

  const newEvents = after.filter((e) => !before.some((b) => b.id === e.id));
  check("release appends exactly one release.tagged event", newEvents.length === 1 && newEvents[0].type === "release.tagged");
  const rel = newEvents[0];
  check("appended release.tagged carries the version", rel.version === "1.1");
  check("appended release.tagged has a ULID id (26 Crockford base32 chars)", /^[0-9A-HJKMNP-TV-Z]{26}$/.test(rel.id), rel.id);
  check("appended release.tagged has an ISO ts", !Number.isNaN(Date.parse(rel.ts)));
  check("appended release.tagged stamps an actor", typeof rel.actor === "string" && rel.actor.length > 0);
  check(
    "release count went up by exactly one",
    after.filter((e) => e.type === "release.tagged").length === beforeReleases + 1,
  );

  // Draft covers the since-1.0 slice (status changes + idea), not the pre-1.0
  // node.created events.
  const draft = result.stdout;
  check("draft names the version and the since-version", /Release notes DRAFT — 1\.1/.test(draft) && /since 1\.0/.test(draft), draft);
  check("draft covers the correct slice", /Home: idea -> live/.test(draft) && /Idea: Dark mode/.test(draft), draft);
  check("draft excludes the pre-1.0 node.created events", !/created/.test(draft), draft);

  // validate stays green after the release.
  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID after release", validate.status === 0 && /VALID/.test(validate.stdout), validate.stdout);
}

// ---------------------------------------------------------------------------
// release --compact: relocate the slice to the archive, keep journal.jsonl valid.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath } = fixture();
  created.push(dir);
  const journalPath = path.join(dir, "journal.jsonl");
  const archivePath = path.join(dir, "journal", "archive-1.1.jsonl");

  const result = runCli(["release", "1.1", "--compact", bundlePath]);
  check("release --compact exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  check("release --compact reports the archive move", /archive-1\.1\.jsonl/.test(result.stdout), result.stdout);

  check("compaction wrote the archive file", existsSync(archivePath));
  const archived = readEvents(archivePath);
  check(
    "archive holds exactly the between-markers slice (3 events, by id)",
    archived.map((e) => e.id).join(",") === "01F,01G,01H",
    archived.map((e) => e.id).join(","),
  );

  const working = readEvents(journalPath);
  const workingIds = working.map((e) => e.id);
  check("slice ids are gone from the working journal", !["01F", "01G", "01H"].some((id) => workingIds.includes(id)), workingIds.join(","));
  check("both release markers remain in the working journal", working.some((e) => e.version === "1.0") && working.some((e) => e.version === "1.1"));
  check("node.created provenance remains in the working journal", workingIds.includes("01A") && workingIds.includes("01B"));

  // journal.jsonl is still well-formed: trailing newline, one JSON object per line.
  const text = readFileSync(journalPath, "utf8");
  check("working journal ends with a newline", text.endsWith("\n"));

  // The whole point: validate is still green with the compacted journal.
  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID after --compact", validate.status === 0 && /VALID/.test(validate.stdout), validate.stdout);
}

// ---------------------------------------------------------------------------
// release rejects an invalid --platform enum before touching the journal.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath } = fixture();
  created.push(dir);
  const journalPath = path.join(dir, "journal.jsonl");
  const before = readFileSync(journalPath, "utf8");

  const result = runCli(["release", "2.0", "--platform", "windows", bundlePath]);
  check("release with a bad platform exits 1", result.status === 1);
  check("release with a bad platform does NOT append a line", readFileSync(journalPath, "utf8") === before);
}

for (const dir of created) rmSync(dir, { recursive: true, force: true });

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);

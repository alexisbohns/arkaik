#!/usr/bin/env node

/**
 * Regression tests for the two journal-validation traps (#357, #358), spawning
 * the built CLI (packages/cli/dist/index.js) against hand-written fixtures in
 * fresh `fs.mkdtemp` dirs — never the repo itself.
 *
 * #357 — a journal-less bundle's FIRST event makes its journal non-empty, and
 * therefore cross-checked, so every pre-existing node used to read as missing
 * provenance forever. Writers now append one `journal.baseline` first.
 *
 * #358 — `release --compact` relocates history into journal/archive-<v>.jsonl,
 * which the validator never read, so compaction could archive a node's
 * node.created (first release) or strand an older status transition as the new
 * "last" one (ordinary release). Validators now fold the archives back in.
 *
 * Each `--compact` case ends by DELETING the archive and re-running validate:
 * the failure it reproduces must come back, or the case proves nothing.
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

const created = [];

/** Fresh temp dir holding bundle.json (+ journal.jsonl when `journal` is given). */
function fixture(nodes, journalLines) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-baseline-"));
  created.push(dir);
  const bundlePath = path.join(dir, "bundle.json");
  writeFileSync(
    bundlePath,
    JSON.stringify(
      {
        schema_version: 3,
        project: {
          id: "demo",
          title: "Demo",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-06T00:00:00.000Z",
        },
        nodes,
        edges: [],
      },
      null,
      2,
    ),
  );
  const journalPath = path.join(dir, "journal.jsonl");
  if (journalLines !== undefined) {
    writeFileSync(journalPath, journalLines.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return { dir, bundlePath, journalPath };
}

function view(id, title, status) {
  return { id, project_id: "demo", species: "view", title, status, platforms: ["web"] };
}

function readEvents(journalPath) {
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// #357 — a journal-less bundle survives its first event.
// ---------------------------------------------------------------------------
{
  const { bundlePath, journalPath } = fixture([view("V-home", "Home", "live"), view("V-settings", "Settings", "live")]);

  const before = runCli(["validate", bundlePath]);
  check("journal-less bundle starts VALID", before.status === 0, before.stdout);

  const release = runCli(["release", "1.0", bundlePath]);
  check("release on a journal-less bundle exits 0", release.status === 0, `${release.stdout}\n${release.stderr}`);
  check("release reports the adoption", /Journal baseline: 2 pre-existing node\(s\)/.test(release.stdout), release.stdout);

  const events = readEvents(journalPath);
  check("the baseline is written FIRST, before the marker", events[0]?.type === "journal.baseline", JSON.stringify(events));
  check(
    "the baseline names every pre-existing node",
    JSON.stringify(events[0]?.node_ids) === JSON.stringify(["V-home", "V-settings"]),
    JSON.stringify(events[0]),
  );
  check("the baseline carries a stamped envelope", typeof events[0]?.id === "string" && events[0].id.length === 26 && events[0].actor === "arkaik-cli");
  check("release still appends exactly one marker", events.filter((e) => e.type === "release.tagged").length === 1);

  const after = runCli(["validate", bundlePath]);
  check("validate stays VALID after the first event (#357)", after.status === 0, after.stdout);

  // Once coverage is on disk, a second write must not restate it.
  const second = runCli(["deliverable", "Ship it", "--id", "pr-1", bundlePath]);
  check("a later deliverable exits 0", second.status === 0, `${second.stdout}\n${second.stderr}`);
  check("a later write emits no second baseline", !/Journal baseline/.test(second.stdout), second.stdout);
  check(
    "exactly one baseline exists in the journal",
    readEvents(journalPath).filter((e) => e.type === "journal.baseline").length === 1,
  );
  const afterDeliverable = runCli(["validate", bundlePath]);
  check("validate stays VALID after the deliverable", afterDeliverable.status === 0, afterDeliverable.stdout);
}

// A journal-less bundle whose FIRST write is a deliverable, not a release.
{
  const { bundlePath, journalPath } = fixture([view("V-home", "Home", "live")]);
  const result = runCli(["deliverable", "First thing", "--id", "pr-9", bundlePath]);
  check("deliverable on a journal-less bundle exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  const events = readEvents(journalPath);
  check(
    "deliverable adopts the journal first",
    events[0]?.type === "journal.baseline" && events[1]?.type === "deliverable.shipped",
    JSON.stringify(events),
  );
  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID after the first deliverable (#357)", validate.status === 0, validate.stdout);
}

// ---------------------------------------------------------------------------
// #358 mode 1 — the FIRST release archives everything before the marker,
// including every node.created.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath, journalPath } = fixture(
    [view("V-home", "Home", "live")],
    [
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      { id: "01B", ts: "2026-01-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
    ],
  );
  const archivePath = path.join(dir, "journal", "archive-1.0.jsonl");

  const result = runCli(["release", "1.0", "--compact", bundlePath]);
  check("first release --compact exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  check("no baseline is emitted for a fully-covered journal", !/Journal baseline/.test(result.stdout), result.stdout);
  check("the archive was written", existsSync(archivePath));
  check(
    "provenance really did leave the working journal",
    !readEvents(journalPath).some((e) => e.type === "node.created"),
    JSON.stringify(readEvents(journalPath)),
  );

  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID after the first --compact (#358)", validate.status === 0, validate.stdout);
  check("validate reports the folded archive", /archive\(s\)/.test(validate.stdout), validate.stdout);

  // Non-vacuity: without the archive, the very error #358 describes returns.
  rmSync(archivePath);
  const broken = runCli(["validate", bundlePath]);
  check(
    "removing the archive brings journal-missing-node-created back",
    broken.status === 1 && /journal-missing-node-created/.test(broken.stdout),
    broken.stdout,
  );
}

// ---------------------------------------------------------------------------
// #358 mode 2 — an ordinary release archives a MIDDLE slice holding the
// node.created of a node added since the previous marker.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath, journalPath } = fixture(
    [view("V-home", "Home", "live"), view("V-new", "New", "live")],
    [
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      { id: "01B", ts: "2026-01-01T01:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
      { id: "01C", ts: "2026-01-02T00:00:00.000Z", type: "release.tagged", version: "1.0" },
      { id: "01D", ts: "2026-01-03T00:00:00.000Z", type: "node.created", node_id: "V-new", species: "view", title: "New" },
      { id: "01E", ts: "2026-01-03T01:00:00.000Z", type: "node.status_changed", node_id: "V-new", from: "idea", to: "live" },
    ],
  );
  const archivePath = path.join(dir, "journal", "archive-1.1.jsonl");

  const result = runCli(["release", "1.1", "--compact", bundlePath]);
  check("ordinary release --compact exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  check(
    "the middle slice (V-new's provenance) was archived",
    readEvents(archivePath).some((e) => e.type === "node.created" && e.node_id === "V-new") &&
      !readEvents(journalPath).some((e) => e.node_id === "V-new"),
    `${JSON.stringify(readEvents(archivePath))}\n${JSON.stringify(readEvents(journalPath))}`,
  );

  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID after an ordinary --compact (#358)", validate.status === 0, validate.stdout);

  rmSync(archivePath);
  const broken = runCli(["validate", bundlePath]);
  check(
    "removing the archive strands V-new without provenance",
    broken.status === 1 && /journal-missing-node-created/.test(broken.stdout) && /V-new/.test(broken.stdout),
    broken.stdout,
  );
}

// ---------------------------------------------------------------------------
// #358 mode 3 — the status strand: a node's NEWEST transition lands in the
// archived middle slice while an older one survives, so the working journal
// alone claims a stale "last" status.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath, journalPath } = fixture(
    [view("V-home", "Home", "live")],
    [
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      // Survives compaction (it is before the 1.0 marker) and would become the
      // apparent last transition: development, against a snapshot saying live.
      { id: "01B", ts: "2026-01-01T01:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "development" },
      { id: "01C", ts: "2026-01-02T00:00:00.000Z", type: "release.tagged", version: "1.0" },
      { id: "01D", ts: "2026-01-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "development", to: "live" },
    ],
  );
  const archivePath = path.join(dir, "journal", "archive-1.1.jsonl");

  const result = runCli(["release", "1.1", "--compact", bundlePath]);
  check("status-strand release --compact exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  const surviving = readEvents(journalPath).filter((e) => e.type === "node.status_changed");
  check(
    "the newest transition was archived and the older one survived",
    surviving.length === 1 && surviving[0].to === "development",
    JSON.stringify(surviving),
  );

  const validate = runCli(["validate", bundlePath]);
  check("validate stays VALID with an archived last transition (#358)", validate.status === 0, validate.stdout);

  rmSync(archivePath);
  const broken = runCli(["validate", bundlePath]);
  check(
    "removing the archive brings journal-status-mismatch back",
    broken.status === 1 && /journal-status-mismatch/.test(broken.stdout),
    broken.stdout,
  );
}

// ---------------------------------------------------------------------------
// A malformed archive line is a hard error, reported with its file and line —
// folding the archives must not fold them silently.
// ---------------------------------------------------------------------------
{
  const { dir, bundlePath } = fixture(
    [view("V-home", "Home", "live")],
    [
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      { id: "01B", ts: "2026-01-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
    ],
  );
  runCli(["release", "1.0", "--compact", bundlePath]);
  const archivePath = path.join(dir, "journal", "archive-1.0.jsonl");
  writeFileSync(archivePath, `${readFileSync(archivePath, "utf8")}{ not json\n`);

  const validate = runCli(["validate", bundlePath]);
  check(
    "a malformed archive line fails validate, naming the file and line",
    validate.status === 1 && /archive-1\.0\.jsonl line 3/.test(validate.stdout),
    validate.stdout,
  );
}

for (const dir of created) rmSync(dir, { recursive: true, force: true });

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);

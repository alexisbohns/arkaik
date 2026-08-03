#!/usr/bin/env node

/**
 * Exercises `arkaik deliverable` (cycle 3): appends exactly one validated
 * deliverable.shipped line to the journal.jsonl sidecar, honours --id for
 * re-append edits, and `arkaik release` groups its draft by deliverables.
 * Runs in fresh mkdtemp dirs, never the repo itself.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
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
const CREATED = JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" });

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-deliverable-"));
try {
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
  writeFileSync(bundlePath, BUNDLE);
  writeFileSync(journalPath, `${CREATED}\n`);

  // --- append one deliverable ---
  const res = runCli(
    ["deliverable", "Ship the home page", "--id", "pr-1", "--summary", "Home ships.", "--url", "https://x/pull/1", "--nodes", "V-home", bundlePath],
    dir,
  );
  check("deliverable exits 0", res.status === 0, res.stderr);
  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  check("exactly one line appended", lines.length === 2, String(lines.length));
  const ev = JSON.parse(lines[1]);
  check("event is deliverable.shipped with the payload", ev.type === "deliverable.shipped" && ev.deliverable_id === "pr-1" && ev.title === "Ship the home page" && ev.summary === "Home ships." && ev.url === "https://x/pull/1" && Array.isArray(ev.node_ids) && ev.node_ids[0] === "V-home", lines[1]);
  check("envelope stamped (id + ts + actor)", typeof ev.id === "string" && ev.id.length === 26 && typeof ev.ts === "string" && ev.actor === "arkaik-cli", lines[1]);

  // --- default id when --id is omitted ---
  const res2 = runCli(["deliverable", "Another thing", bundlePath], dir);
  check("deliverable without --id exits 0", res2.status === 0, res2.stderr);
  const ev2 = JSON.parse(readFileSync(journalPath, "utf8").trim().split("\n")[2]);
  check("a default deliverable_id is generated", typeof ev2.deliverable_id === "string" && ev2.deliverable_id.length > 0, JSON.stringify(ev2));

  // --- dangling node ref is rejected before writing ---
  const before = readFileSync(journalPath, "utf8");
  const res3 = runCli(["deliverable", "Ghost work", "--nodes", "V-ghost", bundlePath], dir);
  check("unknown --nodes id fails", res3.status !== 0, res3.stdout);
  check("nothing appended on failure", readFileSync(journalPath, "utf8") === before);

  // --- re-append with the same --id edits (latest-wins content) ---
  const res4 = runCli(["deliverable", "Ship the home page", "--id", "pr-1", "--summary", "Home ships properly.", bundlePath], dir);
  check("re-append with same --id exits 0", res4.status === 0, res4.stderr);

  // --- release draft groups by deliverables ---
  const rel = runCli(["release", "1.0", bundlePath], dir);
  check("release exits 0", rel.status === 0, rel.stderr);
  check(
    "draft lists both deliverables with latest-wins content",
    rel.stdout.includes("Deliverables:") && rel.stdout.includes("Ship the home page — Home ships properly.") && rel.stdout.includes("Another thing"),
    rel.stdout,
  );
  check("draft does not double-list deliverables as events", !rel.stdout.includes("Shipped: "), rel.stdout);

  // --- validate stays green ---
  const val = runCli(["validate", bundlePath], dir);
  check("validate stays VALID", val.status === 0, val.stdout + val.stderr);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll deliverable CLI tests passed.");

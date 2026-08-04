#!/usr/bin/env node

/**
 * Exercises `arkaik bootstrap merge` — fragment assembly onto a bundle:
 * ID uniqueness, cross-fragment edge resolution, reconcile ops, journal
 * construction, and byte-identical determinism across runs.
 *
 * This is Task 6's own test file. Task 7 (a separate task) is expected to add
 * exhaustive merge-semantics coverage (collisions, orphan edges, reconcile,
 * journal preservation) on top of what's here — this file proves the carry-
 * forward fixes and the seven review probes the task brief called out, plus
 * the minimal collision/reconcile checks needed to trust this file's own
 * design decisions. It does not try to be Task 7's test suite.
 *
 * **Every block that produces a bundle runs `arkaik validate` on it and
 * asserts clean.** This is not incidental: a coordinator review found that
 * this file's own carry-forward-3 fixture (two `node.status_changed` events
 * for one node at the identical `ts`) merged "cleanly" by this suite's own
 * checks while producing a bundle that failed `arkaik validate` — because
 * that fixture asserted distinct ids and exit 0, but never actually ran
 * validate. Same-`ts` order-sensitive events for one node are a real defect
 * class (merge.ts's file doc, item 7), not a hypothetical; every block below
 * that writes a bundle now proves it all the way through, and the ones that
 * don't (an expected merge failure, or `--dry-run`, which writes nothing) are
 * the only exceptions, each noted at its own call site.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { loadSchema } = require(path.join(__dirname, "..", "schema", "load-schema.js"));

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

/** A repo with a manifest, an empty-ish bundle, and the given fragments. */
function scaffold(fragments, bundle) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-merge-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  mkdirSync(path.join(dir, ".arkaik", "bootstrap", "fragments"), { recursive: true });
  if (bundle) writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle));
  const units = Object.keys(fragments).map((id) => ({
    id,
    wave: Number(id[1]) || 1,
    title: id,
    scope: "",
    slice: {},
    fragment: `.arkaik/bootstrap/fragments/${id}.json`,
    status: "pending",
  }));
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "manifest.json"),
    JSON.stringify({ version: 1, mode: bundle ? "brownfield" : "greenfield", bundle: "docs/arkaik/bundle.json", units }),
  );
  for (const [id, fragment] of Object.entries(fragments)) {
    writeFileSync(path.join(dir, ".arkaik", "bootstrap", "fragments", `${id}.json`), JSON.stringify(fragment));
  }
  return dir;
}

const BASE = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [],
  edges: [],
};

// --- deterministic event ids (plan Step 1) ---
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [
        { id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"], created_ts: "2026-01-02T10:00:00.000Z" },
      ],
      edges: [],
    },
  }, BASE);
  try {
    const first = runCli(["bootstrap", "merge"], dir);
    check("merge exits 0", first.status === 0, first.stderr);
    const bundleA = readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8");
    const journalA = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8");

    runCli(["bootstrap", "merge"], dir);
    const bundleB = readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8");
    const journalB = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8");

    check("bundle output is byte-identical across runs", bundleA === bundleB, "bundle differed");
    check("journal output is byte-identical across runs", journalA === journalB, "journal differed");

    const events = journalA.trim().split("\n").map((l) => JSON.parse(l));
    check("node.created synthesized", events.length === 1 && events[0].type === "node.created", journalA);
    check("node.created uses the fragment's created_ts", events[0].ts === "2026-01-02T10:00:00.000Z", events[0].ts);
    check("event id is ULID-shaped", /^[0-9A-HJKMNP-TV-Z]{26}$/.test(events[0].id), events[0].id);
    check("created_ts is not persisted onto the node", !("created_ts" in JSON.parse(bundleA).nodes[0]), bundleA);

    // Systemic fix (coordinator review): every test that produces a bundle
    // runs `arkaik validate` on it and asserts clean — the carry-forward-3
    // bug slipped past this exact suite because one fixture stopped one line
    // short of validating. Audited and added throughout this file.
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- carry-forward 1: journal de-dup — re-running merge over an unchanged
// `events` fragment must not double the journal. The determinism block above
// only exercises `nodes` (whose node.created is idempotent incidentally, via
// the `nodes.has(id)` guard); an `events` array has no such guard, so this is
// the one the carry-forward review flagged as uncovered by that test alone.
{
  const dir = scaffold({
    "w3-decisions": {
      unit: "w3-decisions",
      wave: 3,
      events: [
        { type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship it", ts: "2026-01-05T00:00:00.000Z" },
        { type: "node.status_changed", node_id: "V-home", from: "backlog", to: "live", ts: "2026-01-05T00:00:00.000Z" },
      ],
    },
  }, { ...BASE, nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }] });
  // V-home is pre-existing (brownfield) — it needs its own node.created on
  // record, or `arkaik validate` would flag `journal-missing-node-created`
  // regardless of anything this test is actually about.
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" })}\n`,
  );
  try {
    const first = runCli(["bootstrap", "merge"], dir);
    check("events-fragment merge exits 0", first.status === 0, first.stderr);
    const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
    const linesA = readFileSync(journalPath, "utf8").trim().split("\n");
    check("first run wrote exactly 3 events (1 seeded + 2 fresh)", linesA.length === 3, linesA.join("\n"));

    const second = runCli(["bootstrap", "merge"], dir);
    check("second merge over the same fragment exits 0", second.status === 0, second.stderr);
    const contentA = readFileSync(journalPath, "utf8");
    const linesB = contentA.trim().split("\n");
    check("journal does not grow on a second, unchanged run", linesB.length === 3, linesB.join("\n"));

    const third = runCli(["bootstrap", "merge"], dir);
    check("third merge exits 0", third.status === 0, third.stderr);
    const contentB = readFileSync(journalPath, "utf8");
    check("journal byte length is stable across repeated runs (no silent growth)", contentB === contentA, "journal grew");
    check(
      "merge reports 0 new events on a re-run over unchanged fragments",
      second.stdout.includes("+0 events"),
      second.stdout,
    );
    // Also proves point 3's "identical payload stays a silent no-op": three
    // runs over the SAME fragment re-derive the SAME events every time, and
    // none of them raised a payload-divergence MergeProblem (all three
    // exited 0 above) — only a genuine content change should do that.
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- carry-forward 2: a malformed ts fails the unit loudly, not the whole process ---
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [{ id: "V-bad", species: "view", title: "Bad", status: "live", platforms: ["web"], created_ts: "not-a-real-date" }],
      edges: [],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("a malformed created_ts fails the merge (not a crash)", res.status === 1, `status=${res.status}`);
    check(
      "the failure is a clean MergeProblem naming the unit, not a raw stack trace",
      res.stderr.includes("w1-a") && !res.stderr.includes("at deterministicEventId"),
      res.stderr,
    );
    check("the failure names the bad ts", res.stderr.includes("not-a-real-date"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // Same guard on the wave-3 events path (pass 3), and on a node.status_changed
  // minted from `update` (item 4's own new call site) — both call
  // deterministicEventId too, and both must fail the same clean way.
  const dir = scaffold({
    "w3-decisions": {
      unit: "w3-decisions",
      wave: 3,
      events: [{ type: "idea.proposed", title: "An idea", ts: "also-not-a-date" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("a malformed event ts on the wave-3 path fails the merge cleanly", res.status === 1, `status=${res.status}`);
    check("the failure names the unit and the bad ts", res.stderr.includes("w3-decisions") && res.stderr.includes("also-not-a-date"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- carry-forward 3, CORRECTED (coordinator review): the wave-3 event key
// distinguishes same-node status transitions that carry DISTINCT timestamps
// — which every real one does (corpus.prs.jsonl carries full-instant ISO
// merge timestamps, not just dates). The original version of this fixture
// gave both transitions the IDENTICAL ts and asserted only `ids.size === 2`
// and exit 0 — which passed even though the resulting bundle failed
// `arkaik validate` (see the order-sensitivity block right after this one):
// distinct ids alone don't make same-ts events for one node safe to write,
// because read-back order between them is still undefined. This fixture now
// reflects a REAL, safe wave-3 output (distinct instants) and proves it all
// the way through validate, which is what should have caught the gap the
// first time.
{
  const dir = scaffold({
    "w3-status-arcs": {
      unit: "w3-status-arcs",
      wave: 3,
      events: [
        { type: "node.status_changed", node_id: "V-home", from: "idea", to: "backlog", ts: "2026-01-05T00:00:00.000Z" },
        { type: "node.status_changed", node_id: "V-home", from: "backlog", to: "live", ts: "2026-01-05T12:00:00.000Z" },
      ],
    },
  }, { ...BASE, nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }] });
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01FFFFFFFFFFFFFFFFFFFFFFFF", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" })}\n`,
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("two same-day (distinct-instant), same-node status transitions merge cleanly", res.status === 0, res.stderr);
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const changes = events.filter((e) => e.type === "node.status_changed");
    check("both status_changed events landed (not collapsed into one)", changes.length === 2, JSON.stringify(changes));
    const ids = new Set(changes.map((e) => e.id));
    check("the two transitions got DISTINCT ids", ids.size === 2, JSON.stringify(changes.map((e) => e.id)));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("CARRY-FORWARD 3 (corrected): arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- CRITICAL, coordinator review: same-ts order-sensitive events for one
// node are refused, not written with an arbitrary tie-break order. Two
// `update` patches to the same node in one fragment, neither supplying
// `changed_ts`, share the run's ONE `fallbackTs` — exactly reproduced from
// the coordinator's own report. Before this fix, this merged cleanly and
// then failed `arkaik validate`'s journal-status-mismatch depending on
// which way a hash-derived id happened to sort. ---
{
  const existing = {
    ...BASE,
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "idea", platforms: ["web"] }],
  };
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      update: [
        { id: "V-home", patch: { status: "backlog" } },
        { id: "V-home", patch: { status: "development" } },
      ],
    },
  }, existing);
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01IIIIIIIIIIIIIIIIIIIIIIII", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" })}\n`,
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check(
      "CRITICAL: two same-ts status changes to one node in one run are refused, not silently written",
      res.status === 1,
      `status=${res.status}`,
    );
    check(
      "the refusal names the node and both transitions",
      res.stderr.includes("V-home") && res.stderr.includes("backlog") && res.stderr.includes("development"),
      res.stderr,
    );
    check("the refusal points at `changed_ts` as the fix", res.stderr.includes("changed_ts"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // The same refusal, but the two order-sensitive events come from TWO
  // SEPARATE fragments/units rather than one fragment's own array — proving
  // the guard tracks across the whole run, not just within one fragment.
  const existing = {
    ...BASE,
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "idea", platforms: ["web"] }],
  };
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, update: [{ id: "V-home", patch: { status: "backlog" } }] },
    "w1-b": { unit: "w1-b", wave: 1, update: [{ id: "V-home", patch: { status: "development" } }] },
  }, existing);
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01JJJJJJJJJJJJJJJJJJJJJJJJ", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" })}\n`,
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check(
      "CRITICAL: the same-ts refusal applies ACROSS fragments too, not just within one",
      res.status === 1,
      `status=${res.status}`,
    );
    check("the refusal names both units", res.stderr.includes("w1-a") && res.stderr.includes("w1-b"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // Doesn't over-reject: different nodes sharing a ts, and platform-scoped
  // transitions for the SAME node at the SAME ts (excluded from
  // crossCheckJournal's project-level "last status" check — they move a
  // per-platform view status, not node.status) are both fine.
  const dir = scaffold({
    "w3-status-arcs": {
      unit: "w3-status-arcs",
      wave: 3,
      events: [
        { type: "node.status_changed", node_id: "V-a", from: "idea", to: "live", ts: "2026-01-05T00:00:00.000Z" },
        { type: "node.status_changed", node_id: "V-b", from: "idea", to: "live", ts: "2026-01-05T00:00:00.000Z" },
        { type: "node.status_changed", node_id: "V-a", from: "backlog", to: "live", ts: "2026-01-05T00:00:00.000Z", platform: "ios" },
        { type: "node.status_changed", node_id: "V-a", from: "backlog", to: "live", ts: "2026-01-05T00:00:00.000Z", platform: "android" },
      ],
    },
  }, {
    ...BASE,
    nodes: [
      { id: "V-a", project_id: "demo", species: "view", title: "A", status: "live", platforms: ["web", "ios", "android"] },
      { id: "V-b", project_id: "demo", species: "view", title: "B", status: "live", platforms: ["web"] },
    ],
  });
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    [
      { id: "01KKKKKKKKKKKKKKKKKKKKKKKK", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" },
      { id: "01LLLLLLLLLLLLLLLLLLLLLLLL", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-b", species: "view", title: "B" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("different nodes sharing a ts are not falsely flagged as an order conflict", res.status === 0, res.stderr);
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes (platform-scoped same-ts transitions are not order-sensitive)", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- coordinator review: a fresh event sharing an id with a committed one,
// but carrying DIFFERENT content, is refused rather than silently discarded
// as if nothing changed. Base still wins (nothing is overwritten), but the
// divergence is now loud. ---
{
  const dir = scaffold({
    "w3-decisions": {
      unit: "w3-decisions",
      wave: 3,
      events: [{ type: "deliverable.shipped", deliverable_id: "pr-42", title: "Ship it", summary: "Original summary.", ts: "2026-01-05T00:00:00.000Z" }],
    },
  }, BASE);
  try {
    const first = runCli(["bootstrap", "merge"], dir);
    check("first merge (establishing the committed event) exits 0", first.status === 0, first.stderr);

    // Correct the summary (eventKey doesn't include it, so the id is
    // unchanged) and re-run — the payload genuinely differs from committed.
    writeFileSync(
      path.join(dir, ".arkaik", "bootstrap", "fragments", "w3-decisions.json"),
      JSON.stringify({
        unit: "w3-decisions",
        wave: 3,
        events: [{ type: "deliverable.shipped", deliverable_id: "pr-42", title: "Ship it", summary: "Corrected summary.", ts: "2026-01-05T00:00:00.000Z" }],
      }),
    );
    const second = runCli(["bootstrap", "merge"], dir);
    check(
      "COORDINATOR FINDING: a divergent re-derivation of a committed event is refused, not silently discarded",
      second.status === 1,
      `status=${second.status}`,
    );
    check(
      "the refusal names the event id and shows both payloads",
      second.stderr.includes("Original summary.") && second.stderr.includes("Corrected summary."),
      second.stderr,
    );
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check(
      "the committed copy is untouched — base still wins",
      events.find((e) => e.deliverable_id === "pr-42")?.summary === "Original summary.",
      JSON.stringify(events),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // release.tagged: platform must be part of the key too (a same-day,
  // same-version, different-platform pair used to collide).
  const dir = scaffold({
    "w3-decisions": {
      unit: "w3-decisions",
      wave: 3,
      events: [
        { type: "release.tagged", version: "1.2.0", platform: "ios", ts: "2026-01-05T00:00:00.000Z" },
        { type: "release.tagged", version: "1.2.0", platform: "android", ts: "2026-01-05T00:00:00.000Z" },
      ],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("two same-day, same-version, different-platform releases merge cleanly", res.status === 0, res.stderr);
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("both release.tagged events landed", events.length === 2, JSON.stringify(events));
    const ids = new Set(events.map((e) => e.id));
    check("ios and android releases got distinct ids", ids.size === 2, JSON.stringify(events.map((e) => e.id)));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // idea.proposed with no node_id: two different ideas on the same day must
  // not collapse into one just because neither carries a node_id.
  const dir = scaffold({
    "w3-decisions": {
      unit: "w3-decisions",
      wave: 3,
      events: [
        { type: "idea.proposed", title: "Dark mode", ts: "2026-01-05T00:00:00.000Z" },
        { type: "idea.proposed", title: "Bulk export", ts: "2026-01-05T00:00:00.000Z" },
      ],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("two node_id-less ideas on the same day merge cleanly", res.status === 0, res.stderr);
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("both idea.proposed events landed", events.length === 2, JSON.stringify(events));
    const ids = new Set(events.map((e) => e.id));
    check("two different same-day, node_id-less ideas got distinct ids", ids.size === 2, JSON.stringify(events.map((e) => e.id)));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 1: status changes without journal events would fail `arkaik
// validate`'s journal-status-mismatch — verified against the REAL validator,
// not by reading crossCheckJournal. A node needs PRIOR status history (a
// real node.status_changed already on record) for the mismatch check to
// have a "last" value to disagree with — see merge.ts's file doc, item 4 —
// so the fixture below seeds that history before reconciling.
{
  const existing = {
    ...BASE,
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "development", platforms: ["web"] }],
  };
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      update: [{ id: "V-home", patch: { status: "live" }, changed_ts: "2026-02-01T00:00:00.000Z" }],
    },
  }, existing);
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    [
      { id: "01AAAAAAAAAAAAAAAAAAAAAAAA", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      { id: "01BBBBBBBBBBBBBBBBBBBBBBBB", ts: "2026-01-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "development" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  try {
    const merged = runCli(["bootstrap", "merge"], dir);
    check("reconcile-with-prior-history merge exits 0", merged.status === 0, merged.stderr);
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check(
      "PROBE 1: arkaik validate passes after a status-changing update (node.status_changed was emitted)",
      validated.status === 0,
      validated.stdout + validated.stderr,
    );
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const change = events.find((e) => e.type === "node.status_changed" && e.to === "live");
    check("a node.status_changed(development -> live) was recorded", change && change.from === "development", JSON.stringify(events));
    check("it used the fragment's changed_ts", change.ts === "2026-02-01T00:00:00.000Z", JSON.stringify(change));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // The retire side of the same probe: an existing node with real status
  // history, archived via `retire`, must also leave a node.status_changed
  // behind it, or the same journal-status-mismatch would fire.
  const existing = {
    ...BASE,
    nodes: [{ id: "V-legacy", project_id: "demo", species: "view", title: "Legacy", status: "live", platforms: ["web"] }],
  };
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, retire: [{ id: "V-legacy", reason: "superseded", changed_ts: "2026-02-01T00:00:00.000Z" }] },
  }, existing);
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    [
      { id: "01CCCCCCCCCCCCCCCCCCCCCCCC", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-legacy", species: "view", title: "Legacy" },
      { id: "01DDDDDDDDDDDDDDDDDDDDDDDD", ts: "2026-01-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-legacy", from: "idea", to: "live" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  try {
    const merged = runCli(["bootstrap", "merge"], dir);
    check("retire-with-prior-history merge exits 0", merged.status === 0, merged.stderr);
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check(
      "PROBE 1: arkaik validate passes after retire (node.status_changed to archived was emitted)",
      validated.status === 0,
      validated.stdout + validated.stderr,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 2: node.created is not duplicated for brownfield (already-existing) nodes ---
{
  const existing = {
    ...BASE,
    nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  };
  const dir = scaffold({
    // A brownfield reconcile fragment re-declaring an already-existing node
    // (same id, same title) alongside one genuinely new node.
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      add: [
        { id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"] },
        { id: "V-new", species: "view", title: "New", status: "live", platforms: ["web"], created_ts: "2026-03-01T00:00:00.000Z" },
      ],
    },
  }, existing);
  writeFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01EEEEEEEEEEEEEEEEEEEEEEEE", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" })}\n`,
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 2: re-declaring an existing brownfield node merges cleanly", res.status === 0, res.stderr);
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const createdEvents = events.filter((e) => e.type === "node.created");
    check("V-home has exactly ONE node.created (not duplicated)", createdEvents.filter((e) => e.node_id === "V-home").length === 1, JSON.stringify(createdEvents));
    check("V-new got its own node.created", createdEvents.some((e) => e.node_id === "V-new"), JSON.stringify(createdEvents));
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check("both nodes present, no duplication in the snapshot either", bundle.nodes.length === 2, JSON.stringify(bundle.nodes));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes (every snapshot node has exactly one node.created)", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 5: empty and degenerate inputs ---
{
  // No fragments at all: a freshly-planned manifest with a unit but no
  // fragment file written yet. Must succeed (not fatal) and write the
  // scaffold bundle.
  const dir = scaffold({}, undefined);
  // scaffold() with an empty fragments map still needs a manifest with at
  // least the recon unit for this to be a realistic "plan ran, nothing
  // written yet" state.
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "manifest.json"),
    JSON.stringify({
      version: 1,
      mode: "greenfield",
      bundle: "docs/arkaik/bundle.json",
      units: [{ id: "w0-recon", wave: 0, title: "Recon", scope: "", slice: { docs: true }, fragment: ".arkaik/bootstrap/fragments/w0-recon.json", status: "pending" }],
    }),
  );
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 5: merge with zero fragments succeeds (not fatal)", res.status === 0, res.stderr);
    check("it reports the missing fragment rather than failing", res.stdout.includes("w0-recon"), res.stdout);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check("an empty scaffold bundle was written", Array.isArray(bundle.nodes) && bundle.nodes.length === 0, JSON.stringify(bundle));
    const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
    check("an empty journal.jsonl was written without crashing", readFileSync(journalPath, "utf8") === "", "journal not empty");
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the empty scaffold", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // A fragment with every array present but empty.
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [], edges: [], add: [], update: [], retire: [], events: [] },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 5: an all-empty-arrays fragment merges cleanly (no-op)", res.status === 0, res.stderr);
    check("reports zero of everything", res.stdout.includes("+0 nodes") && res.stdout.includes("+0 edges") && res.stdout.includes("+0 events"), res.stdout);
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 7: loadFragments does not trust `unit.fragment` from manifest.json ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "V-real", species: "view", title: "Real", status: "live", platforms: ["web"] }], edges: [] },
  }, BASE);
  try {
    // Simulate a manifest.json edited (or corrupted) so `fragment` points
    // somewhere else entirely. merge must still find and use the fragment at
    // its canonical, id-derived path — the stored `fragment` string must have
    // zero effect on what gets read.
    const manifestPath = path.join(dir, ".arkaik", "bootstrap", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    // Plant a decoy file at the tampered path with DIFFERENT content, so a
    // bug that actually followed `fragment` would produce a visibly wrong
    // bundle instead of silently succeeding either way.
    const decoyPath = path.join(dir, "decoy-fragment.json");
    writeFileSync(decoyPath, JSON.stringify({ unit: "w1-a", wave: 1, nodes: [{ id: "V-decoy", species: "view", title: "Decoy", status: "live", platforms: ["web"] }], edges: [] }));
    manifest.units[0].fragment = "../decoy-fragment.json";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 7: merge succeeds despite a tampered `fragment` field", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check("the REAL fragment's node landed (id-derived path, not the tampered one)", bundle.nodes.some((n) => n.id === "V-real"), JSON.stringify(bundle.nodes));
    check("the decoy's node did NOT land", !bundle.nodes.some((n) => n.id === "V-decoy"), JSON.stringify(bundle.nodes));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // An unsafe id in manifest.json (traversal attempt) is rejected loudly,
  // not silently resolved.
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [], edges: [] },
  }, BASE);
  try {
    const manifestPath = path.join(dir, ".arkaik", "bootstrap", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.units[0].id = "../../etc/passwd";
    manifest.units[0].fragment = "../../etc/passwd.json";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 7: an unsafe unit id in manifest.json fails the merge, not resolved", res.status === 1, `status=${res.status}`);
    check("the failure names the unsafe id", res.stderr.includes("passwd"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- self-review finding: node id collisions are caught ACROSS merge runs,
// not just within one (nodeOrigin now seeded from base nodes too) ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "V-shared", species: "view", title: "First Meaning", status: "live", platforms: ["web"], created_ts: "2026-01-01T00:00:00.000Z" }], edges: [] },
  }, BASE);
  try {
    const first = runCli(["bootstrap", "merge"], dir);
    check("first run (introducing V-shared) exits 0", first.status === 0, first.stderr);
    const validatedFirst = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes after the first run", validatedFirst.status === 0, validatedFirst.stdout + validatedFirst.stderr);

    // A later, unrelated fragment (as if from a different area's agent,
    // re-run after the first merge already persisted) reuses the same id for
    // something else entirely.
    writeFileSync(
      path.join(dir, ".arkaik", "bootstrap", "fragments", "w1-b.json"),
      JSON.stringify({ unit: "w1-b", wave: 1, nodes: [{ id: "V-shared", species: "view", title: "Different Meaning", status: "live", platforms: ["web"] }], edges: [] }),
    );
    const manifestPath = path.join(dir, ".arkaik", "bootstrap", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.units.push({ id: "w1-b", wave: 1, title: "w1-b", scope: "", slice: {}, fragment: ".arkaik/bootstrap/fragments/w1-b.json", status: "pending" });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const second = runCli(["bootstrap", "merge"], dir);
    check(
      "SELF-REVIEW: a later fragment colliding with an ALREADY-PERSISTED node id fails the merge",
      second.status === 1,
      `status=${second.status}`,
    );
    check("the cross-run collision names both titles", second.stderr.includes("First Meaning") && second.stderr.includes("Different Meaning"), second.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 4: serializeBundle -> parseBundle -> validateBundle round trip ---
{
  const { parseBundle, validateBundle } = loadSchema();
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [
        { id: "F-onboarding", species: "flow", title: "Onboarding", status: "live", platforms: ["web"], created_ts: "2026-01-01T00:00:00.000Z", metadata: { playlist: { entries: [{ type: "view", view_id: "V-welcome" }] } } },
        { id: "V-welcome", species: "view", title: "Welcome", status: "live", platforms: ["web"], created_ts: "2026-01-01T00:00:00.000Z" },
        // A decision fragment that OMITS `platforms` entirely — the exact
        // zod-vs-validateBundle parity gap probe 4 asks about.
        { id: "DEC-use-react-flow", species: "decision", title: "Use React Flow", status: "backlog", created_ts: "2026-01-01T00:00:00.000Z", metadata: { decision_status: "proposed" } },
      ],
      edges: [{ source_id: "F-onboarding", target_id: "V-welcome", kind: "composes" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("probe 4 fixture merges cleanly", res.status === 0, res.stderr);
    const bundleText = readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8");
    const bundleObj = JSON.parse(bundleText);

    const decision = bundleObj.nodes.find((n) => n.id === "DEC-use-react-flow");
    check(
      "PROBE 4: merge defaulted the decision's missing `platforms` to []",
      Array.isArray(decision?.platforms) && decision.platforms.length === 0,
      JSON.stringify(decision),
    );

    const parsed = parseBundle(bundleObj);
    check("PROBE 4: the merged bundle round-trips through zod's parseBundle", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues ?? parsed.error));

    // NOTE: this direct validateBundle(bundleObj) call does NOT fold in the
    // journal.jsonl sidecar (bundleObj has no embedded `journal`, and nothing
    // here folds the sidecar in manually) — so crossCheckJournal's checks
    // (journal-missing-node-created, journal-status-mismatch) are silently
    // SKIPPED by this call alone. Kept for its own narrow purpose (comparing
    // the schema's raw validateBundle against parseBundle), but the REAL
    // `arkaik validate` CLI call right below is what actually exercises the
    // journal fold — the systemic fix this whole file went through after the
    // coordinator found a fixture that stopped one line short of it.
    const validated = validateBundle(bundleObj);
    check(
      "PROBE 4: validateBundle itself finds no errors on the merged bundle (only, at most, warnings)",
      validated.errors.length === 0,
      JSON.stringify(validated.errors),
    );

    const cliValidated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("PROBE 4: the real `arkaik validate` (journal folded in) also passes", cliValidated.status === 0, cliValidated.stdout + cliValidated.stderr);

    // Re-serialize what parseBundle handed back and confirm it's still the
    // same canonical text — serializeBundle should be a fixed point here.
    const { serializeBundle } = loadSchema();
    const reserialized = serializeBundle(parsed.data);
    check("re-serializing the parsed bundle is idempotent (canonical fixed point)", reserialized === bundleText, "reserialize differs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- probe 3 (explicit): updated_at when the journal is empty ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [], edges: [], add: [], update: [], retire: [], events: [] },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("PROBE 3: merge with zero resulting journal events exits 0 (no crash on empty journal)", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check(
      "updated_at falls back to the base project's own updated_at when the journal is empty",
      bundle.project.updated_at === BASE.project.updated_at,
      bundle.project.updated_at,
    );
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- self-review finding: FragmentEdge.kind must translate to the bundle's
// `edge_type` field. Every edge fixture in this plan (Task 7's and Task 9's
// alike) writes `kind: "composes"`; the bundle schema's field is `edge_type`
// (EdgeSchema / validate.ts's `valid-edge-type`). The reference merge.ts
// spread the raw fragment edge onto the bundle edge with no translation at
// all, so every merged edge silently carried `kind` and no `edge_type` —
// caught here via probe 4's round trip, not by either of those plans' own
// tests (neither runs `arkaik validate` against a fixture with edges).
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [
        { id: "F-onboarding", species: "flow", title: "Onboarding", status: "live", platforms: ["web"], metadata: { playlist: { entries: [{ type: "view", view_id: "V-welcome" }] } } },
        { id: "V-welcome", species: "view", title: "Welcome", status: "live", platforms: ["web"] },
      ],
      edges: [{ source_id: "F-onboarding", target_id: "V-welcome", kind: "composes" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("SELF-REVIEW: kind-only edge merges cleanly", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    const edge = bundle.edges[0];
    check("the merged edge carries `edge_type` (not just `kind`)", edge.edge_type === "composes", JSON.stringify(edge));
    check("`kind` itself does not leak onto the merged edge", !("kind" in edge), JSON.stringify(edge));
    const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
    check("arkaik validate passes on a kind-only edge fragment", validated.status === 0, validated.stdout + validated.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // An edge fragment missing BOTH `kind` and `edge_type` fails loudly, naming the edge.
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [
        { id: "F-onboarding", species: "flow", title: "Onboarding", status: "live", platforms: ["web"] },
        { id: "V-welcome", species: "view", title: "Welcome", status: "live", platforms: ["web"] },
      ],
      edges: [{ source_id: "F-onboarding", target_id: "V-welcome" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("an edge with no kind/edge_type fails the merge", res.status === 1, `status=${res.status}`);
    check("the failure names the edge endpoints", res.stderr.includes("F-onboarding") && res.stderr.includes("V-welcome"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- --dry-run reports what would change but writes nothing ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "V-x", species: "view", title: "X", status: "live", platforms: ["web"] }], edges: [] },
  }, undefined);
  try {
    const res = runCli(["bootstrap", "merge", "--dry-run"], dir);
    check("--dry-run exits 0", res.status === 0, res.stderr);
    check("--dry-run output is prefixed", res.stdout.startsWith("[dry-run]"), res.stdout);
    check("--dry-run does not write the bundle", !existsSync(path.join(dir, "docs", "arkaik", "bundle.json")), "bundle.json was written");
    check("--dry-run does not write the journal", !existsSync(path.join(dir, "docs", "arkaik", "journal.jsonl")), "journal.jsonl was written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = scaffold({}, BASE);
  try {
    const help = runCli(["bootstrap", "merge", "--help"], dir);
    check("merge --help exits 0", help.status === 0, help.stderr);
    check("merge --help documents --dry-run", help.stdout.includes("--dry-run"), help.stdout);
    const unknown = runCli(["bootstrap", "merge", "--nope"], dir);
    check("merge rejects an unknown option", unknown.status === 1, String(unknown.status));
    check("merge names the unknown option", unknown.stderr.includes("--nope"), unknown.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-merge-nomanifest-"));
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("merge with no manifest fails loudly", res.status === 1, String(res.status));
    check("merge with no manifest names the missing manifest", res.stderr.includes("plan"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failures === 0 ? 0 : 1);

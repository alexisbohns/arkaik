#!/usr/bin/env node

/**
 * Exercises `arkaik restore` (docs/superpowers/plans/2026-08-04-bootstrap-method.md
 * Task 12, docs/superpowers/specs/2026-08-04-bootstrap-method-design.md § 7).
 *
 * This is the one destructive verb the CLI offers, and the server keeps no
 * pre-image — the client-side backup this command writes before it ever
 * sends the destructive PUT is the only recovery path that exists. So this
 * suite weighs its coverage accordingly: every one of the original six
 * probes gets a dedicated case, PLUS a coordinator review round that found a
 * Critical (an empty/short outbound journal silently wiping hosted history)
 * and four Important findings, all covered below.
 *
 * Two layers, mirroring tests/cli/push.test.js (restore's closest template):
 *  - `runRestore()`/`reportRestore()` exercised in-process:
 *    packages/cli/src/commands/restore.ts is esbuild-bundled (same technique
 *    build.js uses for the real CLI, just to a throwaway `.test-build/` dir)
 *    into an importable ESM module, so a mock `httpClient` can be injected
 *    straight into the exported function — no real network, ever, ONLY a
 *    real filesystem (temp dirs), which is what the backup-write probes
 *    actually need to exercise. `reportRestore` is exported specifically so
 *    its console output (the undo-hint line, the dry-run wording) can be
 *    captured directly — safe to call in-process on a SUCCESS result only,
 *    since that path sets `process.exitCode` instead of calling
 *    `process.exit()` (see restore.ts's own comment on that).
 *  - the built CLI binary (packages/cli/dist/index.js) spawned for the
 *    argv-parsing / exit-code / --help contract, using only cases that fail
 *    before any network call would be attempted.
 *
 * Quality (#389) is covered here too, because `restore` assembles its own
 * outbound bundle rather than going through `runPack` and so inherited none
 * of `pack`'s fold: the merged section riding along, `--no-quality` deleting
 * one the local bundle carried, `--audit` pinning a snapshot, and the
 * quality-loss guard — which, like the history and deletion guards, must
 * refuse BEFORE the backup is written.
 *
 * Probe -> coverage map (original six):
 *  1. Backup-before-destructive, fail-closed: export GET throws, export GET
 *     non-200, export response not bundle-shaped, export bundle missing a
 *     journal array, and an unwritable backup directory — every one refuses
 *     with no PUT ever sent.
 *  2. What's in the backup: the written file is asserted to hold the EXPORT
 *     response's nodes/edges/journal (pre-restore hosted state), not the
 *     local bundle being sent.
 *  3. If-Match sourcing + 412: conflict message names the read/current
 *     versions, points at the backup + undo command, and does NOT say
 *     "retry".
 *  4. --dry-run takes no backup at all (asserted: no .backups dir created,
 *     no export call made) but still requires a version read for its own
 *     If-Match.
 *  5. Body assembly: bundle.json (no embedded journal) + journal.jsonl
 *     sidecar combine correctly; a bundle.json that DOES embed a journal
 *     wins over the sidecar (loadJournalEvents precedence).
 *  6. Every failure status (404, 428, 400 x2, 412, 403 x2, 413, 422) gets its
 *     own distinct, actionable message, and the real-restore ones name the
 *     backup path AND the undo command.
 *
 * Coordinator round-2 findings -> coverage map:
 *  Critical. History-shrink guard: an outbound journal SHORTER than the
 *    hosted one refuses (zero PUTs) unless --allow-history-loss; equal or
 *    more proceeds normally. Includes the exact empty-journal case (no
 *    sidecar, no embedded journal) that motivated the fix.
 *  Important 2. The backup lands at cwd/docs/arkaik/.backups — anchored to
 *    the LINK FILE's directory — even when --path points at a bundle
 *    entirely outside docs/arkaik/.
 *  Important 3. The undo command ("arkaik restore <backupPath>") is printed
 *    on the SUCCESS path via reportRestore, not just baked into failure
 *    messages.
 *  Important 4. writeBackupFile's exclusivity: a colliding timestamp (clock
 *    frozen so two restores compute the IDENTICAL stamp deterministically)
 *    refuses rather than silently overwriting the earlier backup. NOTE: a
 *    literal "the write succeeded but the bytes read back are corrupt"
 *    simulation was investigated and is not achievable black-box — verified
 *    empirically that mutating `require("fs").readFileSync` does NOT affect
 *    an ESM `import { readFileSync } from "node:fs"` binding inside a
 *    separately esbuild-bundled module (Node's builtin ESM facade doesn't
 *    read through the mutated CJS export), and no dependency-free technique
 *    reliably corrupts a synchronous write-then-read within one function
 *    call without a mocking library. The collision test below and the
 *    unwritable-directory test (probe 1) jointly prove the actual claim
 *    that matters instead: the ENTIRE write+verify region is one try/catch,
 *    and ANY failure inside it — permission denial or an EEXIST collision —
 *    aborts cleanly with no PUT sent, never silently proceeding on a
 *    backup that wasn't confirmed good.
 *  Important 5. 404's message says "Nothing was written" (matching every
 *    other branch), not "Nothing was sent" (the request manifestly WAS
 *    sent — that's how a 404 response exists at all).
 *  Minor 6. The failure-matrix table's mustInclude/mustNotInclude fields are
 *    wired into the loop's assertions (previously declared but never read).
 *  Minor 7. projectId is percent-encoded into every URL.
 *  Minor 8. ARKAIK_URL is honored (env beats the persisted link file's
 *    remote; --api still wins over both).
 *  Minor 11. The backups[0] read is guarded so a missing backup (e.g. from
 *    a mutation that drops the write) reports a clean FAIL instead of
 *    crashing the whole suite with a raw TypeError.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const RESTORE_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "restore.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-restore");
const RESTORE_BUNDLE = path.join(TEST_BUILD_DIR, "restore.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
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

/** Run `fn`, capturing every console.log call as a string instead of printing it. Restores console.log even if `fn` throws. */
function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLocalBundle(extra = {}) {
  return {
    schema_version: 3,
    project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [
      { id: "V-old", project_id: "demo", species: "view", title: "Old", status: "live", platforms: ["web"] },
      { id: "V-new", project_id: "demo", species: "view", title: "New", status: "live", platforms: ["web"] },
    ],
    edges: [],
    ...extra,
  };
}

const SIDECAR_EVENT = {
  id: "01J9ZK4E4N0000000000000001",
  ts: "2026-01-01T00:00:00.000Z",
  actor: "claude-code",
  type: "node.created",
  node_id: "V-new",
  species: "view",
  title: "New",
};

const SIDECAR_EVENT_2 = {
  id: "01J9ZK4E4N0000000000000002",
  ts: "2026-01-01T00:00:01.000Z",
  actor: "claude-code",
  type: "node.created",
  node_id: "V-old",
  species: "view",
  title: "Old",
};

const HOSTED_EXPORT = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-old", project_id: "demo", species: "view", title: "Old", status: "live", platforms: ["web"] }],
  edges: [],
  journal: [{ id: "01J9ZK4E4N0000000000000000", ts: "2025-12-01T00:00:00.000Z", actor: "human", type: "node.created", node_id: "V-old", species: "view", title: "Old" }],
};

/**
 * `docs/quality/` sidecars for a fixture repo: two audits that merge to five
 * cells and two findings, the same shape tests/cli/quality-section-fold.js
 * builds. 2026-09 re-scores one of 2026-08's cells, so a fold that
 * concatenated or took only the newest would land a different number here.
 *
 * Findings are stored WITH severity/priority, as the real sidecars are, so
 * the outbound body can be asserted to have dropped them.
 */
function writeQualitySidecars(dir, { profile = true, audits = true, tag = "" } = {}) {
  const write = (relative, value) => {
    const file = path.join(dir, "docs", "quality", ...relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  };
  const cell = (criterionId, surface, level, auditId) => ({
    criterion_id: criterionId,
    surface,
    level,
    evidence: `app/${criterionId.toLowerCase()}.ts:1`,
    audit_id: auditId,
  });
  if (profile) write(["profile.json"], {
    surfaces: [{ id: "web", title: "Web app", platform: "web" }, { id: "admin", title: "Admin console" }],
    domain_weights: { SEC: 2, TST: 1 },
  });
  if (!audits) return;
  write(["library.json"], {
    name: "test-pack",
    version: "9.9.9",
    domains: [{ code: "SEC", name: "Security" }, { code: "TST", name: "Testing" }],
    criteria: [
      { id: "SEC-01", domain: "SEC", name: "Secrets", weight: 3 },
      { id: "SEC-02", domain: "SEC", name: "Authorization", weight: 1 },
      { id: "TST-01", domain: "TST", name: "Unit tests", weight: 2 },
    ],
    scales: { grades: { A: 97, B: 88, C: 71, D: 52, E: 0 } },
  });
  write(["audits", "2026-08", "scores.json"], {
    audit_id: "2026-08",
    framework_version: "9.9.8",
    assessments: [
      cell("SEC-01", "web", 2, "2026-08"),
      cell("SEC-02", "web", 4, "2026-08"),
      cell("TST-01", "web", 1, "2026-08"),
      cell("SEC-01", "admin", 3, "2026-08"),
    ],
  });
  write(["audits", "2026-08", "findings.json"], {
    audit_id: "2026-08",
    framework_version: "9.9.8",
    findings: [
      {
        id: `F-2026-08-SEC-web-01${tag}`,
        criterion_id: "SEC-01",
        surface: "web",
        title: "Token in the repo",
        detail: "A live token is committed.",
        evidence: "app/a.ts:1",
        impact: 5,
        likelihood: 4,
        cost: "M",
        status: "open",
        severity: "critical",
        priority: "P0",
      },
    ],
  });
  write(["audits", "2026-09", "scores.json"], {
    audit_id: "2026-09",
    framework_version: "9.9.9",
    // Re-scores 2026-08's SEC-01/web (2 -> 4) and adds a cell it never had.
    assessments: [cell("SEC-01", "web", 4, "2026-09"), cell("TST-01", "admin", 2, "2026-09")],
  });
  write(["audits", "2026-09", "findings.json"], {
    audit_id: "2026-09",
    framework_version: "9.9.9",
    findings: [
      {
        id: `F-2026-09-TST-admin-01${tag}`,
        criterion_id: "TST-01",
        surface: "admin",
        title: "No tests on the admin console",
        detail: "Nothing covers it.",
        evidence: "app/e.ts:1",
        impact: 2,
        likelihood: 2,
        cost: "S",
        status: "open",
        severity: "low",
        priority: "P3",
      },
    ],
  });
}

/** The hosted export, but with a quality section — what the loss guard sees. */
const HOSTED_EXPORT_WITH_QUALITY = {
  ...HOSTED_EXPORT,
  quality: {
    framework_version: "9.9.9",
    profile: { surfaces: [{ id: "web", title: "Web app" }] },
    assessments: [],
    findings: [
      { id: "F-hosted-01", criterion_id: "SEC-01", surface: "web", title: "Hosted finding one", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "open" },
      { id: "F-hosted-02", criterion_id: "SEC-02", surface: "web", title: "Hosted finding two", detail: "d", evidence: "e", impact: 3, likelihood: 3, cost: "S", status: "open" },
      { id: "F-hosted-03", criterion_id: "TST-01", surface: "web", title: "Hosted finding three", detail: "d", evidence: "e", impact: 2, likelihood: 2, cost: "S", status: "open" },
    ],
  },
};

const createdDirs = [];

/**
 * Fresh temp repo dir with docs/arkaik/{arkaik.json, bundle.json[, journal.jsonl]}.
 * `sidecarEvents`: events written to journal.jsonl (default: one). Pass `[]`
 * to omit the sidecar entirely (the empty-journal trigger for the
 * history-shrink guard). Ignored when `withEmbeddedJournal` is set.
 */
function fixture({ withEmbeddedJournal = false, apiBase = "http://example.invalid", sidecarEvents = [SIDECAR_EVENT] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-"));
  createdDirs.push(dir);
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo", remote: apiBase }));
  const bundle = withEmbeddedJournal ? makeLocalBundle({ journal: [{ ...SIDECAR_EVENT, id: "EMBEDDED-EVENT" }] }) : makeLocalBundle();
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle));
  if (!withEmbeddedJournal && sidecarEvents.length > 0) {
    writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), sidecarEvents.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return { dir, bundlePath: path.join(dir, "docs", "arkaik", "bundle.json") };
}

function jsonResponse(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
  };
}

/** Mock httpClient: routes by a caller-supplied responder, records every call it saw. */
function makeMockHttpClient(responder) {
  const calls = [];
  const client = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  client.calls = calls;
  return client;
}

function backupsIn(dir) {
  const backupDir = path.join(dir, "docs", "arkaik", ".backups");
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir);
}

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  // @arkaik/schema ships raw TS (no compiled dist) — esbuild resolves and
  // bundles it straight from source as part of this same pass, exactly as
  // build.js does for the real CLI (restore.ts pulls it in transitively via
  // journal-io.ts's parseJournalLines).
  await build({
    entryPoints: [RESTORE_ENTRY],
    outfile: RESTORE_BUNDLE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    legalComments: "none",
  });
  const { runRestore, reportRestore, DEFAULT_API_BASE } = await import(pathToFileURL(RESTORE_BUNDLE).href);

  check("DEFAULT_API_BASE is https://arkaik.app", DEFAULT_API_BASE === "https://arkaik.app", DEFAULT_API_BASE);

  // -------------------------------------------------------------------------
  // Happy path: real restore backs up first, reads version, sends If-Match,
  // assembles bundle.json + journal.jsonl sidecar correctly.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) {
        return jsonResponse(200, { bundle: { project: HOSTED_EXPORT.project }, version: "7" }, { ETag: '"7"' });
      }
      if (url.endsWith("/api/graph/projects/prj_demo/export")) {
        return jsonResponse(200, { bundle: HOSTED_EXPORT });
      }
      if (url.endsWith("/api/graph/projects/prj_demo/bundle")) {
        check("PUT carries If-Match with the read version", init.headers["If-Match"] === '"7"', JSON.stringify(init.headers));
        const body = JSON.parse(init.body);
        check("PUT body carries both local nodes", body.bundle.nodes.length === 2, JSON.stringify(body.bundle.nodes));
        check(
          "PUT body's journal is the sidecar event, not empty",
          Array.isArray(body.bundle.journal) && body.bundle.journal.length === 1 && body.bundle.journal[0].id === SIDECAR_EVENT.id,
          JSON.stringify(body.bundle.journal),
        );
        return jsonResponse(
          200,
          {
            version: "8",
            delta: {
              nodesBefore: 1, nodesAfter: 2, nodesAdded: 1, nodesRemoved: 0, nodesChanged: 0, nodesMalformed: 0,
              edgesBefore: 0, edgesAfter: 0, edgesAdded: 0, edgesRemoved: 0, edgesChanged: 0, edgesMalformed: 0,
              eventsBefore: 1, eventsAfter: 1, eventsAdded: 1, eventsDropped: 1, eventsChanged: 0, eventsMalformed: 0,
            },
            dryRun: false,
          },
          { ETag: '"8"' },
        );
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });

    check("restore result ok", result.ok === true, JSON.stringify(result));
    check("restore request was sent", result.requestSent === true);
    check("restore status 200", result.status === 200, result.status);
    check("restore reports new version", result.version === "8", result.version);
    check("restore reports a delta", result.delta && result.delta.nodesAdded === 1, JSON.stringify(result.delta));
    check("exactly 3 HTTP calls (GET project, GET export, PUT)", httpClient.calls.length === 3, httpClient.calls.length);

    const backups = backupsIn(dir);
    check("exactly one backup file written", backups.length === 1, JSON.stringify(backups));
    check("result reports the backup path", typeof result.backupPath === "string" && result.backupPath.includes(".backups"), result.backupPath);

    // Probe 2: the backup holds the PRE-restore HOSTED state (export
    // response), including its journal — not the local bundle being sent.
    // Minor 11: guarded — a mutation that drops the backup write must report
    // a clean FAIL here, not crash the whole suite on `backups[0]` being
    // undefined.
    if (backups.length > 0) {
      const backup = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", ".backups", backups[0]), "utf8"));
      check("backup holds the hosted (pre-restore) node count", backup.nodes.length === 1, JSON.stringify(backup.nodes));
      check(
        "backup holds the hosted journal, not the outgoing one",
        Array.isArray(backup.journal) && backup.journal.length === 1 && backup.journal[0].id !== SIDECAR_EVENT.id,
        JSON.stringify(backup.journal),
      );
    } else {
      check("backup holds the hosted (pre-restore) node count", false, "no backup file was written to read");
      check("backup holds the hosted journal, not the outgoing one", false, "no backup file was written to read");
    }

    // Important 3: the undo command is printed on the SUCCESS path.
    // reportRestore's success branch sets process.exitCode rather than
    // calling process.exit(), so it's safe to call directly in-process here.
    const lines = captureConsoleLog(() => reportRestore(result));
    check("success output reports the new version", lines.some((l) => l.includes("Restored. New version 8.")), JSON.stringify(lines));
    check(
      "success output prints the undo command with the backup path",
      lines.some((l) => l.includes("Undo this restore with: arkaik restore") && l.includes(result.backupPath)),
      JSON.stringify(lines),
    );
  }

  // -------------------------------------------------------------------------
  // Probe 5b: a bundle.json that embeds its own journal wins over the
  // sidecar (loadJournalEvents precedence) — restore must not silently
  // prefer the sidecar and drop embedded history. This precedence is also
  // what makes `arkaik restore <backup-path>` round-trip correctly on undo:
  // a backup always carries its journal embedded.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture({ withEmbeddedJournal: true });
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) {
        const body = JSON.parse(init.body);
        check(
          "embedded journal in bundle.json wins over any sidecar",
          body.bundle.journal.length === 1 && body.bundle.journal[0].id === "EMBEDDED-EVENT",
          JSON.stringify(body.bundle.journal),
        );
        return jsonResponse(200, { version: "2", delta: {}, dryRun: false });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("embedded-journal restore ok", result.ok === true, JSON.stringify(result));
  }

  // -------------------------------------------------------------------------
  // Probe 4: --dry-run takes NO backup, sends ?dryRun=1, still reads a
  // version for its own If-Match, reports the server's delta, sends nothing
  // destructive.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "7" });
      if (url.includes("/export")) throw new Error("dry-run must not call export");
      if (url.endsWith("/bundle?dryRun=1")) {
        check("dry-run PUT still carries If-Match", init.headers["If-Match"] === '"7"', JSON.stringify(init.headers));
        return jsonResponse(200, { version: "7", delta: { nodesBefore: 1, nodesAfter: 2, nodesAdded: 1, nodesRemoved: 0, nodesChanged: 0, nodesMalformed: 0, edgesBefore: 0, edgesAfter: 0, edgesAdded: 0, edgesRemoved: 0, edgesChanged: 0, edgesMalformed: 0, eventsBefore: 1, eventsAfter: 1, eventsAdded: 1, eventsDropped: 0, eventsChanged: 0, eventsMalformed: 0 }, dryRun: true });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const result = await runRestore({ path: bundlePath, dryRun: true, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });

    check("dry-run result ok", result.ok === true, JSON.stringify(result));
    check("dry-run sent exactly 2 calls (GET project, PUT ?dryRun=1) — no export", httpClient.calls.length === 2, httpClient.calls.length);
    check("dry-run reports a delta", result.delta && result.delta.nodesAdded === 1, JSON.stringify(result.delta));
    check("dry-run took no backup", !existsSync(path.join(dir, "docs", "arkaik", ".backups")), backupsIn(dir));
    check("dry-run result has no backupPath", result.backupPath === undefined, result.backupPath);

    // Dry-run wording: reminds the caller the REAL run takes the backup.
    const lines = captureConsoleLog(() => reportRestore(result));
    check(
      "dry-run output tells the caller the real run takes the backup",
      lines.some((l) => l.includes("Re-run without --dry-run to apply — that run takes the backup")),
      JSON.stringify(lines),
    );
    // S9: the same line must not promise a preview it does not give. All three
    // guards read the export, which a dry run never fetches.
    check(
      "and that the guards only run on the real thing",
      lines.some((l) => /quality-loss guards/.test(l) && /never fetches/.test(l)),
      JSON.stringify(lines),
    );
  }

  // -------------------------------------------------------------------------
  // Critical (coordinator round 2): an outbound journal shorter than the
  // hosted one must refuse — zero PUTs — unless --allow-history-loss.
  // Equal or more proceeds normally.
  // -------------------------------------------------------------------------
  {
    // (a) The exact empty-journal trigger: no sidecar, no embedded journal.
    const { dir, bundlePath } = fixture({ sidecarEvents: [] });
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT }); // 1 hosted event
      if (url.endsWith("/bundle")) throw new Error("must not PUT: outbound journal (0) is shorter than hosted (1)");
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("empty outbound journal vs 1 hosted event: refuses (ok:false)", result.ok === false, JSON.stringify(result));
    check("empty outbound journal: zero PUT calls", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0, JSON.stringify(httpClient.calls));
    check("empty outbound journal: no backup written either (aborts before the write)", backupsIn(dir).length === 0, backupsIn(dir));
    check(
      "empty outbound journal: message names --allow-history-loss and the counts",
      typeof result.fatal === "string" && result.fatal.includes("--allow-history-loss") && result.fatal.includes("1") && result.fatal.includes("0"),
      result.fatal,
    );
  }
  {
    // (b) Same scenario, with --allow-history-loss: proceeds normally.
    const { dir, bundlePath } = fixture({ sidecarEvents: [] });
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) {
        const body = JSON.parse(init.body);
        check("--allow-history-loss: the empty journal is actually sent", Array.isArray(body.bundle.journal) && body.bundle.journal.length === 0, JSON.stringify(body.bundle.journal));
        return jsonResponse(200, { version: "2", delta: {} });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, allowHistoryLoss: true, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("--allow-history-loss: restore proceeds (ok:true, sent)", result.ok === true && result.requestSent === true, JSON.stringify(result));
    check("--allow-history-loss: status 200", result.status === 200, result.status);
    check("--allow-history-loss: a backup was still taken", backupsIn(dir).length === 1, backupsIn(dir));
  }
  {
    // (c) Fewer-but-nonzero: 1 outbound vs a hosted export with 2 events —
    // same refusal, not a special case only reachable at zero.
    const { dir, bundlePath } = fixture({ sidecarEvents: [SIDECAR_EVENT] });
    const hostedWithTwoEvents = { ...HOSTED_EXPORT, journal: [...HOSTED_EXPORT.journal, { ...HOSTED_EXPORT.journal[0], id: "second-hosted-event" }] };
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: hostedWithTwoEvents });
      if (url.endsWith("/bundle")) throw new Error("must not PUT: 1 outbound event is fewer than 2 hosted");
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("1 outbound vs 2 hosted events: refuses", result.ok === false, JSON.stringify(result));
  }
  {
    // (d) Equal counts: proceeds without the flag (already exercised by
    // every other passing test using the default 1-event fixture against
    // HOSTED_EXPORT's 1 event, but asserted explicitly here too).
    const { dir, bundlePath } = fixture({ sidecarEvents: [SIDECAR_EVENT] });
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT }); // 1 event
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("equal event counts (1 vs 1): proceeds without the flag", result.ok === true && result.requestSent === true, JSON.stringify(result));
  }
  {
    // (e) More outbound than hosted: proceeds without the flag.
    const { dir, bundlePath } = fixture({ sidecarEvents: [SIDECAR_EVENT, SIDECAR_EVENT_2] });
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT }); // 1 event
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("more outbound events (2) than hosted (1): proceeds without the flag", result.ok === true && result.requestSent === true, JSON.stringify(result));
  }

  // -------------------------------------------------------------------------
  // Critical: a restore that DROPS hosted nodes or edges must refuse — zero
  // PUTs — unless --allow-deletions. This is the class the count-based history
  // guard structurally cannot see, and the closest a real bootstrap run came
  // to destroying data: the hosted project had drifted ahead of the committed
  // cache (a node deleted in the app, a replacement created, edges rewired),
  // so the delta was `+276 -1` with a GROWING journal — every count rose while
  // a real deletion sat inside it.
  // -------------------------------------------------------------------------

  // Hosted state that has moved ahead of the local bundle: it carries a node
  // (and an edge onto it) that the local bundle knows nothing about.
  const HOSTED_AHEAD = {
    ...HOSTED_EXPORT,
    nodes: [
      ...HOSTED_EXPORT.nodes,
      { id: "DM-bounces", project_id: "demo", species: "data-model", title: "Bounces", status: "live", platforms: ["web"] },
    ],
    edges: [{ id: "e-V-old-DM-bounces", project_id: "demo", source_id: "V-old", target_id: "DM-bounces", edge_type: "displays" }],
  };

  {
    // (a) The exact shape of the real run: the outbound journal GREW (2 vs 1,
    // so the history guard is satisfied and waves it through) while a hosted
    // node and edge are dropped. Proves the two guards catch different things.
    const { dir, bundlePath } = fixture({ sidecarEvents: [SIDECAR_EVENT, SIDECAR_EVENT_2] });
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_AHEAD });
      if (url.endsWith("/bundle")) throw new Error("must not PUT: the local bundle drops DM-bounces and its edge");
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("growing journal + dropped node: refuses (ok:false)", result.ok === false, JSON.stringify(result));
    check("dropped node: zero PUT calls", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0, JSON.stringify(httpClient.calls));
    check("dropped node: no backup written either (aborts before the write)", backupsIn(dir).length === 0, backupsIn(dir));
    check(
      "dropped node: message names the node id, not just a count",
      typeof result.fatal === "string" && result.fatal.includes("DM-bounces"),
      result.fatal,
    );
    check(
      "dropped node: message names the edge id too",
      typeof result.fatal === "string" && result.fatal.includes("e-V-old-DM-bounces"),
      result.fatal,
    );
    check(
      "dropped node: message names the --allow-deletions escape hatch",
      typeof result.fatal === "string" && result.fatal.includes("--allow-deletions"),
      result.fatal,
    );
  }
  {
    // (b) Same scenario with --allow-deletions: proceeds, and still backs up.
    const { dir, bundlePath } = fixture({ sidecarEvents: [SIDECAR_EVENT, SIDECAR_EVENT_2] });
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_AHEAD });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, allowDeletions: true, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("--allow-deletions: restore proceeds (ok:true, sent)", result.ok === true && result.requestSent === true, JSON.stringify(result));
    check("--allow-deletions: a backup was still taken", backupsIn(dir).length === 1, backupsIn(dir));
  }
  {
    // (c) Edge-only deletion refuses too — the real run's `-7 edges` arrived
    // without any node id changing, so a node-only guard would have missed it.
    const { dir, bundlePath } = fixture();
    const hostedEdgeOnly = { ...HOSTED_EXPORT, edges: [{ id: "e-V-old-V-old", project_id: "demo", source_id: "V-old", target_id: "V-old", edge_type: "composes" }] };
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: hostedEdgeOnly });
      if (url.endsWith("/bundle")) throw new Error("must not PUT: the local bundle drops a hosted edge");
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("edge-only deletion: refuses", result.ok === false, JSON.stringify(result));
    check("edge-only deletion: names the edge id", typeof result.fatal === "string" && result.fatal.includes("e-V-old-V-old"), result.fatal);
  }
  {
    // (d) The ordinary additive bootstrap landing — the local bundle is a
    // superset of the hosted one — must NOT need the flag. This is the case
    // every real run is supposed to be, so a guard that blocked it would be
    // worse than no guard.
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("additive-only restore: proceeds without --allow-deletions", result.ok === true && result.requestSent === true, JSON.stringify(result));
  }
  {
    // (e) A dry run never fetches the export, so it has no ids to diff — the
    // server's counts are all it has. Those counts must still be called out in
    // words, because `-1` in a row of large rising numbers is exactly what got
    // missed.
    const result = {
      ok: true,
      dryRun: true,
      requestSent: true,
      status: 200,
      version: "7",
      delta: { nodesBefore: 173, nodesAfter: 448, nodesAdded: 276, nodesRemoved: 1, nodesChanged: 172, edgesRemoved: 7 },
    };
    const lines = captureConsoleLog(() => reportRestore(result));
    check(
      "dry-run delta calls out deletions in words",
      lines.some((l) => l.includes("WARNING") && l.includes("DELETES") && l.includes("1 node") && l.includes("7 edges")),
      JSON.stringify(lines),
    );
  }
  {
    // (f) ...and says nothing when there is nothing to warn about.
    const result = { ok: true, dryRun: true, requestSent: true, status: 200, version: "7", delta: { nodesAdded: 5, nodesRemoved: 0, edgesRemoved: 0 } };
    const lines = captureConsoleLog(() => reportRestore(result));
    check("additive delta prints no deletion warning", !lines.some((l) => l.includes("WARNING")), JSON.stringify(lines));
  }

  // -------------------------------------------------------------------------
  // Important 2 (coordinator round 2): the backup lands at
  // cwd/docs/arkaik/.backups — anchored to the LINK FILE's directory — even
  // when --path points at a bundle entirely outside docs/arkaik/.
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-extbundle-"));
    createdDirs.push(dir);
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo", remote: "http://example.invalid" }));
    mkdirSync(path.join(dir, "elsewhere"), { recursive: true });
    const externalBundlePath = path.join(dir, "elsewhere", "bundle.json");
    writeFileSync(externalBundlePath, JSON.stringify(makeLocalBundle()));
    writeFileSync(path.join(dir, "elsewhere", "journal.jsonl"), JSON.stringify(SIDECAR_EVENT) + "\n");

    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });

    const result = await runRestore({ path: externalBundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("external bundle path: restore ok", result.ok === true, JSON.stringify(result));
    check(
      "backup lands next to the LINK FILE (docs/arkaik/.backups), not the bundle's own directory",
      typeof result.backupPath === "string" && result.backupPath.startsWith(path.join(dir, "docs", "arkaik", ".backups") + path.sep),
      result.backupPath,
    );
    check("no stray .backups dir next to the external bundle", !existsSync(path.join(dir, "elsewhere", ".backups")), "");
  }

  // -------------------------------------------------------------------------
  // Important 4 (coordinator round 2): a colliding backup timestamp must
  // never silently replace an earlier backup. The clock is frozen so two
  // restores compute the IDENTICAL stamp deterministically, rather than
  // relying on a sub-millisecond race.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    const FIXED_TIME = new Date("2026-01-01T00:00:00.000Z").getTime();
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(FIXED_TIME);
          return;
        }
        super(...args);
      }
      static now() {
        return FIXED_TIME;
      }
    }
    // eslint-disable-next-line no-global-assign
    global.Date = FrozenDate;

    let exportCallCount = 0;
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "1" });
      if (url.endsWith("/export")) {
        exportCallCount += 1;
        const bundle = { ...HOSTED_EXPORT, project: { ...HOSTED_EXPORT.project, title: `Export #${exportCallCount}` } };
        return jsonResponse(200, { bundle });
      }
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      throw new Error(`unexpected URL ${url}`);
    });

    let first;
    let second;
    try {
      first = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
      second = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    } finally {
      // eslint-disable-next-line no-global-assign
      global.Date = RealDate;
    }

    check("colliding stamp: first restore succeeds", first.ok === true, JSON.stringify(first));
    check("colliding stamp: second restore refuses rather than silently overwriting", second.ok === false, JSON.stringify(second));

    if (typeof first.backupPath === "string" && existsSync(first.backupPath)) {
      const preserved = JSON.parse(readFileSync(first.backupPath, "utf8"));
      check("colliding stamp: the FIRST backup's content survives untouched", preserved.project.title === "Export #1", JSON.stringify(preserved.project));
      check(
        "colliding stamp: second restore's fatal message names the colliding path",
        typeof second.fatal === "string" && second.fatal.includes(first.backupPath),
        second.fatal,
      );
    } else {
      check("colliding stamp: the FIRST backup's content survives untouched", false, "first.backupPath missing or file absent");
      check("colliding stamp: second restore's fatal message names the colliding path", false, "first.backupPath missing or file absent");
    }
  }

  // -------------------------------------------------------------------------
  // Probe 1: the export GET failing in every way must abort BEFORE any PUT,
  // and before any backup file is written.
  // -------------------------------------------------------------------------
  const exportFailureCases = [
    {
      name: "export GET throws (network error)",
      respond: (url) => {
        if (url.endsWith("/export")) throw new Error("ECONNRESET");
        return jsonResponse(200, { version: "1" });
      },
    },
    {
      name: "export GET returns non-200",
      respond: (url) => {
        if (url.endsWith("/export")) return jsonResponse(500, { error: "internal_error" });
        return jsonResponse(200, { version: "1" });
      },
    },
    {
      name: "export GET returns something that isn't a bundle",
      respond: (url) => {
        if (url.endsWith("/export")) return jsonResponse(200, { bundle: "not-an-object" });
        return jsonResponse(200, { version: "1" });
      },
    },
    {
      name: "export bundle is missing a journal array",
      respond: (url) => {
        if (url.endsWith("/export")) {
          const { journal, ...noJournal } = HOSTED_EXPORT;
          return jsonResponse(200, { bundle: noJournal });
        }
        return jsonResponse(200, { version: "1" });
      },
    },
  ];

  for (const { name, respond } of exportFailureCases) {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/bundle")) throw new Error("must not PUT when the backup could not be taken");
      return respond(url, init);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check(`${name}: refuses (ok:false)`, result.ok === false, JSON.stringify(result));
    check(`${name}: no backup file exists`, backupsIn(dir).length === 0, backupsIn(dir));
    check(`${name}: fatal message present`, typeof result.fatal === "string" && result.fatal.length > 0, result.fatal);
  }

  // -------------------------------------------------------------------------
  // Probe 1: an unwritable backup directory refuses, and nothing was sent.
  // Also part of Important 4's coverage: this is a second, independent way
  // the write+verify region can fail, and it must abort the same way.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    mkdirSync(path.join(dir, "docs", "arkaik", ".backups"));
    chmodSync(path.join(dir, "docs", "arkaik", ".backups"), 0o500);
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/bundle")) throw new Error("must not PUT when the backup directory is unwritable");
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      return jsonResponse(200, { version: "1" });
    });
    try {
      const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
      check("unwritable backup dir: refuses (ok:false)", result.ok === false, JSON.stringify(result));
      check("unwritable backup dir: fatal names the path", typeof result.fatal === "string" && result.fatal.includes(".backups"), result.fatal);
    } finally {
      chmodSync(path.join(dir, "docs", "arkaik", ".backups"), 0o700);
    }
  }

  // -------------------------------------------------------------------------
  // Probe 3 / 6 / Important 5: every real-restore PUT failure status gets a
  // distinct, actionable message and names the backup path + undo command.
  // 412 must not suggest a blind retry. 404 must say "written", not "sent".
  // Minor 6: mustInclude / mustNotInclude are wired into real assertions.
  // -------------------------------------------------------------------------
  const putFailureCases = [
    { status: 404, body: { error: "not_found" }, mustInclude: ["Nothing was written"], mustNotInclude: ["Nothing was sent", "retry"] },
    // "not a version conflict" is the correct, precise phrasing here (it
    // disambiguates 428 from the genuine 412 conflict) — mustNotInclude
    // checks for an UNQUALIFIED claim of conflict, not the substring alone.
    { status: 428, body: { error: "if_match_required" }, mustInclude: ["bug", "not a version conflict"], mustNotInclude: ["Nothing was sent"] },
    { status: 400, body: { error: "if_match_unsupported" }, mustInclude: ["malformed"], mustNotInclude: ["dry-run"] },
    { status: 400, body: { error: "invalid_dry_run" }, mustInclude: ["dry-run indicator"], mustNotInclude: ["malformed"] },
    {
      status: 412,
      body: { error: "conflict", current: "9" },
      // "Do not retry with the same version" is the correct, precise
      // phrasing (see the dedicated 412 checks below the loop for the
      // negation-aware version of this assertion) — not tested here via
      // mustNotInclude to avoid duplicating/contradicting those.
      mustInclude: ["9", "backup", "Undo this restore with", "Do not retry"],
      mustNotInclude: [],
    },
    { status: 403, body: { error: "limit_exceeded", limit: 500, actual: 600, tier: "starter" }, mustInclude: ["500", "600", "starter"], mustNotInclude: [] },
    { status: 403, body: { error: "limit_exceeded", limit: null, actual: 600, tier: "klub" }, mustInclude: ["uncapped", "klub"], mustNotInclude: ["null"] },
    { status: 413, body: { error: "payload_too_large", limit: 5242880 }, mustInclude: ["5242880"], mustNotInclude: [] },
    {
      status: 422,
      body: { error: "invalid_bundle", errors: [{ path: "nodes[0].title", rule: "required", message: "Title is required.", severity: "error" }] },
      mustInclude: ["validator"],
      mustNotInclude: [],
    },
  ];

  const seenMessages = new Set();
  for (const { status, body, mustInclude, mustNotInclude } of putFailureCases) {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(status, body);
      return jsonResponse(200, { version: "7" });
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });

    const label = `${status} ${body.error}`;
    check(`${label}: request marked sent`, result.requestSent === true, JSON.stringify(result));
    check(`${label}: status surfaced`, result.status === status, result.status);
    check(`${label}: a backup was still taken before the PUT`, backupsIn(dir).length === 1, backupsIn(dir));
    check(`${label}: errorMessage present`, typeof result.errorMessage === "string" && result.errorMessage.length > 0, JSON.stringify(result));
    check(`${label}: errorMessage names the backup path`, result.errorMessage.includes(".backups"), result.errorMessage);
    check(`${label}: errorMessage names the undo command`, result.errorMessage.includes("Undo this restore with: arkaik restore"), result.errorMessage);

    for (const fragment of mustInclude) {
      check(`${label}: message includes "${fragment}"`, result.errorMessage.includes(fragment), result.errorMessage);
    }
    for (const fragment of mustNotInclude) {
      check(`${label}: message does NOT include "${fragment}"`, !result.errorMessage.includes(fragment), result.errorMessage);
    }

    check(`${label}: message text is distinct from every other case seen so far`, !seenMessages.has(result.errorMessage), result.errorMessage);
    seenMessages.add(result.errorMessage);

    if (status === 412) {
      check("412: names the version read AND the server's current version", result.errorMessage.includes("7") && result.errorMessage.includes("9"), result.errorMessage);
      check(
        "412: explicitly tells the user NOT to blindly retry (negated, not just absent)",
        /do not retry|don't retry|never retry/i.test(result.errorMessage),
        result.errorMessage,
      );
      check(
        "412: never encourages retrying unqualified (\"try again\"/\"just retry\")",
        !/\btry again\b|\bjust retry\b/i.test(result.errorMessage),
        result.errorMessage,
      );
      check("412: conflictCurrent surfaced", result.conflictCurrent === "9", result.conflictCurrent);
    }
    if (status === 422) {
      check("422: server findings surfaced", Array.isArray(result.serverFindings) && result.serverFindings.length === 1, JSON.stringify(result.serverFindings));
    }
  }

  // A 428 and the two distinct 400s must not read identically, even though
  // they share a status code.
  {
    const messages = [];
    for (const errCode of ["if_match_required", "if_match_unsupported", "invalid_dry_run"]) {
      const { dir, bundlePath } = fixture();
      const status = errCode === "if_match_required" ? 428 : 400;
      const httpClient = makeMockHttpClient((url) => {
        if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
        if (url.endsWith("/bundle")) return jsonResponse(status, { error: errCode });
        return jsonResponse(200, { version: "7" });
      });
      const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
      messages.push(result.errorMessage);
    }
    check("428 message differs from the two 400 messages", messages[0] !== messages[1] && messages[0] !== messages[2], JSON.stringify(messages));
    check("the two 400 sub-cases (if_match_unsupported vs invalid_dry_run) read differently", messages[1] !== messages[2], JSON.stringify(messages));
  }

  // -------------------------------------------------------------------------
  // GET project (version read) failing aborts before export/backup/PUT.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/prj_demo")) return jsonResponse(404, { error: "not_found" });
      throw new Error(`must not call ${url} when the version read 404s`);
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("version-read 404 refuses (ok:false)", result.ok === false, JSON.stringify(result));
    check("version-read 404: no backup written", backupsIn(dir).length === 0, backupsIn(dir));
  }

  // -------------------------------------------------------------------------
  // Preflight failures: no link file, no project_id, no token, no bundle.
  // None of these ever reach the network.
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-nolink-"));
    createdDirs.push(dir);
    const httpClient = makeMockHttpClient(() => {
      throw new Error("must not be called");
    });
    const result = await runRestore({ apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("no link file: fatal, no network", result.ok === false && httpClient.calls.length === 0, JSON.stringify(result));
  }
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient(() => {
      throw new Error("must not be called");
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: {}, cwd: dir, httpClient });
    check("no ARKAIK_TOKEN: fatal, no network", result.ok === false && httpClient.calls.length === 0, JSON.stringify(result));
  }
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-nobundle-"));
    createdDirs.push(dir);
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo" }));
    const httpClient = makeMockHttpClient(() => {
      throw new Error("must not be called");
    });
    const result = await runRestore({ apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("no local bundle: fatal, no network", result.ok === false && httpClient.calls.length === 0, JSON.stringify(result));
  }

  // -------------------------------------------------------------------------
  // Network error on the real PUT itself (after the backup was taken): must
  // not crash, must report the backup path + undo command so recovery is
  // still possible.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      if (url.endsWith("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) throw new Error("getaddrinfo ENOTFOUND example.invalid");
      return jsonResponse(200, { version: "7" });
    });
    const result = await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("PUT network error: ok (no crash)", result.ok === true, JSON.stringify(result));
    check("PUT network error: not marked as sent", result.requestSent === false);
    check("PUT network error: backup path still surfaced", typeof result.backupPath === "string", result.backupPath);
    check("PUT network error: message mentions the network failure", /Network error|ENOTFOUND/.test(result.errorMessage || ""), result.errorMessage);
    check("PUT network error: message says nothing was SENT (accurate — the PUT itself failed)", (result.errorMessage || "").includes("Nothing was sent"), result.errorMessage);
    check("PUT network error: message names the undo command", (result.errorMessage || "").includes("Undo this restore with"), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // Minor 7: projectId is percent-encoded into every URL, matching link.ts
  // (which WRITES the value).
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-encode-"));
    createdDirs.push(dir);
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    const weirdId = "prj demo/x";
    writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: weirdId, remote: "http://example.invalid" }));
    writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(makeLocalBundle()));
    writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), JSON.stringify(SIDECAR_EVENT) + "\n");

    let sawEncodedUrl = false;
    const httpClient = makeMockHttpClient((url) => {
      if (url.includes(encodeURIComponent(weirdId))) sawEncodedUrl = true;
      check("URL never carries the raw, unescaped projectId", !url.includes(weirdId), url);
      if (url.includes("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      return jsonResponse(200, { version: "1" });
    });
    const result = await runRestore({ apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
    check("encoded-projectId restore ok", result.ok === true, JSON.stringify(result));
    check("at least one call carried the percent-encoded projectId", sawEncodedUrl, "");
  }

  // -------------------------------------------------------------------------
  // Minor 8: ARKAIK_URL is honored — env beats the persisted link file's
  // remote (same precedence packages/mcp/src/config.ts uses); --api still
  // wins over both.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath } = fixture({ apiBase: "http://link-file-remote.invalid" });
    const httpClient = makeMockHttpClient((url) => {
      check("ARKAIK_URL wins over the link file's persisted remote", url.startsWith("http://env-url.invalid"), url);
      if (url.includes("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      return jsonResponse(200, { version: "1" });
    });
    const result = await runRestore({ path: bundlePath, env: { ARKAIK_TOKEN: "tok", ARKAIK_URL: "http://env-url.invalid" }, cwd: dir, httpClient });
    check("ARKAIK_URL-precedence restore ok", result.ok === true, JSON.stringify(result));
  }
  {
    const { dir, bundlePath } = fixture({ apiBase: "http://link-file-remote.invalid" });
    const httpClient = makeMockHttpClient((url) => {
      check("--api (apiBase option) wins over both ARKAIK_URL and the link file", url.startsWith("http://explicit-api.invalid"), url);
      if (url.includes("/export")) return jsonResponse(200, { bundle: HOSTED_EXPORT });
      if (url.endsWith("/bundle")) return jsonResponse(200, { version: "2", delta: {} });
      return jsonResponse(200, { version: "1" });
    });
    const result = await runRestore({
      path: bundlePath,
      apiBase: "http://explicit-api.invalid",
      env: { ARKAIK_TOKEN: "tok", ARKAIK_URL: "http://env-url.invalid" },
      cwd: dir,
      httpClient,
    });
    check("apiBase-wins-over-everything restore ok", result.ok === true, JSON.stringify(result));
  }

  // -------------------------------------------------------------------------
  // Quality (#389). `restore` assembles its own outbound bundle rather than
  // going through runPack, so it inherited none of the fold and none of the
  // strip — and it is the verb that actually lands a bundle on a hosted
  // project, which makes it the one the Quality page depends on.
  //
  // A shared responder: every case below differs only in what the export
  // returns and what the outbound body is expected to hold.
  // -------------------------------------------------------------------------
  const qualityResponder = (exportBundle, onPut) => (url, init) => {
    // Match on the PATH: a dry run appends ?dryRun=1 to the PUT.
    const route = url.split("?")[0];
    if (route.endsWith("/api/graph/projects/prj_demo")) return jsonResponse(200, { version: "7" }, { ETag: '"7"' });
    if (route.endsWith("/api/graph/projects/prj_demo/export")) return jsonResponse(200, { bundle: exportBundle });
    if (route.endsWith("/api/graph/projects/prj_demo/bundle")) {
      if (onPut) onPut(JSON.parse(init.body).bundle);
      return jsonResponse(200, { version: "8", delta: {}, dryRun: url.includes("dryRun") }, { ETag: '"8"' });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const runQualityRestore = (dir, bundlePath, httpClient, extra = {}) =>
    runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient, ...extra });

  // 1. Sidecars present -> the merged section rides along.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("restore with sidecars ok", result.ok === true, JSON.stringify(result));
    check("the PUT body carries a quality section", sent && sent.quality !== undefined, JSON.stringify(sent && Object.keys(sent)));
    check(
      "merged across both audits: 5 cells, not 6 (concatenated) or 2 (newest only)",
      sent && sent.quality && sent.quality.assessments.length === 5,
      JSON.stringify(sent && sent.quality && sent.quality.assessments.length),
    );
    check(
      "the newer audit wins the re-scored cell",
      sent && sent.quality && sent.quality.assessments.some((a) => a.criterion_id === "SEC-01" && a.surface === "web" && a.level === 4),
      JSON.stringify(sent && sent.quality && sent.quality.assessments),
    );
    check("findings pool across audits", sent && sent.quality && sent.quality.findings.length === 2, JSON.stringify(sent && sent.quality && sent.quality.findings.map((f) => f.id)));
    check(
      "derived severity/priority are stripped on the way out",
      sent && sent.quality && sent.quality.findings.every((f) => !("severity" in f) && !("priority" in f)),
      JSON.stringify(sent && sent.quality && sent.quality.findings.map((f) => Object.keys(f))),
    );
  }

  // 2. --no-quality DELETES, including a section the local bundle carried.
  //    A fixture with no section could not tell that apart from "did not add".
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    const local = JSON.parse(readFileSync(bundlePath, "utf8"));
    local.quality = { framework_version: "0.0.1", profile: { surfaces: [] }, assessments: [], findings: [{ id: "F-local-01", title: "LOCAL SECTION MARKER" }] };
    writeFileSync(bundlePath, JSON.stringify(local));

    let sent;
    let rawBody;
    const httpClient = makeMockHttpClient((url, init) => {
      if (url.endsWith("/bundle")) rawBody = init.body;
      return qualityResponder(HOSTED_EXPORT, (b) => { sent = b; })(url, init);
    });
    const result = await runQualityRestore(dir, bundlePath, httpClient, { noQuality: true });

    check("--no-quality restore ok", result.ok === true, JSON.stringify(result));
    check("--no-quality sends no quality section", sent && sent.quality === undefined, JSON.stringify(sent && Object.keys(sent)));
    check(
      "and the LOCAL bundle's own section goes with it",
      rawBody !== undefined && !rawBody.includes("LOCAL SECTION MARKER"),
      String(rawBody).slice(0, 300),
    );
  }

  // 3. Hosted has a section, outbound does not -> refused, nothing sent.
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("a would-be quality wipe is refused", result.ok === false, JSON.stringify(result));
    check("no PUT was sent", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0, JSON.stringify(httpClient.calls.map((c) => c.url)));
    check("the message names the hosted finding count", /3 open findings/.test(result.fatal || ""), result.fatal);
    check("the message names the escape hatch", /--allow-quality-loss/.test(result.fatal || ""), result.fatal);
    check("and points at --root, the likeliest innocent cause", /--root/.test(result.fatal || ""), result.fatal);

    // 7. Refused BEFORE the backup is written — the ordering the history
    //    guard documents and the one a future edit is most likely to break.
    check("the refusal leaves nothing behind in .backups/", backupsIn(dir).length === 0, JSON.stringify(backupsIn(dir)));
  }

  // 4. Same refusal, but caused by --no-quality: the advice must change.
  //    --no-quality says "do not send mine", never "destroy theirs".
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY));
    const result = await runQualityRestore(dir, bundlePath, httpClient, { noQuality: true });

    check("--no-quality does not imply --allow-quality-loss", result.ok === false, JSON.stringify(result));
    check("no PUT was sent", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0, JSON.stringify(httpClient.calls.map((c) => c.url)));
    check("the message blames --no-quality, not the root", /--no-quality/.test(result.fatal || "") && !/--root/.test(result.fatal || ""), result.fatal);
    check("and still names --allow-quality-loss", /--allow-quality-loss/.test(result.fatal || ""), result.fatal);
  }

  // 5. --allow-quality-loss proceeds.
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY));
    const result = await runQualityRestore(dir, bundlePath, httpClient, { allowQualityLoss: true });

    check("--allow-quality-loss proceeds", result.ok === true && result.status === 200, JSON.stringify(result));
    check("exactly one PUT", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 1, JSON.stringify(httpClient.calls.map((c) => c.url)));
  }

  // 6. Neither side has quality: the guard must not fire. Every existing user
  //    is in this state, and refusing them would be the worst regression here.
  {
    const { dir, bundlePath } = fixture();
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("an ordinary quality-free restore is untouched by the guard", result.ok === true && result.status === 200, JSON.stringify(result));
    check("exactly one PUT", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 1, JSON.stringify(httpClient.calls.map((c) => c.url)));
  }

  // 8. --audit pins one audit's snapshot in the outbound body.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, bundlePath, httpClient, { audit: "2026-08" });

    check("--audit restore ok", result.ok === true, JSON.stringify(result));
    check("--audit sends that audit's 4 cells, not the merge's 5", sent && sent.quality && sent.quality.assessments.length === 4, JSON.stringify(sent && sent.quality && sent.quality.assessments.length));
    const cell = sent && sent.quality && sent.quality.assessments.find((a) => a.criterion_id === "SEC-01" && a.surface === "web");
    check("--audit reports the pre-rescore level", cell && cell.level === 2, JSON.stringify(cell));
    check("--audit sends only that audit's finding", sent && sent.quality && sent.quality.findings.length === 1 && sent.quality.findings[0].id === "F-2026-08-SEC-web-01", JSON.stringify(sent && sent.quality && sent.quality.findings.map((f) => f.id)));

    // The fold runs before the FIRST request, not merely before the PUT, so
    // zero calls is the claim — and the stronger one.
    const ghostClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT));
    const ghost = await runQualityRestore(dir, bundlePath, ghostClient, { audit: "2099-01" });
    check("an audit id that is not on disk is refused", ghost.ok === false && /2099-01/.test(ghost.fatal || ""), ghost.fatal);
    check(
      "and refused before ANY request left the machine, not just before the PUT",
      ghostClient.calls.length === 0,
      JSON.stringify(ghostClient.calls.map((c) => c.url)),
    );
  }

  // 9. The refusal must state the cause it actually found (B1).
  //
  //    A populated docs/quality/ with no profile.json used to be told
  //    "no docs/quality/ under <dir>" — sending the user after a --root
  //    problem that did not exist, when the fix was `arkaik kritik profile`.
  //    The fold already knows why it produced nothing; the message quotes it.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir, { profile: false });
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("audits but no profile still refuses the wipe", result.ok === false, JSON.stringify(result));
    check("no request was sent", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0);
    check(
      "the message names the profile as the cause and the verb that fixes it",
      /profile\.json/.test(result.fatal || "") && /arkaik kritik profile/.test(result.fatal || ""),
      result.fatal,
    );
    // `|| ""` makes a pure negative pass when `fatal` is undefined, which is
    // exactly what happens if the guard is deleted — this survived that
    // mutation while its four siblings failed. Assert the message EXISTS and
    // is the right one first.
    check(
      "and does NOT blame --root, which is not the problem here",
      typeof result.fatal === "string" &&
        /ERASE the hosted project's quality section/.test(result.fatal) &&
        !/--root/.test(result.fatal),
      result.fatal,
    );
    check("it still names the escape hatch", /--allow-quality-loss/.test(result.fatal || ""), result.fatal);
  }

  // 10. The most reachable variant: `arkaik kritik profile` run, `score` not
  //     yet, restoring onto a project someone else already pushed quality to.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir, { audits: false });
    const result = await runQualityRestore(dir, bundlePath, makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY)));

    check("a profile with no audits yet refuses the wipe", result.ok === false, JSON.stringify(result));
    check(
      "and points at scoring, not at --root",
      /arkaik kritik score/.test(result.fatal || "") && !/--root/.test(result.fatal || ""),
      result.fatal,
    );
  }

  // 11. --root IS named when it genuinely is the likeliest cause: no
  //     docs/quality/ under the searched root at all.
  {
    const { dir, bundlePath } = fixture();
    const result = await runQualityRestore(dir, bundlePath, makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY)));

    check("a repo with no docs/quality/ at all is told about --root", /--root/.test(result.fatal || ""), result.fatal);
    check("and told the directory that was searched", result.fatal.includes(dir), result.fatal);
  }

  // 12. The root follows the BUNDLE, not the cwd (S6).
  //
  //     Every other case has both pointing at the same repo, so a regression
  //     to `qualityRoot = cwd`, or one dropping options.root, would pass them
  //     all. Here they differ: the link file (and therefore cwd) is one repo,
  //     the bundle another, and each has sidecars with distinguishable
  //     finding ids. "The wrong root sends one repo's findings to another
  //     repo's hosted project" is the failure this exists to catch.
  {
    const { dir } = fixture();
    writeQualitySidecars(dir, { tag: "-CWD" });

    const bundleRepo = mkdtempSync(path.join(tmpdir(), "arkaik-restore-bundlerepo-"));
    createdDirs.push(bundleRepo);
    mkdirSync(path.join(bundleRepo, "docs", "arkaik"), { recursive: true });
    const strayBundle = path.join(bundleRepo, "docs", "arkaik", "bundle.json");
    writeFileSync(strayBundle, JSON.stringify(makeLocalBundle()));
    writeFileSync(path.join(bundleRepo, "docs", "arkaik", "journal.jsonl"), JSON.stringify(SIDECAR_EVENT) + "\n");
    writeQualitySidecars(bundleRepo, { tag: "-BUNDLEREPO" });

    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, strayBundle, httpClient);

    check("a bundle from another repo restores", result.ok === true, JSON.stringify(result));
    const ids = (sent && sent.quality && sent.quality.findings.map((f) => f.id)) || [];
    check(
      "the sidecars folded are the BUNDLE's repo's, not the cwd's",
      ids.every((id) => id.endsWith("-BUNDLEREPO")) && ids.length === 2,
      JSON.stringify(ids),
    );

    // ...and --root overrides that derivation. A FRESH link-file repo, because
    // two real restores against the same one inside a millisecond collide on
    // the backup timestamp — which writeBackupFile refuses, loudly and
    // correctly.
    const { dir: rootTarget } = fixture();
    writeQualitySidecars(rootTarget, { tag: "-ROOTTARGET" });
    let overridden;
    const rootClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT, (b) => { overridden = b; }));
    const withRoot = await runQualityRestore(rootTarget, strayBundle, rootClient, { root: rootTarget });
    check("--root restore ok", withRoot.ok === true, JSON.stringify(withRoot));
    const overriddenIds = (overridden && overridden.quality && overridden.quality.findings.map((f) => f.id)) || [];
    check(
      "--root beats the bundle-derived root it would otherwise have used",
      overriddenIds.every((id) => id.endsWith("-ROOTTARGET")) && overriddenIds.length === 2,
      JSON.stringify(overriddenIds),
    );
  }

  // 13. Quality is RE-PROJECTED, where the journal is restored (I3).
  //
  //     The opposite of loadJournalEvents' embedded-wins rule, and chosen:
  //     see restore.ts's "Why quality does NOT follow the journal's
  //     embedded-wins rule". A backup file always carries a `quality` section
  //     (the export includes one), so `arkaik restore <backup-path>` sends
  //     the LIVE repo's sidecars rather than the backup's captured section —
  //     because the sidecars are canonical and a restore never touches them.
  //     Pinned here so it reads as a decision rather than an oversight.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    const local = JSON.parse(readFileSync(bundlePath, "utf8"));
    local.quality = {
      framework_version: "0.0.1",
      profile: { surfaces: [{ id: "web", title: "Web" }] },
      assessments: [],
      findings: [{ id: "F-FROM-THE-BACKUP", criterion_id: "SEC-01", surface: "web", title: "Captured in the backup" }],
    };
    writeFileSync(bundlePath, JSON.stringify(local));

    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("a bundle carrying its own section restores", result.ok === true, JSON.stringify(result));
    const ids = (sent && sent.quality && sent.quality.findings.map((f) => f.id)) || [];
    check(
      "the embedded section is REPLACED by the sidecars' projection, not preserved",
      !ids.includes("F-FROM-THE-BACKUP") && ids.length === 2,
      JSON.stringify(ids),
    );
    check(
      "while the journal keeps the opposite rule — embedded still wins there",
      Array.isArray(sent && sent.journal),
      JSON.stringify(sent && sent.journal),
    );
  }

  // 13b. A section that survives a FAILED fold is passed through — and the
  //      loss guard cannot see it, because the outbound bundle has one.
  //
  //      This is the undo path working: a backup file always carries a
  //      `quality` section (the export it was written from includes one), so
  //      dropping it on a machine whose sidecars are missing would make
  //      `arkaik restore <backup-path>` undo the snapshot and the journal
  //      while discarding the quality half of the state being restored.
  //      Deliberate, and now reported as such rather than as "none to fold".
  {
    const { dir, bundlePath } = fixture();
    const local = JSON.parse(readFileSync(bundlePath, "utf8"));
    local.quality = {
      framework_version: "0.0.1",
      profile: { surfaces: [{ id: "web", title: "Web" }] },
      assessments: [],
      findings: [{ id: "F-FROM-BACKUP-01", criterion_id: "SEC-01", surface: "web", title: "Captured in the backup" }],
    };
    writeFileSync(bundlePath, JSON.stringify(local));

    // No sidecars anywhere: the fold has nothing to project.
    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check("a restore carrying its own section proceeds", result.ok === true && result.status === 200, JSON.stringify(result));
    check(
      "the backup's captured section is sent verbatim",
      sent && sent.quality && sent.quality.findings[0].id === "F-FROM-BACKUP-01",
      JSON.stringify(sent && sent.quality),
    );
    check(
      "the loss guard does NOT fire — the outbound bundle does have a section",
      result.ok === true,
      result.fatal,
    );
    check(
      "and the notice says the section was kept, not that nothing was folded",
      /Kept the quality section this bundle already carried/.test(result.qualityNotice || ""),
      result.qualityNotice,
    );
    check("qualityFolded stays false — nothing was projected", result.qualityFolded === false, String(result.qualityFolded));
  }

  // 14. --dry-run folds, but reaches no guard (S8).
  //
  //     A dry run never fetches the export, so the loss guard cannot fire —
  //     which means a preview CANNOT warn you that the real run would refuse.
  //     Both halves are pinned so a refactor cannot move the fold below the
  //     dry-run return, nor the guard above it.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    let sent;
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY, (b) => { sent = b; }));
    const result = await runQualityRestore(dir, bundlePath, httpClient, { dryRun: true });

    check("dry-run with sidecars ok", result.ok === true && result.status === 200, JSON.stringify(result));
    check("dry-run still folds the section into what it previews", sent && sent.quality && sent.quality.assessments.length === 5, JSON.stringify(sent && sent.quality && sent.quality.assessments.length));
    check("dry-run fetches no export", httpClient.calls.filter((c) => c.url.endsWith("/export")).length === 0, JSON.stringify(httpClient.calls.map((c) => c.url)));
    check("and so the loss guard never fires, even against a hosted section", result.ok === true, result.fatal);
    check("dry-run takes no backup", backupsIn(dir).length === 0, JSON.stringify(backupsIn(dir)));
  }

  // 15. The notice is reported, in every direction (I2).
  //
  //     The server's delta covers nodes, edges and events and says nothing
  //     about quality, so a restore that just replaced a hosted section would
  //     otherwise be silent about it.
  {
    const { dir, bundlePath } = fixture();
    writeQualitySidecars(dir);
    const folded = await runQualityRestore(dir, bundlePath, makeMockHttpClient(qualityResponder(HOSTED_EXPORT)));
    check("a successful restore reports what it did with quality", /folded 5 assessment/.test(folded.qualityNotice || ""), folded.qualityNotice);
    check("and says so structurally, not only in prose", folded.qualityFolded === true, String(folded.qualityFolded));

    const stripped = await runQualityRestore(dir, bundlePath, makeMockHttpClient(qualityResponder(HOSTED_EXPORT)), {
      noQuality: true,
      allowQualityLoss: true,
    });
    check("--no-quality reports the delete rather than staying silent", /--no-quality/.test(stripped.qualityNotice || ""), stripped.qualityNotice);
    check("and reports that nothing was folded", stripped.qualityFolded === false, String(stripped.qualityFolded));

    const lines = captureConsoleLog(() => reportRestore(folded));
    check("reportRestore prints the notice", lines.some((l) => /Quality:/.test(l)), JSON.stringify(lines));
  }

  // 16. A non-object outbound `quality` is NOT a section (S4).
  //
  //     `null` is the reachable one — JSON.stringify writes it, hand-editing
  //     produces it — and an `=== undefined` check waved it through, so the
  //     guard stayed silent while the hosted section was erased and a `null`
  //     was sent in its place. The schema refuses it one layer down, but a
  //     guard that fails open on a shape it never considered is not a guard.
  for (const bad of [null, "oops", []]) {
    const { dir, bundlePath } = fixture();
    const local = JSON.parse(readFileSync(bundlePath, "utf8"));
    local.quality = bad;
    writeFileSync(bundlePath, JSON.stringify(local));

    // NOT --no-quality: that deletes the key outright, after which an
    // `=== undefined` check catches it too and this proves nothing. The repo
    // has no sidecars either, so the fold adds nothing and the bad value is
    // what actually reaches the guard.
    const httpClient = makeMockHttpClient(qualityResponder(HOSTED_EXPORT_WITH_QUALITY));
    const result = await runQualityRestore(dir, bundlePath, httpClient);

    check(
      `an outbound quality of ${JSON.stringify(bad)} counts as no section, and is refused`,
      result.ok === false && /ERASE the hosted project's quality section/.test(result.fatal || ""),
      `${JSON.stringify(bad)}: ${result.fatal}`,
    );
    check(
      `and nothing was sent for ${JSON.stringify(bad)}`,
      httpClient.calls.filter((c) => c.url.split("?")[0].endsWith("/bundle")).length === 0,
      JSON.stringify(httpClient.calls.map((c) => c.url)),
    );
  }

  // -------------------------------------------------------------------------
  // CLI-level: argv parsing / exit codes / --help, spawned — every case here
  // fails before any network call would be attempted.
  // -------------------------------------------------------------------------
  {
    const help = runCli(["restore", "--help"]);
    check("restore --help exits 0", help.status === 0 && /arkaik restore/.test(help.stdout), help.stdout);
    check("help documents --dry-run", /--dry-run/.test(help.stdout));
    check("help documents --allow-history-loss", /--allow-history-loss/.test(help.stdout));
    check("help documents --allow-deletions", /--allow-deletions/.test(help.stdout));
    check("help documents --no-quality", /--no-quality/.test(help.stdout));
    check("help documents --allow-quality-loss", /--allow-quality-loss/.test(help.stdout));
    check("help documents --audit", /--audit <id>/.test(help.stdout));
    check("help documents --root", /--root <dir>/.test(help.stdout));
    check("help documents --api", /--api/.test(help.stdout));
    check("help documents ARKAIK_URL", /ARKAIK_URL/.test(help.stdout));

    const contradiction = runCli(["restore", "--no-quality", "--audit", "2026-08"]);
    check(
      "--audit with --no-quality is refused at argv, before any network call",
      contradiction.status === 1 && /contradict each other/.test(`${contradiction.stdout}${contradiction.stderr}`),
      `${contradiction.stdout}\n${contradiction.stderr}`,
    );

    const badFlag = runCli(["restore", "--nope"]);
    check("unknown flag exits 1", badFlag.status === 1);

    const missingApiValue = runCli(["restore", "--api"]);
    check("--api with no value exits 1", missingApiValue.status === 1);

    const { dir } = fixture();
    // Explicitly scrub ARKAIK_TOKEN rather than relying on the ambient shell
    // not having one set (fragile — a developer's own shell might export it).
    const envWithoutToken = { ...process.env };
    delete envWithoutToken.ARKAIK_TOKEN;
    const noToken = spawnSync(process.execPath, [CLI, "restore"], { encoding: "utf8", cwd: dir, env: envWithoutToken });
    check("no ARKAIK_TOKEN in env exits 1", noToken.status === 1, `${noToken.status}\n${noToken.stdout}\n${noToken.stderr}`);
    check("no ARKAIK_TOKEN in env reports the reason", /ARKAIK_TOKEN/.test(noToken.stderr || noToken.stdout), noToken.stderr);

    const noLinkDir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-cli-nolink-"));
    createdDirs.push(noLinkDir);
    const noLink = spawnSync(process.execPath, [CLI, "restore"], { encoding: "utf8", cwd: noLinkDir, env: { ...process.env, ARKAIK_TOKEN: "tok" } });
    check("no link file (spawned) exits 1", noLink.status === 1, `${noLink.stdout}\n${noLink.stderr}`);
    check("no link file (spawned) reports the reason", /arkaik link|arkaik\.json/.test(noLink.stderr || noLink.stdout), noLink.stderr);

    const usage = runCli([]);
    check("top-level usage mentions restore", /restore/.test(usage.stdout), usage.stdout);
  }

  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Exercises `arkaik restore` (docs/superpowers/plans/2026-08-04-bootstrap-method.md
 * Task 12, docs/superpowers/specs/2026-08-04-bootstrap-method-design.md § 7).
 *
 * This is the one destructive verb the CLI offers, and the server keeps no
 * pre-image — the client-side backup this command writes before it ever
 * sends the destructive PUT is the only recovery path that exists. So this
 * suite weighs its coverage accordingly: every one of the six probes the
 * task called out gets a dedicated case, not just the happy path.
 *
 * Two layers, mirroring tests/cli/push.test.js (restore's closest template):
 *  - `runRestore()` exercised in-process: packages/cli/src/commands/restore.ts
 *    is esbuild-bundled (same technique build.js uses for the real CLI, just
 *    to a throwaway `.test-build/` dir) into an importable ESM module, so a
 *    mock `httpClient` can be injected straight into the exported function —
 *    no real network, ever, ONLY a real filesystem (temp dirs), which is what
 *    the backup-write probes actually need to exercise.
 *  - the built CLI binary (packages/cli/dist/index.js) spawned for the
 *    argv-parsing / exit-code / --help contract, using only cases that fail
 *    before any network call would be attempted.
 *
 * Probe -> coverage map:
 *  1. Backup-before-destructive, fail-closed: export GET throws, export GET
 *     non-200, export response not bundle-shaped, export bundle missing a
 *     journal array, and an unwritable backup directory — every one refuses
 *     with no PUT ever sent.
 *  2. What's in the backup: the written file is asserted to hold the EXPORT
 *     response's nodes/edges/journal (pre-restore hosted state), not the
 *     local bundle being sent.
 *  3. If-Match sourcing + 412: conflict message names the read/current
 *     versions, points at the backup, and does NOT say "retry".
 *  4. --dry-run takes no backup at all (asserted: no .backups dir created,
 *     no export call made) but still requires a version read for its own
 *     If-Match.
 *  5. Body assembly: bundle.json (no embedded journal) + journal.jsonl
 *     sidecar combine correctly; a bundle.json that DOES embed a journal
 *     wins over the sidecar (loadJournalEvents precedence).
 *  6. Every failure status (404, 428, 400 x2, 412, 403 x2, 413, 422) gets its
 *     own distinct, actionable message, and the real-restore ones name the
 *     backup path.
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

const HOSTED_EXPORT = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-old", project_id: "demo", species: "view", title: "Old", status: "live", platforms: ["web"] }],
  edges: [],
  journal: [{ id: "01J9ZK4E4N0000000000000000", ts: "2025-12-01T00:00:00.000Z", actor: "human", type: "node.created", node_id: "V-old", species: "view", title: "Old" }],
};

const createdDirs = [];

/** Fresh temp repo dir with docs/arkaik/{arkaik.json, bundle.json, journal.jsonl}. */
function fixture({ withEmbeddedJournal = false, apiBase = "http://example.invalid" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-"));
  createdDirs.push(dir);
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo", remote: apiBase }));
  const bundle = withEmbeddedJournal ? makeLocalBundle({ journal: [{ ...SIDECAR_EVENT, id: "EMBEDDED-EVENT" }] }) : makeLocalBundle();
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle));
  if (!withEmbeddedJournal) {
    writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), JSON.stringify(SIDECAR_EVENT) + "\n");
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
  const { runRestore, DEFAULT_API_BASE } = await import(pathToFileURL(RESTORE_BUNDLE).href);

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
    const backup = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", ".backups", backups[0]), "utf8"));
    check("backup holds the hosted (pre-restore) node count", backup.nodes.length === 1, JSON.stringify(backup.nodes));
    check(
      "backup holds the hosted journal, not the outgoing one",
      Array.isArray(backup.journal) && backup.journal.length === 1 && backup.journal[0].id !== SIDECAR_EVENT.id,
      JSON.stringify(backup.journal),
    );
  }

  // -------------------------------------------------------------------------
  // Probe 5b: a bundle.json that embeds its own journal wins over the
  // sidecar (loadJournalEvents precedence) — restore must not silently
  // prefer the sidecar and drop embedded history.
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
    await runRestore({ path: bundlePath, apiBase: "http://example.invalid", env: { ARKAIK_TOKEN: "tok" }, cwd: dir, httpClient });
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
  // Probe 3 / 6: every real-restore PUT failure status gets a distinct,
  // actionable message and names the backup path. 412 must not suggest a
  // blind retry.
  // -------------------------------------------------------------------------
  const putFailureCases = [
    { status: 404, body: { error: "not_found" }, mustInclude: [], mustNotInclude: ["conflict", "version"] },
    { status: 428, body: { error: "if_match_required" }, mustInclude: [] },
    { status: 400, body: { error: "if_match_unsupported" }, mustInclude: [] },
    { status: 400, body: { error: "invalid_dry_run" }, mustInclude: [] },
    {
      status: 412,
      body: { error: "conflict", current: "9" },
      mustInclude: ["9", "backup"],
      mustNotInclude: ["retry with the same"],
      assertNoBlindRetry: true,
    },
    { status: 403, body: { error: "limit_exceeded", limit: 500, actual: 600, tier: "starter" } },
    { status: 403, body: { error: "limit_exceeded", limit: null, actual: 600, tier: "klub" } },
    { status: 413, body: { error: "payload_too_large", limit: 5242880 } },
    {
      status: 422,
      body: { error: "invalid_bundle", errors: [{ path: "nodes[0].title", rule: "required", message: "Title is required.", severity: "error" }] },
    },
  ];

  const seenMessages = new Set();
  for (const { status, body } of putFailureCases) {
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

    const key = `${status}:${body.error}`;
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
    void key;
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
  // not crash, must report the backup path so recovery is still possible.
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
  }

  // -------------------------------------------------------------------------
  // CLI-level: argv parsing / exit codes / --help, spawned — every case here
  // fails before any network call would be attempted.
  // -------------------------------------------------------------------------
  {
    const help = runCli(["restore", "--help"]);
    check("restore --help exits 0", help.status === 0 && /arkaik restore/.test(help.stdout), help.stdout);
    check("help documents --dry-run", /--dry-run/.test(help.stdout));
    check("help documents --api", /--api/.test(help.stdout));

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

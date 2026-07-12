#!/usr/bin/env node

/**
 * Exercises `arkaik sync` (issue #222).
 *
 * Two layers:
 *  - `runSync()` exercised in-process: `packages/cli/src/commands/sync.ts` is
 *    esbuild-bundled (same technique `build.js` uses for the real CLI, just to
 *    a throwaway `.test-build/` dir) into an importable ESM module, so a mock
 *    `httpClient` can be injected straight into the exported function — no
 *    subprocess, no real network, ever.
 *  - the built CLI binary (`packages/cli/dist/index.js`) spawned for the
 *    argv-parsing / exit-code / --help contract, using only fixtures with no
 *    "live"-provider refs so a subprocess run can never reach the network.
 *
 * Covers:
 *  - a changed github-issue ref updates external_status + synced_at in the
 *    rewritten (canonical) bundle and appends exactly one ref.status_changed
 *    event, dual-write, same run;
 *  - an unchanged github-pr ref: no event, no write;
 *  - a failed fetch (404): the ref is left completely untouched, reported as
 *    an error, no event;
 *  - an unknown ref type (figma) and a stub-provider ref type (gitlab-issue):
 *    both left untouched, no error;
 *  - node.status is never modified, status_mapped is never set, for any node;
 *  - --dry-run (via runSync's dryRun option) writes nothing to bundle.json or
 *    journal.jsonl while still reporting the would-be change;
 *  - --provider filters processing to one provider's ref types;
 *  - a token from `env` reaches the GitHub request as a Bearer header;
 *  - `arkaik validate` stays VALID after a sync.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const SYNC_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "sync.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build");
const SYNC_BUNDLE = path.join(TEST_BUILD_DIR, "sync.mjs");

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

// ---------------------------------------------------------------------------
// Fixture: two nodes, refs covering every routing outcome sync must handle.
// ---------------------------------------------------------------------------
function makeBundle() {
  return {
    schema_version: 1,
    project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [
      {
        id: "V-home",
        project_id: "demo",
        species: "view",
        title: "Home",
        status: "live",
        platforms: ["web"],
        metadata: {
          refs: [
            { id: "gh-issue-1", type: "github-issue", url: "https://github.com/acme/demo/issues/42", title: "Tracking issue", external_status: "open" },
            { id: "gh-issue-404", type: "github-issue", url: "https://github.com/acme/demo/issues/99", external_status: "open" },
            { id: "gh-pr-1", type: "github-pr", url: "https://github.com/acme/demo/pull/7", external_status: "open" },
            { id: "figma-1", type: "figma", url: "https://figma.com/file/xyz", title: "Design" },
          ],
        },
      },
      {
        id: "V-settings",
        project_id: "demo",
        species: "view",
        title: "Settings",
        status: "live",
        platforms: ["web"],
        metadata: {
          refs: [{ id: "gl-issue-1", type: "gitlab-issue", url: "https://gitlab.com/acme/demo/-/issues/3", external_status: "opened" }],
        },
      },
    ],
    edges: [],
  };
}

const JOURNAL_LINES = [
  { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
  { id: "01B", ts: "2026-01-01T00:01:00.000Z", type: "node.created", node_id: "V-settings", species: "view", title: "Settings" },
  { id: "01C", ts: "2026-01-01T00:02:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
  { id: "01D", ts: "2026-01-01T00:03:00.000Z", type: "node.status_changed", node_id: "V-settings", from: "idea", to: "live" },
];
const JOURNAL = JOURNAL_LINES.map((e) => JSON.stringify(e)).join("\n") + "\n";

const createdDirs = [];

/** Fresh temp dir with bundle.json + journal.jsonl. Returns paths + parsed bundle for reference. */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-sync-"));
  createdDirs.push(dir);
  const bundlePath = path.join(dir, "bundle.json");
  const journalPath = path.join(dir, "journal.jsonl");
  const bundle = makeBundle();
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(journalPath, JOURNAL);
  return { dir, bundlePath, journalPath, originalBundle: bundle };
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function readJournalEvents(journalPath) {
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

function refById(bundle, nodeId, refId) {
  const node = bundle.nodes.find((n) => n.id === nodeId);
  return node?.metadata?.refs?.find((r) => r.id === refId);
}

/**
 * Deterministic JSON with keys sorted at every level, for comparing values
 * regardless of key order. serializeBundle canonicalizes nested object keys
 * alphabetically (docs/spec/bundle-format.md § Canonical Serialization), so a
 * ref's *value* survives a sync round-trip untouched even though its declared
 * key order does not.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Mock GitHub httpClient: routes by URL suffix, records every call it saw. */
function makeMockHttpClient() {
  const calls = [];
  const client = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/issues/42")) return jsonResponse(200, { state: "closed" });
    if (url.endsWith("/issues/99")) return jsonResponse(404, {});
    if (url.endsWith("/pulls/7")) return jsonResponse(200, { state: "open", merged: false });
    return jsonResponse(500, {});
  };
  client.calls = calls;
  return client;
}

async function main() {
  // Bundle sync.ts into an importable ESM module (mirrors build.js's own
  // esbuild invocation) so runSync can be called directly with a mock client.
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({
    entryPoints: [SYNC_ENTRY],
    outfile: SYNC_BUNDLE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    legalComments: "none",
  });
  const { runSync } = await import(pathToFileURL(SYNC_BUNDLE).href);

  // -------------------------------------------------------------------------
  // Core run: mixed outcomes across one sync call.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, journalPath, originalBundle } = fixture();
    const httpClient = makeMockHttpClient();
    const fixedNow = () => new Date("2026-07-01T00:00:00.000Z");

    const result = await runSync({ path: bundlePath, httpClient, now: fixedNow, env: {} });

    check("runSync ok", result.ok === true, JSON.stringify(result));
    check(
      "reports exactly one changed ref (gh-issue-1: open -> closed)",
      result.changed.length === 1 &&
        result.changed[0].nodeId === "V-home" &&
        result.changed[0].refId === "gh-issue-1" &&
        result.changed[0].from === "open" &&
        result.changed[0].to === "closed",
      JSON.stringify(result.changed),
    );
    check(
      "reports the unchanged github-pr ref",
      result.unchanged.some((u) => u.refId === "gh-pr-1" && u.status === "open"),
      JSON.stringify(result.unchanged),
    );
    check(
      "reports the unknown-type ref (figma) as skipped/unknown-type",
      result.skipped.some((s) => s.refId === "figma-1" && s.reason === "unknown-type"),
      JSON.stringify(result.skipped),
    );
    check(
      "reports the gitlab stub ref as skipped/stub-provider",
      result.skipped.some((s) => s.refId === "gl-issue-1" && s.reason === "stub-provider" && s.provider === "gitlab"),
      JSON.stringify(result.skipped),
    );
    check(
      "reports the 404 fetch as an error, not a change",
      result.errors.length === 1 && result.errors[0].refId === "gh-issue-404",
      JSON.stringify(result.errors),
    );

    // --- snapshot: only the changed ref was touched ---
    const after = readJson(bundlePath);
    const changedRef = refById(after, "V-home", "gh-issue-1");
    check("changed ref's external_status updated", changedRef.external_status === "closed", JSON.stringify(changedRef));
    check("changed ref's synced_at stamped", changedRef.synced_at === "2026-07-01T00:00:00.000Z", JSON.stringify(changedRef));

    const unchangedRef = refById(after, "V-home", "gh-pr-1");
    check(
      "unchanged ref is untouched by value (no synced_at added)",
      stableStringify(unchangedRef) === stableStringify(refById(originalBundle, "V-home", "gh-pr-1")),
      JSON.stringify(unchangedRef),
    );

    const erroredRef = refById(after, "V-home", "gh-issue-404");
    check(
      "errored ref is untouched by value",
      stableStringify(erroredRef) === stableStringify(refById(originalBundle, "V-home", "gh-issue-404")),
      JSON.stringify(erroredRef),
    );

    const figmaRef = refById(after, "V-home", "figma-1");
    check(
      "unknown-type ref round-trips untouched by value",
      stableStringify(figmaRef) === stableStringify(refById(originalBundle, "V-home", "figma-1")),
      JSON.stringify(figmaRef),
    );

    const gitlabRef = refById(after, "V-settings", "gl-issue-1");
    check(
      "stub-provider ref round-trips untouched by value",
      stableStringify(gitlabRef) === stableStringify(refById(originalBundle, "V-settings", "gl-issue-1")),
      JSON.stringify(gitlabRef),
    );

    // --- node.status / status_mapped invariants ---
    check(
      "node.status untouched on every node",
      after.nodes.every((n) => n.status === "live"),
      JSON.stringify(after.nodes.map((n) => n.status)),
    );
    check(
      "status_mapped never set on any ref",
      after.nodes.every((n) => (n.metadata?.refs ?? []).every((r) => r.status_mapped === undefined)),
    );

    // --- journal: exactly one new ref.status_changed event ---
    const events = readJournalEvents(journalPath);
    const newEvents = events.filter((e) => !JOURNAL_LINES.some((j) => j.id === e.id));
    check("appends exactly one new journal event", newEvents.length === 1, JSON.stringify(newEvents));
    const ev = newEvents[0];
    check(
      "appended event is a valid ref.status_changed",
      ev &&
        ev.type === "ref.status_changed" &&
        ev.node_id === "V-home" &&
        ev.ref_id === "gh-issue-1" &&
        ev.from === "open" &&
        ev.to === "closed" &&
        ev.synced_at === "2026-07-01T00:00:00.000Z",
      JSON.stringify(ev),
    );
    check("appended event has a ULID id (26 Crockford base32 chars)", ev && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(ev.id), ev?.id);
    check("appended event stamps an actor", ev && typeof ev.actor === "string" && ev.actor.length > 0, ev?.actor);

    // --- bundle rewritten canonically ---
    const raw = readFileSync(bundlePath, "utf8");
    check("rewritten bundle ends with a trailing newline", raw.endsWith("\n"));
    check("rewritten bundle is valid JSON", (() => {
      try {
        JSON.parse(raw);
        return true;
      } catch {
        return false;
      }
    })());

    // --- no request carried an Authorization header (no token supplied) ---
    check(
      "no Authorization header sent without a token",
      httpClient.calls.every((c) => c.init?.headers?.Authorization === undefined),
      JSON.stringify(httpClient.calls.map((c) => c.init?.headers)),
    );

    // --- validate stays green ---
    const validate = runCli(["validate", bundlePath]);
    check("validate stays VALID after sync", validate.status === 0 && /VALID/.test(validate.stdout), validate.stdout);
  }

  // -------------------------------------------------------------------------
  // --dry-run: reports the same diff, writes nothing.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, journalPath } = fixture();
    const bundleBefore = readFileSync(bundlePath, "utf8");
    const journalBefore = readFileSync(journalPath, "utf8");
    const httpClient = makeMockHttpClient();

    const result = await runSync({
      path: bundlePath,
      httpClient,
      dryRun: true,
      now: () => new Date("2026-07-01T00:00:00.000Z"),
      env: {},
    });

    check("dry-run still ok", result.ok === true);
    check("dry-run flags result.dryRun", result.dryRun === true);
    check(
      "dry-run still reports the would-be change",
      result.changed.length === 1 && result.changed[0].refId === "gh-issue-1" && result.changed[0].to === "closed",
      JSON.stringify(result.changed),
    );
    check("dry-run does not write the bundle", readFileSync(bundlePath, "utf8") === bundleBefore);
    check("dry-run does not write the journal", readFileSync(journalPath, "utf8") === journalBefore);
  }

  // -------------------------------------------------------------------------
  // --provider filters processing to one provider's ref types.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient();

    const result = await runSync({
      path: bundlePath,
      httpClient,
      provider: "gitlab",
      now: () => new Date("2026-07-01T00:00:00.000Z"),
      env: {},
    });

    check("runSync with --provider gitlab is ok", result.ok === true);
    check("no github refs were fetched (0 HTTP calls)", httpClient.calls.length === 0, JSON.stringify(httpClient.calls));
    check(
      "github refs are reported as filtered-out",
      result.skipped.some((s) => s.refId === "gh-issue-1" && s.reason === "filtered-out" && s.provider === "github"),
      JSON.stringify(result.skipped),
    );
    check(
      "the gitlab ref is still reported as a stub (filter matched, provider not live)",
      result.skipped.some((s) => s.refId === "gl-issue-1" && s.reason === "stub-provider"),
      JSON.stringify(result.skipped),
    );

    const unknown = await runSync({ path: bundlePath, httpClient, provider: "bogus-provider", env: {} });
    check("an unknown --provider name is a fatal error", unknown.ok === false && /Unknown provider/.test(unknown.fatal ?? ""), JSON.stringify(unknown));
  }

  // -------------------------------------------------------------------------
  // A token from `env` reaches the GitHub request as a Bearer header.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient();

    await runSync({
      path: bundlePath,
      httpClient,
      provider: "github",
      env: { GITHUB_TOKEN: "test-token-123" },
      now: () => new Date("2026-07-01T00:00:00.000Z"),
    });

    check(
      "GITHUB_TOKEN from env is sent as a Bearer token",
      httpClient.calls.length > 0 && httpClient.calls.every((c) => c.init?.headers?.Authorization === "Bearer test-token-123"),
      JSON.stringify(httpClient.calls.map((c) => c.init?.headers)),
    );
  }

  // -------------------------------------------------------------------------
  // CLI-level: argv parsing / exit codes, spawned — no live-provider refs in
  // these fixtures, so a real (unmocked) subprocess run can never reach the
  // network.
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-sync-cli-"));
    createdDirs.push(dir);
    const bundlePath = path.join(dir, "bundle.json");
    const bundle = makeBundle();
    // Strip every live-provider (github) ref — only figma + gitlab remain, so
    // the spawned CLI never performs a real fetch.
    bundle.nodes[0].metadata.refs = bundle.nodes[0].metadata.refs.filter((r) => r.type === "figma");
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");

    const help = runCli(["sync", "--help"]);
    check("sync --help exits 0", help.status === 0 && /arkaik sync/.test(help.stdout), help.stdout);

    const noNetwork = runCli(["sync", bundlePath]);
    check("sync with no live refs exits 0 (no network reachable)", noNetwork.status === 0, `${noNetwork.stdout}\n${noNetwork.stderr}`);
    check("sync reports no changes", /No ref status changes/.test(noNetwork.stdout), noNetwork.stdout);

    const dryRun = runCli(["sync", "--dry-run", bundlePath]);
    check("sync --dry-run exits 0", dryRun.status === 0, dryRun.stdout);

    const badProvider = runCli(["sync", "--provider", "bogus", bundlePath]);
    check("sync with an unknown --provider exits 1", badProvider.status === 1);

    const badFlag = runCli(["sync", "--nope", bundlePath]);
    check("sync with an unknown flag exits 1", badFlag.status === 1);
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

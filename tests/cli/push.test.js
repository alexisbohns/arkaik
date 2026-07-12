#!/usr/bin/env node

/**
 * Exercises `arkaik push` (issue #240, docs/spec/services.md § Publik →
 * Surfaces: "CLI `arkaik push`").
 *
 * Two layers, mirroring tests/cli/sync.test.js:
 *  - `runPush()`/`runPushDelete()` exercised in-process:
 *    packages/cli/src/commands/push.ts is esbuild-bundled (same technique
 *    build.js uses for the real CLI, just to a throwaway `.test-build/` dir)
 *    into an importable ESM module, so a mock `httpClient` can be injected
 *    straight into the exported functions — no subprocess, no real network,
 *    ever.
 *  - the built CLI binary (packages/cli/dist/index.js) spawned for the
 *    argv-parsing / exit-code / --help contract, using only cases that fail
 *    (validation, usage errors) before any network call would be attempted,
 *    so a spawned run can never reach the real network.
 *
 * Covers (the issue's required scenarios plus the full response matrix):
 *  - success (201): journal stripped by default and never sent, prints the
 *    URL + owner key;
 *  - --include-journal: journal embedded in the body, ?include_journal=true
 *    forwarded;
 *  - validation failure: an invalid bundle never reaches pack or the network;
 *  - 429 rate limited: retry-after surfaced;
 *  - 422 (server-side validation_failed): structured findings surfaced;
 *  - 413 / 503: clear messages;
 *  - a thrown network error is reported, not crashed;
 *  - delete: 204 success (Authorization: Bearer <key> sent), 403 wrong key,
 *    a network-level failure;
 *  - --api overrides the default https://arkaik.app base for both push and
 *    delete;
 *  - CLI-level: --help, --delete without --key, --key without --delete,
 *    unexpected positional with --delete, unknown flag, missing bundle file.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const PUSH_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "push.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build");
const PUSH_BUNDLE = path.join(TEST_BUILD_DIR, "push.mjs");

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
// Fixture: a minimal valid bundle + sidecar journal.
// ---------------------------------------------------------------------------
function makeBundle() {
  return {
    schema_version: 1,
    project: {
      id: "demo",
      title: "Demo",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      {
        id: "V-home",
        project_id: "demo",
        species: "view",
        title: "Home",
        status: "live",
        platforms: ["web"],
      },
    ],
    edges: [],
  };
}

const JOURNAL_LINES = [
  {
    id: "01J9ZK4E4N0000000000000001",
    ts: "2026-01-01T00:00:00.000Z",
    actor: "claude-code",
    type: "node.created",
    node_id: "V-home",
    species: "view",
    title: "Home",
  },
];
const JOURNAL = JOURNAL_LINES.map((e) => JSON.stringify(e)).join("\n") + "\n";

const createdDirs = [];

/** Fresh temp dir with bundle.json + journal.jsonl sidecar. */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-push-"));
  createdDirs.push(dir);
  const bundlePath = path.join(dir, "bundle.json");
  const journalPath = path.join(dir, "journal.jsonl");
  writeFileSync(bundlePath, JSON.stringify(makeBundle(), null, 2) + "\n");
  writeFileSync(journalPath, JOURNAL);
  return { dir, bundlePath, journalPath };
}

/** Fresh temp dir with a copy of the shared dangling-edge (invalid) fixture, no sidecar. */
function invalidFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-push-invalid-"));
  createdDirs.push(dir);
  const bundlePath = path.join(dir, "bundle.json");
  copyFileSync(path.join(FIXTURES, "dangling-edge.json"), bundlePath);
  return { dir, bundlePath };
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

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({
    entryPoints: [PUSH_ENTRY],
    outfile: PUSH_BUNDLE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    legalComments: "none",
  });
  const { runPush, runPushDelete, DEFAULT_API_BASE } = await import(pathToFileURL(PUSH_BUNDLE).href);

  check("DEFAULT_API_BASE is https://arkaik.app", DEFAULT_API_BASE === "https://arkaik.app", DEFAULT_API_BASE);

  // -------------------------------------------------------------------------
  // Success (201): journal stripped by default, never sent.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      check("POST url has no include_journal query by default", url === `${DEFAULT_API_BASE}/api/publik`, url);
      return jsonResponse(201, {
        id: "abc123",
        url: `${DEFAULT_API_BASE}/p/abc123`,
        owner_key: "11111111-1111-4111-8111-111111111111",
      });
    });

    const result = await runPush({ path: bundlePath, httpClient });

    check("runPush ok", result.ok === true, JSON.stringify(result));
    check("push validates first (valid: true)", result.valid === true);
    check("request was sent", result.requestSent === true);
    check("status 201", result.status === 201, result.status);
    check("returns the created id", result.id === "abc123", result.id);
    check("returns the shareable url", result.url === `${DEFAULT_API_BASE}/p/abc123`, result.url);
    check(
      "returns the one-time owner key",
      result.ownerKey === "11111111-1111-4111-8111-111111111111",
      result.ownerKey,
    );

    check("exactly one HTTP call made", httpClient.calls.length === 1, httpClient.calls.length);
    const call = httpClient.calls[0];
    check("method is POST", call.init.method === "POST");
    check(
      "content-type header set",
      call.init.headers["content-type"] === "application/json",
      JSON.stringify(call.init.headers),
    );
    const sentBundle = JSON.parse(call.init.body);
    check("sent body has no journal key at all (stripped, not just empty)", sentBundle.journal === undefined, JSON.stringify(Object.keys(sentBundle)));
    check("sent body carries the project", sentBundle.project && sentBundle.project.id === "demo", JSON.stringify(sentBundle.project));
  }

  // -------------------------------------------------------------------------
  // --include-journal: embeds the sidecar journal, forwards the query param.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient((url) => {
      check(
        "POST url forwards ?include_journal=true",
        url === `${DEFAULT_API_BASE}/api/publik?include_journal=true`,
        url,
      );
      return jsonResponse(201, { id: "xyz", url: `${DEFAULT_API_BASE}/p/xyz`, owner_key: "22222222-2222-4222-8222-222222222222" });
    });

    const result = await runPush({ path: bundlePath, includeJournal: true, httpClient });

    check("include-journal push ok", result.ok === true && result.status === 201, JSON.stringify(result));
    const sentBundle = JSON.parse(httpClient.calls[0].init.body);
    check(
      "sent body embeds the sidecar journal",
      Array.isArray(sentBundle.journal) && sentBundle.journal.length === 1,
      JSON.stringify(sentBundle.journal),
    );
  }

  // -------------------------------------------------------------------------
  // Validation failure: never reaches pack or the network.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = invalidFixture();
    const httpClient = makeMockHttpClient(() => {
      throw new Error("must not be called");
    });

    const result = await runPush({ path: bundlePath, httpClient });

    check("runPush ok (validation ran, just failed)", result.ok === true, JSON.stringify(result));
    check("valid is false", result.valid === false);
    check("no request was sent", result.requestSent === false);
    check("error lines report the dangling edge", result.errorLines.length > 0, JSON.stringify(result.errorLines));
    check("no HTTP call was attempted", httpClient.calls.length === 0, httpClient.calls.length);
  }

  // -------------------------------------------------------------------------
  // 429 rate limited: retry-after surfaced.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient(() =>
      jsonResponse(429, { error: "rate_limited", message: "Too many snapshots created. Try again later." }, { "retry-after": "37" }),
    );

    const result = await runPush({ path: bundlePath, httpClient });

    check("429 result ok (request completed)", result.ok === true);
    check("status 429", result.status === 429);
    check("retryAfter surfaced from header", result.retryAfter === "37", result.retryAfter);
    check("errorMessage surfaced from body", /Too many snapshots/.test(result.errorMessage || ""), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // 422: server-side validation_failed findings surfaced.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const findings = [{ path: "nodes[0].title", rule: "required", message: "Title is required.", severity: "error" }];
    const httpClient = makeMockHttpClient(() => jsonResponse(422, { error: "validation_failed", findings }));

    const result = await runPush({ path: bundlePath, httpClient });

    check("status 422", result.status === 422);
    check("serverFindings surfaced", Array.isArray(result.serverFindings) && result.serverFindings.length === 1, JSON.stringify(result.serverFindings));
  }

  // -------------------------------------------------------------------------
  // 413 payload too large.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient(() =>
      jsonResponse(413, { error: "payload_too_large", message: "Bundle exceeds the 5242880 byte limit." }),
    );

    const result = await runPush({ path: bundlePath, httpClient });

    check("status 413", result.status === 413);
    check("413 message surfaced", /exceeds the/.test(result.errorMessage || ""), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // 503 services unavailable.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = makeMockHttpClient(() =>
      jsonResponse(503, { error: "services_unavailable", message: "arkaik services (Publik) are not configured on this deployment." }),
    );

    const result = await runPush({ path: bundlePath, httpClient });

    check("status 503", result.status === 503);
    check("503 message surfaced", /not configured/.test(result.errorMessage || ""), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // A thrown network error is reported, not crashed.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const httpClient = async () => {
      throw new Error("getaddrinfo ENOTFOUND arkaik.app");
    };

    const result = await runPush({ path: bundlePath, httpClient });

    check("network error result ok (no crash)", result.ok === true, JSON.stringify(result));
    check("request not marked sent", result.requestSent === false);
    check("network error message surfaced", /Network error/.test(result.errorMessage || ""), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // --api overrides the default base for push.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const customBase = "http://localhost:4000";
    const httpClient = makeMockHttpClient((url) => {
      check("POST goes to the custom --api base", url === `${customBase}/api/publik`, url);
      return jsonResponse(201, { id: "id1", url: `${customBase}/p/id1`, owner_key: "33333333-3333-4333-8333-333333333333" });
    });

    const result = await runPush({ path: bundlePath, apiBase: customBase, httpClient });
    check("custom --api push ok", result.status === 201);
    check("returned url uses the custom base", result.url === `${customBase}/p/id1`, result.url);
  }

  // -------------------------------------------------------------------------
  // Delete: 204 success, Authorization: Bearer <key> sent.
  // -------------------------------------------------------------------------
  {
    const httpClient = makeMockHttpClient((url, init) => {
      check("DELETE url targets the snapshot id", url === `${DEFAULT_API_BASE}/api/publik/abc123`, url);
      check("DELETE method", init.method === "DELETE");
      check(
        "Authorization: Bearer <key> sent",
        init.headers.authorization === "Bearer the-owner-key",
        JSON.stringify(init.headers),
      );
      return jsonResponse(204, null);
    });

    const result = await runPushDelete({ id: "abc123", key: "the-owner-key", httpClient });

    check("delete ok", result.ok === true, JSON.stringify(result));
    check("delete deleted:true", result.deleted === true);
    check("delete status 204", result.status === 204);
  }

  // -------------------------------------------------------------------------
  // Delete: wrong key -> 403, clear error, not deleted.
  // -------------------------------------------------------------------------
  {
    const httpClient = makeMockHttpClient(() => jsonResponse(403, { error: "forbidden", message: "Owner key does not match." }));

    const result = await runPushDelete({ id: "abc123", key: "wrong-key", httpClient });

    check("wrong-key delete ok (request completed)", result.ok === true);
    check("wrong-key delete not deleted", result.deleted === false);
    check("wrong-key delete status 403", result.status === 403);
    check("wrong-key delete message surfaced", /does not match/.test(result.errorMessage || ""), result.errorMessage);
  }

  // -------------------------------------------------------------------------
  // Delete: a thrown network error is reported as a fatal, not a crash.
  // -------------------------------------------------------------------------
  {
    const httpClient = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await runPushDelete({ id: "abc123", key: "k", httpClient });
    check("delete network error is not ok", result.ok === false);
    check("delete network error fatal surfaced", /Network error/.test(result.fatal || ""), result.fatal);
  }

  // -------------------------------------------------------------------------
  // --api overrides the default base for delete.
  // -------------------------------------------------------------------------
  {
    const customBase = "http://localhost:4000";
    const httpClient = makeMockHttpClient((url) => {
      check("DELETE goes to the custom --api base", url === `${customBase}/api/publik/abc123`, url);
      return jsonResponse(204, null);
    });
    const result = await runPushDelete({ id: "abc123", key: "k", apiBase: customBase, httpClient });
    check("custom --api delete ok", result.deleted === true);
  }

  // -------------------------------------------------------------------------
  // CLI-level: argv parsing / exit codes, spawned — every case here fails
  // before any network call would be attempted, so a real (unmocked)
  // subprocess run can never reach the network.
  // -------------------------------------------------------------------------
  {
    const help = runCli(["push", "--help"]);
    check("push --help exits 0", help.status === 0 && /arkaik push/.test(help.stdout), help.stdout);
    check("help documents --delete", /--delete/.test(help.stdout));
    check("help documents --include-journal", /--include-journal/.test(help.stdout));
    check("help documents --api", /--api/.test(help.stdout));

    const noKey = runCli(["push", "--delete", "abc123"]);
    check("--delete without --key exits 1", noKey.status === 1, `${noKey.stdout}\n${noKey.stderr}`);
    check("--delete without --key reports the reason", /requires --key/.test(noKey.stderr || noKey.stdout), noKey.stderr);

    const keyWithoutDelete = runCli(["push", "--key", "somekey"]);
    check("--key without --delete exits 1", keyWithoutDelete.status === 1);

    const extraPositional = runCli(["push", "--delete", "abc123", "--key", "k", "extra-arg"]);
    check("unexpected positional with --delete exits 1", extraPositional.status === 1);

    const badFlag = runCli(["push", "--nope"]);
    check("unknown flag exits 1", badFlag.status === 1);

    const missingFile = runCli(["push", path.join(tmpdir(), "arkaik-push-does-not-exist", "bundle.json")]);
    check("missing bundle file exits 1 (fatal, before any network)", missingFile.status === 1, `${missingFile.stdout}\n${missingFile.stderr}`);

    const missingApiValue = runCli(["push", "--api"]);
    check("--api with no value exits 1", missingApiValue.status === 1);
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

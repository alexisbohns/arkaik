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
 *  - a Kritik `quality` section the SOURCE bundle carries is deleted before
 *    packing and never sent (#389) — open findings name unfixed
 *    vulnerabilities and where to find them;
 *  - --include-quality opts back in, folding the repo's docs/quality/ into
 *    the body (root DERIVED from the bundle's path, never the cwd) and
 *    forwarding ?include_quality=true; combines with --include-journal into a
 *    two-parameter query;
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

/**
 * Spawn the built CLI in a fixed, empty directory.
 *
 * Every spawned case here fails before packing (bad argv, or a bundle path
 * that does not exist), so nothing currently folds — but inheriting the
 * runner's cwd is the trap that made both this suite and
 * tests/cli/pack-open.test.js depend on whether the developer had run `arkaik
 * kritik profile` (#389). Pinning it costs one line and closes the class
 * rather than the instance.
 */
/**
 * A fixed empty directory, used as `cwd` by every spawned CLI case AND by
 * every in-process `runPush` whose fixture is not a repo.
 *
 * Those calls are safe today only because `push` defaults to
 * `noQuality: true`, and `runPack`'s strip branch returns before
 * `resolveQualityRoot` is reached. The first `includeQuality: true` case
 * written without a `cwd:` reopens the non-hermeticity fixed in 7f30926 and
 * again in 1b5293e. Pinning it here means there is no such case to write.
 */
const CLI_CWD = mkdtempSync(path.join(tmpdir(), "arkaik-push-cli-"));
function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: CLI_CWD });
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

/**
 * `docs/quality/` sidecars for a fixture repo: two audits that merge to five
 * cells and two findings. 2026-09 re-scores one of 2026-08's cells, so a fold
 * that concatenated or took only the newest would land a different number.
 *
 * The vendored `library.json` is not decoration. Without it `resolvePack`
 * falls through to the pack shipped beside the CLI, which under esbuild
 * resolves `import.meta.url` into `.test-build/assets/` — a directory that
 * does not exist — and the fold dies with a misleading "reinstall arkaik".
 * Vendoring makes these cases independent of how the module under test was
 * built.
 *
 * Findings are stored WITH severity/priority, exactly as the real sidecars
 * are, so a body that has them proves the section was passed through and a
 * body that lacks them proves it was folded.
 */
function writeQualitySidecars(dir) {
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
  write(["profile.json"], {
    surfaces: [{ id: "web", title: "Web app", platform: "web" }, { id: "admin", title: "Admin console" }],
    domain_weights: { SEC: 2, TST: 1 },
  });
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
        id: "F-2026-08-SEC-web-01",
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
        id: "F-2026-09-TST-admin-01",
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

/** Marker text planted in a bundle's OWN quality section, greppable in a request body. */
const LOCAL_SECTION_MARKER = "LOCAL SECTION MARKER";

/**
 * A real repo, unlike {@link fixture}: the bundle sits at the conventional
 * `docs/arkaik/bundle.json` with its journal sidecar beside it and a
 * `docs/quality/` tree alongside. That layout is what lets
 * `resolveQualityRoot` DERIVE the root from the bundle's own path — which is
 * both the behaviour `push.ts` relies on (it passes no `root:`, deliberately)
 * and what keeps these cases hermetic: `cwd` is pointed at an unrelated empty
 * directory, so nothing can reach into the repo the test runner happens to be
 * standing in. With the bundle at `<dir>/bundle.json` instead, the derivation
 * finds nothing, the fold silently falls back to `process.cwd()`, and the
 * suite's result depends on whether the developer's own checkout has a
 * `docs/quality/profile.json`.
 *
 * WHICH SECTION EACH CASE GETS — both end up at five assessments, and the
 * coincidence is worth spelling out:
 *  - `ownSection: true` plants a section on the bundle itself, one the fold
 *    did not create. Only the STRIP case uses it, because "deleted a section
 *    that was already there" is exactly what it has to prove;
 *  - by default there is no `quality` key at all, so any section in the
 *    request body was built by folding `docs/quality/`. That is the primary
 *    use case — pushing from a repo that has sidecars — and the opt-in cases
 *    assert it by the merge's own fingerprints: the re-scored cell at its
 *    NEWER level, and findings with `severity`/`priority` stripped, neither
 *    of which a pass-through could produce.
 */
function qualityFixture({ ownSection = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-push-quality-"));
  createdDirs.push(dir);
  const arkaikDir = path.join(dir, "docs", "arkaik");
  mkdirSync(arkaikDir, { recursive: true });

  const bundle = makeBundle();
  if (ownSection) {
    bundle.quality = {
      framework_version: "0.0.1",
      profile: { surfaces: [{ id: "web", title: "Web" }] },
      assessments: [],
      findings: [{ id: "F-local-01", title: LOCAL_SECTION_MARKER }],
    };
  }
  const bundlePath = path.join(arkaikDir, "bundle.json");
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(path.join(arkaikDir, "journal.jsonl"), JOURNAL);
  writeQualitySidecars(dir);

  // An empty directory to hand `runPush` as its cwd. Nothing under test may
  // read it, and if anything does, it finds no repo and fails loudly.
  const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-push-elsewhere-"));
  createdDirs.push(elsewhere);
  return { dir, bundlePath, elsewhere };
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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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
  // A `quality` section on the SOURCE bundle is stripped, never sent (#389).
  //
  // This is the one case that plants its own section: the success case above
  // has no `quality` key, so `sent.quality === undefined` would hold there
  // whether push deletes one or merely declines to add one. Here the bundle
  // arrives carrying findings — and the repo has sidecars that would fold
  // into a section too — so both routes to a section are live and both must
  // come to nothing. Server-side stripping (lib/services/publik.ts) is a
  // second line, not this one.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, elsewhere } = qualityFixture({ ownSection: true });
    const httpClient = makeMockHttpClient((url) => {
      check("no include_quality query by default", url === `${DEFAULT_API_BASE}/api/publik`, url);
      return jsonResponse(201, { id: "q1", url: `${DEFAULT_API_BASE}/p/q1`, owner_key: "33333333-3333-4333-8333-333333333333" });
    });
    const result = await runPush({ path: bundlePath, cwd: elsewhere, httpClient });

    check("push of a quality-carrying bundle ok", result.ok === true && result.status === 201, JSON.stringify(result));
    if (httpClient.calls.length === 0) {
      check("the source bundle's quality section is not sent", false, "no request was sent");
    } else {
      const sentBundle = JSON.parse(httpClient.calls[0].init.body);
      check(
        "the source bundle's quality section is not sent",
        sentBundle.quality === undefined,
        JSON.stringify(Object.keys(sentBundle)),
      );
      check(
        "and no finding text leaks through any other key",
        !httpClient.calls[0].init.body.includes(LOCAL_SECTION_MARKER) &&
          !httpClient.calls[0].init.body.includes("Token in the repo"),
        httpClient.calls[0].init.body.slice(0, 300),
      );
      check("the rest of the bundle still goes", sentBundle.project && sentBundle.project.id === "demo");
    }
  }

  // -------------------------------------------------------------------------
  // --include-quality: the opt-in, and the first case that folds for real.
  //
  // The bundle carries NO quality key, so everything asserted below was built
  // by folding this repo's docs/quality/ — the primary use case, and one a
  // fixture with a pre-loaded section could never have exercised. The
  // fingerprints are the merge's own: five cells rather than the six a
  // concatenation gives or the two a newest-only takes, the re-scored cell at
  // its NEWER level, and findings whose stored severity/priority are gone.
  //
  // `cwd` is an unrelated empty dir. The root that finds the sidecars is
  // DERIVED from the bundle's path — which is why push.ts passes no `root:`,
  // and why passing one would break this.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, elsewhere } = qualityFixture();
    const httpClient = makeMockHttpClient((url) => {
      check(
        "--include-quality forwards ?include_quality=true",
        url === `${DEFAULT_API_BASE}/api/publik?include_quality=true`,
        url,
      );
      return jsonResponse(201, { id: "q2", url: `${DEFAULT_API_BASE}/p/q2`, owner_key: "44444444-4444-4444-8444-444444444444" });
    });
    const result = await runPush({ path: bundlePath, cwd: elsewhere, includeQuality: true, httpClient });

    check("include-quality push ok", result.ok === true && result.status === 201, JSON.stringify(result));
    if (httpClient.calls.length === 0) {
      check("the folded section is sent", false, "no request was sent");
    } else {
      const sentBundle = JSON.parse(httpClient.calls[0].init.body);
      const quality = sentBundle.quality;
      check(
        "the folded section is sent, merged across both audits (5 cells, not 6 or 2)",
        quality && quality.assessments.length === 5,
        JSON.stringify(quality && quality.assessments.length),
      );
      check(
        "the newer audit won the re-scored cell — a pass-through could not do this",
        quality && quality.assessments.some((a) => a.criterion_id === "SEC-01" && a.surface === "web" && a.level === 4),
        JSON.stringify(quality && quality.assessments),
      );
      check(
        "the findings that were the reason for the default, pooled across audits",
        quality && quality.findings.length === 2,
        JSON.stringify(quality && quality.findings.map((f) => f.id)),
      );
      check(
        "derived severity/priority stripped, as only a fold does",
        quality && quality.findings.every((f) => !("severity" in f) && !("priority" in f)),
        JSON.stringify(quality && quality.findings.map((f) => Object.keys(f))),
      );
      check(
        "the vendored pack rode along, not the one the CLI ships",
        quality && quality.library && quality.library.scales.grades.A === 97,
        JSON.stringify(quality && quality.library && quality.library.scales),
      );
      check(
        "and the journal is still stripped — the two opt-ins are independent",
        sentBundle.journal === undefined,
        JSON.stringify(Object.keys(sentBundle)),
      );
    }
  }

  // -------------------------------------------------------------------------
  // --include-quality from a repo with NO sidecars: the section the bundle
  // carried goes on the wire, and push says so (#389 I2/S9).
  //
  // The fold only ever SETS `quality`; it never clears one. So "nothing to
  // fold" does not mean "nothing is sent" — and push used to say nothing at
  // all on either stream, including when it folded and shipped megabytes.
  // -------------------------------------------------------------------------
  {
    const { dir, bundlePath, elsewhere } = qualityFixture({ ownSection: true });
    rmSync(path.join(dir, "docs", "quality"), { recursive: true, force: true });

    const httpClient = makeMockHttpClient(() =>
      jsonResponse(201, { id: "q4", url: `${DEFAULT_API_BASE}/p/q4`, owner_key: "66666666-6666-4666-8666-666666666666" }),
    );
    const result = await runPush({ path: bundlePath, cwd: elsewhere, includeQuality: true, httpClient });

    check("include-quality with no sidecars still pushes", result.ok === true && result.status === 201, JSON.stringify(result));
    const sentBundle = JSON.parse(httpClient.calls[0].init.body);
    check(
      "the section the bundle carried is what goes on the wire",
      sentBundle.quality && sentBundle.quality.findings[0].title === LOCAL_SECTION_MARKER,
      JSON.stringify(sentBundle.quality),
    );
    check(
      "and push says the section was kept rather than folded",
      /Kept the quality section this bundle already carried/.test(result.qualityNotice || ""),
      result.qualityNotice,
    );
  }

  // -------------------------------------------------------------------------
  // push reports what it did with quality, in both directions (S9).
  // -------------------------------------------------------------------------
  {
    const { bundlePath, elsewhere } = qualityFixture();
    const client = makeMockHttpClient(() => jsonResponse(201, { id: "q5", url: "u", owner_key: "k" }));
    const sent = await runPush({ path: bundlePath, cwd: elsewhere, includeQuality: true, httpClient: client });
    check("a folded push reports the fold", /folded 5 assessment/.test(sent.qualityNotice || ""), sent.qualityNotice);

    const client2 = makeMockHttpClient(() => jsonResponse(201, { id: "q6", url: "u", owner_key: "k" }));
    const stripped = await runPush({ path: bundlePath, cwd: elsewhere, httpClient: client2 });
    check(
      "and the DEFAULT strip is reported too, rather than being silent",
      /stripped, not sent/.test(stripped.qualityNotice || "") && /--include-quality/.test(stripped.qualityNotice || ""),
      stripped.qualityNotice,
    );
  }

  // -------------------------------------------------------------------------
  // Both opt-ins at once: two query parameters, both sections in the body.
  //
  // This is what the URL is assembled from a list for. Appending a second
  // "?..." would produce `?include_journal=true?include_quality=true`, which
  // the server reads as one parameter with a junk value — and every
  // single-flag case above would still pass.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, elsewhere } = qualityFixture();
    const httpClient = makeMockHttpClient((url) => {
      check(
        "both flags produce one query with two parameters",
        url === `${DEFAULT_API_BASE}/api/publik?include_journal=true&include_quality=true`,
        url,
      );
      return jsonResponse(201, { id: "q3", url: `${DEFAULT_API_BASE}/p/q3`, owner_key: "55555555-5555-4555-8555-555555555555" });
    });
    const result = await runPush({ path: bundlePath, cwd: elsewhere, includeJournal: true, includeQuality: true, httpClient });

    check("both-flags push ok", result.ok === true && result.status === 201, JSON.stringify(result));
    if (httpClient.calls.length === 0) {
      check("the body carries the journal", false, "no request was sent");
    } else {
      const sentBundle = JSON.parse(httpClient.calls[0].init.body);
      check(
        "the body carries the journal",
        Array.isArray(sentBundle.journal) && sentBundle.journal.length === 1,
        JSON.stringify(sentBundle.journal),
      );
      check(
        "and the folded quality section, in the same request",
        sentBundle.quality && sentBundle.quality.assessments.length === 5,
        JSON.stringify(sentBundle.quality && sentBundle.quality.assessments.length),
      );
    }
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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, includeJournal: true, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, httpClient });

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

    const result = await runPush({ path: bundlePath, cwd: CLI_CWD, apiBase: customBase, httpClient });
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
    check("help documents --include-quality", /--include-quality/.test(help.stdout));
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

    // --include-quality must reach runPush, not the unknown-flag branch. Both
    // outcomes exit 1 on a missing file, so the reason is what is asserted.
    const optIn = runCli(["push", "--include-quality", path.join(tmpdir(), "arkaik-push-does-not-exist", "bundle.json")]);
    check(
      "--include-quality parses, and fails on the file rather than the flag",
      optIn.status === 1 && !/Unknown option/.test(`${optIn.stdout}${optIn.stderr}`) && /FATAL/.test(`${optIn.stdout}${optIn.stderr}`),
      `${optIn.stdout}\n${optIn.stderr}`,
    );

    const missingFile = runCli(["push", path.join(tmpdir(), "arkaik-push-does-not-exist", "bundle.json")]);
    check("missing bundle file exits 1 (fatal, before any network)", missingFile.status === 1, `${missingFile.stdout}\n${missingFile.stderr}`);

    const missingApiValue = runCli(["push", "--api"]);
    check("--api with no value exits 1", missingApiValue.status === 1);
  }

  for (const dir of [...createdDirs, CLI_CWD]) rmSync(dir, { recursive: true, force: true });
  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

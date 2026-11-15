#!/usr/bin/env node

/**
 * The weighing sidecars (docs/rfcs/weighing.md): `docs/weighing/` folded into a
 * bundle's `weighing` section by `arkaik pack`, deleted by `--no-weighing`, and
 * withheld by `arkaik push` unless `--include-weighing` says otherwise.
 *
 * Drives the BUILT CLI in mkdtemp repos for `pack`, and an esbuild-bundled
 * `push.ts` in-process with a mock `httpClient` for the network half — the two
 * techniques tests/cli/quality-section-fold.test.js and tests/cli/push.test.js
 * already use, so nothing here ever reaches a real network.
 *
 * Run under `npm run test:cli`, where it is the last step (that script builds the CLI first).
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const PUSH_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "push.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-weighing");
const PUSH_BUNDLE = path.join(TEST_BUILD_DIR, "push.mjs");
const FILES_ENTRY = path.join(ROOT, "packages", "schema", "src", "cli", "weighing-files.ts");
const FILES_BUNDLE = path.join(TEST_BUILD_DIR, "weighing-files.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "demo", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { values: ["connects"] } }],
  edges: [],
};

const HUMAN = { kind: "human", id: "alexis" };
const ROW = (over = {}) => ({
  matrix: "value",
  subject: "AC-a",
  criterion: "connects",
  level: 2,
  scorer: HUMAN,
  confidence: 2,
  evidence: "the title says so",
  basis: { fingerprint: "fp1-0", set_version: "1.0.0" },
  ts: "2026-11-15T10:00:00.000Z",
  ...over,
});
const POSITIONING = {
  id: "positioning",
  version: "1.0.0",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: {} },
  role: "positioning",
  status: "active",
  extends: "value-contribution@1",
  criteria: [{ id: "connects", weight: 3 }],
};

/** A repo: docs/arkaik/bundle.json, plus docs/weighing/ files unless `withFiles` is false. */
function repo({ withFiles = true, bundle = BUNDLE } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-weighing-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle, null, 2));
  if (withFiles) {
    mkdirSync(path.join(dir, "docs", "weighing", "assessments"), { recursive: true });
    mkdirSync(path.join(dir, "docs", "weighing", "sets"), { recursive: true });
    writeFileSync(
      path.join(dir, "docs", "weighing", "assessments", "value.json"),
      JSON.stringify({ matrix: "value", assessments: [ROW({ level: 3, scorer: { kind: "agent", id: "arkaik-mcp" } }), ROW()] }, null, 2),
    );
    writeFileSync(path.join(dir, "docs", "weighing", "sets", "positioning.json"), JSON.stringify(POSITIONING, null, 2));
  }
  return { dir, bundlePath: path.join(dir, "docs", "arkaik", "bundle.json") };
}

const pack = (args, cwd) => spawnSync(process.execPath, [CLI, "pack", ...args], { encoding: "utf8", cwd });

async function main() {
  // --- pack folds the sidecars -----------------------------------------------
  {
    const { dir, bundlePath } = repo();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-weighing-elsewhere-"));
    const res = pack([bundlePath], elsewhere);
    check("pack exits 0", res.status === 0, res.stderr);
    const out = JSON.parse(res.stdout);
    check("pack folds the assessments of every scorer kind", out.weighing?.assessments?.length === 2, JSON.stringify(out.weighing?.assessments?.length));
    check("…in the stable order: authority within a cell", out.weighing.assessments[0].scorer.kind === "human" && out.weighing.assessments[1].scorer.kind === "agent");
    check("pack folds the positioning set", out.weighing.sets.length === 1 && out.weighing.sets[0].id === "positioning" && out.weighing.sets[0].criteria[0].weight === 3);
    check("the built-in matrix is not stored", Array.isArray(out.weighing.matrices) && out.weighing.matrices.length === 0);
    check("the root is the bundle's repo, not the cwd (a repo elsewhere folds in)", out.weighing !== undefined);
    check("pack says what it folded", /Weighing: folded 2 assessment\(s\), 1 set\(s\)/.test(res.stderr), res.stderr);
    check("the source bundle file is never rewritten", !("weighing" in JSON.parse(readFileSync(bundlePath, "utf8"))));
    check("schema_version stays 3", out.schema_version === 3);
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }

  // --- nothing to fold is not a failure -----------------------------------------
  {
    const { dir, bundlePath } = repo({ withFiles: false });
    const res = pack([bundlePath], dir);
    check("no docs/weighing/ still packs", res.status === 0, res.stderr);
    check("…and adds no section", !("weighing" in JSON.parse(res.stdout)));
    check("…and says so", /Weighing: none to fold/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo({ withFiles: false, bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const res = pack([bundlePath], dir);
    const out = JSON.parse(res.stdout);
    check("a section the bundle already carried survives a fold with nothing to fold", out.weighing?.assessments?.length === 1);
    check("…and the notice says it was kept", /Kept the weighing section/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- --no-weighing DELETES ------------------------------------------------------
  {
    const { dir, bundlePath } = repo({ bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const res = pack(["--no-weighing", bundlePath], dir);
    const out = JSON.parse(res.stdout);
    check("--no-weighing removes the section, folded or carried", !("weighing" in out));
    check("--no-weighing does not touch quality or the rest", out.nodes.length === 1);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- a malformed sidecar is named ---------------------------------------------------
  {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "assessments", "value.json"), "{ not json");
    const res = pack([bundlePath], dir);
    check("a malformed sidecar fails the pack", res.status !== 0);
    check("…naming the file", /value\.json/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "assessments", "value.json"), JSON.stringify({ matrix: "value" }));
    const res = pack([bundlePath], dir);
    check("a file with no assessments array fails the pack, naming it", res.status !== 0 && /value\.json/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // JSON that parses but is not { assessments: [] } is named, never a TypeError.
  for (const [what, body] of [["null", "null"], ["a bare array", "[]"], ["a string", '"x"']]) {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "assessments", "value.json"), body);
    const res = pack([bundlePath], dir);
    check(`a sidecar holding ${what} fails the pack naming the file`, res.status !== 0 && /value\.json/.test(res.stderr) && !/TypeError|Cannot read/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // A set sidecar fails the same way: named, never a null folded into the section.
  for (const [what, body] of [["null", "null"], ["a bare array", "[]"], ["a string", '"x"']]) {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "sets", "positioning.json"), body);
    const res = pack([bundlePath], dir);
    check(`a set sidecar holding ${what} fails the pack naming the file and what it expected`, res.status !== 0 && /positioning\.json: expected a criteria set object/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- the writers and the loaders agree (weighing-files.ts, which load-schema.js does not discover) ---
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [FILES_ENTRY], outfile: FILES_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const files = await import(pathToFileURL(FILES_BUNDLE).href);
  {
    const root = mkdtempSync(path.join(tmpdir(), "arkaik-weighing-rt-"));
    check("an empty root has no section", files.loadWeighingSection(root) === undefined);
    // Written out of order on purpose: the save sorts (matrix, subject, criterion, then authority).
    const rows = [ROW({ subject: "AC-b", criterion: "connects" }), ROW({ scorer: { kind: "agent", id: "arkaik-mcp" }, level: 3 }), ROW()];
    files.saveWeighingAssessments(root, "value", rows);
    files.saveWeighingSet(root, POSITIONING);
    const section = files.loadWeighingSection(root);
    check("the section the loaders read has every row that was saved", section?.assessments?.length === 3, JSON.stringify(section?.assessments?.length));
    check("…in the sorted order: subject, then authority (human before agent)", section.assessments.map((a) => `${a.subject}:${a.scorer.kind}`).join() === "AC-a:human,AC-a:agent,AC-b:human", section.assessments.map((a) => `${a.subject}:${a.scorer.kind}`).join());
    check("the saved set reads back whole", JSON.stringify(section.sets) === JSON.stringify([POSITIONING]));
    check("loadMatrixAssessments reads one matrix's rows", files.loadMatrixAssessments(root, "value").length === 3 && files.loadMatrixAssessments(root, "other").length === 0);
    files.saveWeighingAssessments(root, "value", files.loadMatrixAssessments(root, "value").slice(0, 1));
    check("a second save replaces the file, it does not append", files.loadMatrixAssessments(root, "value").length === 1);
    let unsafe = null;
    try {
      files.saveWeighingAssessments(root, "../escape", []);
    } catch (error) {
      unsafe = error;
    }
    check("a matrix id that is a path is refused", unsafe !== null && /not a valid weighing id/.test(unsafe.message));
    rmSync(root, { recursive: true, force: true });
  }

  // --- push withholds it by default ---------------------------------------------------
  await build({ entryPoints: [PUSH_ENTRY], outfile: PUSH_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { runPush, DEFAULT_API_BASE } = await import(pathToFileURL(PUSH_BUNDLE).href);
  const client = (sink) => async (url, init) => {
    sink.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201, json: async () => ({ id: "abc", url: `${DEFAULT_API_BASE}/p/abc`, owner_key: "11111111-1111-4111-8111-111111111111" }), headers: { get: () => null } };
  };
  {
    const { dir, bundlePath } = repo({ bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const calls = [];
    const result = await runPush({ path: bundlePath, cwd: dir, httpClient: client(calls) });
    check("a default push succeeds", result.ok === true && result.status === 201, JSON.stringify(result));
    check("the default push never sends a weighing section — carried or folded", calls.length === 1 && !("weighing" in calls[0].body));
    check("…and forwards no include_weighing", calls[0].url === `${DEFAULT_API_BASE}/api/publik`, calls[0].url);
    check("…no assessment evidence is anywhere in the body", !JSON.stringify(calls[0].body).includes("the title says so"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    const calls = [];
    const result = await runPush({ path: bundlePath, cwd: dir, includeWeighing: true, httpClient: client(calls) });
    check("--include-weighing succeeds", result.ok === true && result.status === 201, JSON.stringify(result));
    check("…folds the repo's docs/weighing/ into the body", calls[0].body.weighing?.assessments?.length === 2);
    check("…and forwards ?include_weighing=true", calls[0].url === `${DEFAULT_API_BASE}/api/publik?include_weighing=true`, calls[0].url);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    const calls = [];
    await runPush({ path: bundlePath, cwd: dir, includeWeighing: true, includeQuality: true, includeJournal: true, httpClient: client(calls) });
    check("the three opt-ins combine into one query string", calls[0].url === `${DEFAULT_API_BASE}/api/publik?include_journal=true&include_quality=true&include_weighing=true`, calls[0].url);
    rmSync(dir, { recursive: true, force: true });
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`\n${failures} weighing CLI test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing CLI tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

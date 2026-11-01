#!/usr/bin/env node

/**
 * `arkaik shot` (packages/cli/src/commands/shot.ts): post a manifest of
 * screenshot URLs to the hosted door, or dual-write them into a repo bundle.
 *
 *  - hosted: `runShot` in-process with a mock httpClient recording every call
 *    (tests/cli/live.test.js's idiom), so the body and exit outcome are
 *    asserted without a network;
 *  - Kommit: the built CLI against a tmpdir bundle + journal (deliverable.test.js's idiom);
 *  - argv errors through the built CLI.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const SHOT_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "shot.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-shot");
const SHOT_BUNDLE = path.join(TEST_BUILD_DIR, "shot.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${typeof detail === "function" ? detail() : detail}` : ""}`); }
}

function makeMockHttpClient(responder) {
  const calls = [];
  const client = async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); };
  client.calls = calls;
  return client;
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function linkedDir(remote = "https://arkaik.test") {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-shot-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_test", remote }));
  return dir;
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});
const CREATED = JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" });
const MANIFEST = JSON.stringify([{ node_id: "V-home", platform: "web", url: "https://shots.example/home.png", detail: "HomeTest.default" }]);

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [SHOT_ENTRY], outfile: SHOT_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { runShot } = await import(pathToFileURL(SHOT_BUNDLE).href);

  // --- hosted ---------------------------------------------------------------------
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "2", applied: [{ node_id: "V-home", platform: "web", url: "https://shots.example/home.png" }], skipped: [], events: [] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "412"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: exits ok", result.ok === true, () => out.join("\n"));
    check("hosted: posts to the screenshots door with a bearer token", http.calls.length === 1 && /\/api\/graph\/projects\/prj_test\/screenshots$/.test(http.calls[0].url) && http.calls[0].init.headers.authorization === "Bearer t", JSON.stringify(http.calls[0]?.url));
    const body = JSON.parse(http.calls[0].init.body);
    check("hosted: the entries carry commit and order from the flags", body.entries[0].node_id === "V-home" && body.entries[0].commit === "abc1234" && body.entries[0].order === 412 && body.entries[0].detail === "HomeTest.default", JSON.stringify(body));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(422, { error: "refused", refusals: [{ index: 0, node_id: "V-home", platform: "web", reason: "platform_not_applicable", detail: "V-home lists: ios" }] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: a refusal is exit 1 naming the entry", result.ok === false && out.some((m) => /V-home@web.*platform_not_applicable/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "2", applied: [], skipped: [{ index: 0, node_id: "V-home", platform: "web", reason: "stale_order" }], events: [] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: a skip is exit 0 and says why", result.ok === true && out.some((m) => /stale_order/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: {}, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: no ARKAIK_TOKEN is exit 1 naming screenshot:append", result.ok === false && out.some((m) => /ARKAIK_TOKEN/.test(m) && /screenshot:append/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: --commit is required", result.ok === false && out.some((m) => /--commit/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }

  // --- Kommit ---------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-shot-kommit-"));
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
    const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
    writeFileSync(bundlePath, BUNDLE);
    writeFileSync(journalPath, `${CREATED}\n`);
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const res = spawnSync(process.execPath, [CLI, "shot", "--manifest", "shots.json", "--commit", "abc1234", "--order", "7"], { encoding: "utf8", cwd: dir });
    check("kommit: exits 0", res.status === 0, res.stderr + res.stdout);
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    const home = bundle.nodes.find((n) => n.id === "V-home");
    check("kommit: the slot is written", home.metadata?.platformScreenshots?.web === "https://shots.example/home.png", JSON.stringify(home.metadata));
    check("kommit: the meta carries ci provenance", home.metadata?.platformScreenshotMeta?.web?.source === "ci" && home.metadata.platformScreenshotMeta.web.order === 7 && home.metadata.platformScreenshotMeta.web.ci_order === 7, JSON.stringify(home.metadata));
    const lines = readFileSync(journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("kommit: one screenshot.recorded appended with actor arkaik-cli", lines.find((e) => e.type === "screenshot.recorded" && e.actor === "arkaik-cli" && e.url === "https://shots.example/home.png" && e.order === 7) !== undefined, JSON.stringify(lines));
    const validate = spawnSync(process.execPath, [CLI, "validate", bundlePath], { encoding: "utf8", cwd: dir });
    check("kommit: the bundle validates after the write", validate.status === 0, validate.stdout + validate.stderr);
    const again = spawnSync(process.execPath, [CLI, "shot", "--manifest", "shots.json", "--commit", "abc1234", "--order", "7"], { encoding: "utf8", cwd: dir });
    check("kommit: a re-run writes nothing and exits 0", again.status === 0 && readFileSync(journalPath, "utf8").trim().split("\n").length === 2, again.stdout + again.stderr);
    const manual = spawnSync(process.execPath, [CLI, "shot", "V-home", "web", "https://shots.example/by-hand.png"], { encoding: "utf8", cwd: dir });
    check("kommit: a positional shot without --commit is manual", manual.status === 0 && JSON.parse(readFileSync(bundlePath, "utf8")).nodes[0].metadata.platformScreenshotMeta.web.source === "manual", manual.stdout + manual.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- argv errors ------------------------------------------------------------------
  {
    const res = spawnSync(process.execPath, [CLI, "shot", "--manifest=shots.json"], { encoding: "utf8" });
    check("an --flag=value form is refused", res.status === 1 && /Unknown flag/.test(res.stderr), res.stderr);
    const help = spawnSync(process.execPath, [CLI, "shot", "--help"], { encoding: "utf8" });
    check("--help prints usage and exits 0", help.status === 0 && /arkaik shot/.test(help.stdout));
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node

/**
 * `arkaik live` (packages/cli/src/commands/live.ts): derive the acceptances a
 * deploy carried from merged PR mentions, and post them to the #424 door.
 *
 *  - `deriveLiveIds` is pure and exercised directly: explicit `@platform`
 *    counts, other platforms never do, unknown suffixes are reported, and a
 *    bare mention counts only when the PR touched one of `--paths`.
 *  - `runLive` is exercised in-process with a mock httpClient recording every
 *    call, so the request body, chunking and exit outcomes are asserted
 *    without a network.
 *  - argv errors go through the built CLI (spawn), as the other suites do.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const LIVE_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "live.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-live");
const LIVE_BUNDLE = path.join(TEST_BUILD_DIR, "live.mjs");

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
  const client = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  client.calls = calls;
  return client;
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** A linked repo: docs/arkaik/arkaik.json pointing at a project. */
function linkedDir(remote = "https://arkaik.test") {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-live-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_test", remote }));
  return dir;
}

const pr = (number, body, files = [], title = `PR ${number}`) => ({ number, title, body, files });

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [LIVE_ENTRY], outfile: LIVE_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { deriveLiveIds, runLive } = await import(pathToFileURL(LIVE_BUNDLE).href);

  // --- deriveLiveIds -----------------------------------------------------------
  {
    const r = deriveLiveIds([pr(1, "ships AC-a@web and AC-b@ios")], "web", []);
    check("an explicit @web mention counts on a web deploy, and a mention of another platform never does", JSON.stringify(r.ids) === '["AC-a"]', JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(2, "closes AC-c")], "web", []);
    check("with no --paths, a bare mention counts", JSON.stringify(r.ids) === '["AC-c"]', JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(3, "closes AC-d", ["apps/web/page.tsx"]), pr(4, "closes AC-e", ["apps/ios/App.swift"])], "web", ["apps/web"]);
    check("with --paths, a bare mention counts when the PR touched the prefix, and not when it did not", JSON.stringify(r.ids) === '["AC-d"]', JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(5, "closes AC-f", ["apps/webb/x.ts"])], "web", ["apps/web"]);
    check("a prefix matches a path segment, not a string prefix (apps/webb is not apps/web)", !r.ids.includes("AC-f"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(6, "AC-g@web", ["apps/ios/x.swift"])], "web", ["apps/web"]);
    check("an explicit @web counts even when the PR touched no web path", r.ids.includes("AC-g"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(7, "AC-h@android-tv")], "android", []);
    check("an unknown suffix marks nothing", r.ids[0] === undefined, JSON.stringify(r));
    check("and is reported with its PR number", r.warnings.find((w) => /#7/.test(w) && /android-tv/.test(w)) !== undefined, JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(8, "AC-i@web"), pr(9, "AC-i@web and AC-j@web")], "web", []);
    check("ids are deduplicated across PRs, in first-seen order", JSON.stringify(r.ids) === JSON.stringify(["AC-i", "AC-j"]), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(10, "nothing here")], "web", []);
    check("a PR without mentions contributes nothing", r.ids[0] === undefined && r.warnings[0] === undefined, JSON.stringify(r));
  }

  // --- runLive -------------------------------------------------------------------
  const env = { ARKAIK_TOKEN: "ark_test_token" };
  const logs = () => { const out = []; return { out, log: (m) => out.push(m), errorLog: (m) => out.push(`ERR ${m}`) }; };

  {
    const cwd = linkedDir();
    const mentions = path.join(cwd, "mentions.json");
    writeFileSync(mentions, JSON.stringify([pr(1, "AC-a@web", ["apps/web/x.ts"]), pr(2, "AC-b", ["apps/web/y.ts"])]));
    const http = makeMockHttpClient(() => jsonResponse(200, {
      version: "3",
      applied: [{ node_id: "AC-a", platform: "web", from: "releasing", to: "live" }],
      skipped: [{ index: 1, node_id: "AC-b", platform: "web", reason: "already_live" }],
      events: [],
    }));
    const l = logs();
    const result = await runLive(["--platform", "web", "--mentions", mentions, "--paths", "apps/web", "--detail", "https://pbbls.app"], { cwd, env, httpClient: http, ...l });
    check("a derived batch posts and succeeds", result.ok === true, () => l.out.join("\n"));
    const call = http.calls[0];
    check("to the project's live route with the bearer token", call && /\/api\/graph\/projects\/prj_test\/live$/.test(call.url) && call.init.headers.authorization === "Bearer ark_test_token", JSON.stringify(call?.url));
    const sent = call ? JSON.parse(call.init.body) : null;
    check("the body carries one entry per id with the platform and detail", sent?.entries?.length === 2 && sent.entries.find((e) => e.node_id === "AC-a" && e.platform === "web" && e.detail === "https://pbbls.app") !== undefined && sent?.entries?.find((e) => e.node_id === "AC-b") !== undefined, JSON.stringify(sent));
    check("applied and skipped are printed", l.out.find((m) => /AC-a.*releasing.*live/.test(m)) !== undefined && l.out.find((m) => /AC-b.*already live/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "3", applied: [{ node_id: "AC-z", platform: "ios", from: "releasing", to: "live" }], skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "ios", "AC-z"], { cwd, env, httpClient: http, ...l });
    check("positional ids post without a mentions file", result.ok === true && JSON.parse(http.calls[0].init.body).entries[0].node_id === "AC-z", () => l.out.join("\n"));
    check("and no detail key is sent when none was given", !("detail" in JSON.parse(http.calls[0].init.body).entries[0]), http.calls[0].init.body);
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, {}));
    const l = logs();
    const result = await runLive(["--platform", "web", "--dry-run", "AC-q"], { cwd, env: {}, httpClient: http, ...l });
    check("--dry-run prints the entries, sends nothing, and needs no token", result.ok === true && http.calls[0] === undefined && l.out.find((m) => /AC-q/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const mentions = path.join(cwd, "mentions.json");
    writeFileSync(mentions, JSON.stringify([pr(1, "no acceptances")]));
    const http = makeMockHttpClient(() => jsonResponse(200, {}));
    const l = logs();
    const result = await runLive(["--platform", "web", "--mentions", mentions], { cwd, env, httpClient: http, ...l });
    check("nothing to mark is a success that sends nothing", result.ok === true && http.calls[0] === undefined && l.out.find((m) => /[Nn]othing to mark/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(422, { error: "refused", refusals: [{ index: 0, node_id: "AC-r", platform: "web", reason: "platform_not_applicable", detail: "AC-r lists: ios" }] }));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-r"], { cwd, env, httpClient: http, ...l });
    check("a refusal fails the command", result.ok === false, () => l.out.join("\n"));
    check("and prints each refusal with its reason and detail", l.out.find((m) => /AC-r.*platform_not_applicable.*lists: ios/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(403, { error: "insufficient_scope", required: "graph:write" }));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-s"], { cwd, env, httpClient: http, ...l });
    check("a 403 fails and names release:append", result.ok === false && l.out.find((m) => /release:append/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const ids = Array.from({ length: 51 }, (_, i) => `AC-n${i}`);
    const http = makeMockHttpClient((url, init) => jsonResponse(200, { version: "9", applied: JSON.parse(init.body).entries.map((e) => ({ ...e, from: "releasing", to: "live" })), skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "web", ...ids], { cwd, env, httpClient: http, ...l });
    const second = http.calls[1] ? JSON.parse(http.calls[1].init.body).entries : [];
    check("51 ids go in two requests of at most 50", result.ok === true && http.calls[1] !== undefined && http.calls[2] === undefined && JSON.parse(http.calls[0].init.body).entries.length === 50, () => `${http.calls.length} calls`);
    check("and the second request carries exactly the 51st id", second.length === 1 && second[0].node_id === "AC-n50", JSON.stringify(second));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const mentions = path.join(cwd, "mentions.json");
    writeFileSync(mentions, JSON.stringify([pr(1, "AC-p@web and AC-q@web")]));
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "3", applied: [], skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "web", "--mentions", mentions, "AC-p"], { cwd, env, httpClient: http, ...l });
    const sentIds = http.calls[0] ? JSON.parse(http.calls[0].init.body).entries.map((e) => e.node_id) : null;
    check("positional and derived ids merge, deduped, positional first", result.ok === true && JSON.stringify(sentIds) === '["AC-p","AC-q"]', JSON.stringify(sentIds));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const ids = Array.from({ length: 51 }, (_, i) => `AC-n${i}`);
    const http = makeMockHttpClient((url, init, n) => n === 1
      ? jsonResponse(200, { version: "9", applied: JSON.parse(init.body).entries.map((e) => ({ ...e, from: "releasing", to: "live" })), skipped: [], events: [] })
      : jsonResponse(422, { error: "refused", refusals: [{ index: 0, node_id: "AC-n50", platform: "web", reason: "unknown_node" }] }));
    const l = logs();
    const result = await runLive(["--platform", "web", ...ids], { cwd, env, httpClient: http, ...l });
    const header = l.out.find((m) => /Refused/.test(m)) ?? "";
    check("a refusal on a later chunk fails the command", result.ok === false, () => l.out.join("\n"));
    check("and indexes the refusal into the whole batch (entries[50])", l.out.find((m) => /entries\[50\].*AC-n50.*unknown_node/.test(m)) !== undefined, () => l.out.join("\n"));
    check("and its header says the first 50 were applied, not that nothing was written", !/nothing was written/.test(header) && /50 before them were applied/.test(header), header);
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(400, { error: "invalid_entries", message: "entries[0].detail must be a non-empty string when present" }));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-t"], { cwd, env, httpClient: http, ...l });
    check("a 400 fails and prints the door's message", result.ok === false && l.out.find((m) => /entries\[0\]\.detail must be a non-empty string when present/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "3", applied: [], skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "web", "--detail", "", "AC-u"], { cwd, env, httpClient: http, ...l });
    const entry = http.calls[0] ? JSON.parse(http.calls[0].init.body).entries[0] : null;
    check("an empty --detail is treated as absent", result.ok === true && entry !== null && !("detail" in entry), JSON.stringify(entry));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, {}));
    const l = logs();
    const result = await runLive(["--platform", "web", "web"], { cwd, env, httpClient: http, ...l });
    check("a positional that is not an AC- id fails before any request, naming it", result.ok === false && http.calls[0] === undefined && l.out.find((m) => /"web"/.test(m) && /start with AC-/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "arkaik-live-unlinked-"));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-a"], { cwd, env, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), ...l });
    check("an unlinked repo fails and says to run arkaik link", result.ok === false && l.out.find((m) => /arkaik link/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-a"], { cwd, env: {}, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), ...l });
    check("a missing token fails and names ARKAIK_TOKEN", result.ok === false && l.out.find((m) => /ARKAIK_TOKEN/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }

  // --- argv through the built CLI --------------------------------------------------
  // An empty cwd and no token, for the reason tests/cli/push.test.js gives at CLI_CWD:
  // the repo root holds a REAL docs/arkaik/arkaik.json, so a spawn there could reach a live project.
  const CLI_CWD = mkdtempSync(path.join(tmpdir(), "arkaik-live-cli-"));
  const cliEnv = { ...process.env };
  delete cliEnv.ARKAIK_TOKEN;
  delete cliEnv.ARKAIK_URL;
  const spawnOpts = { encoding: "utf8", cwd: CLI_CWD, env: cliEnv };
  {
    const r = spawnSync(process.execPath, [CLI, "live", "--help"], spawnOpts);
    check("live --help prints usage and exits 0", r.status === 0 && /arkaik live/.test(r.stdout), r.stderr);
  }
  {
    const r = spawnSync(process.execPath, [CLI, "live", "AC-a"], spawnOpts);
    check("live without --platform exits 1 and says so", r.status === 1 && /--platform/.test(r.stderr), r.stderr);
  }
  {
    const r = spawnSync(process.execPath, [CLI, "live", "--platform", "windows", "AC-a"], spawnOpts);
    check("an unknown platform exits 1 naming the valid ones", r.status === 1 && /web, ios, android/.test(r.stderr), r.stderr);
  }

  rmSync(CLI_CWD, { recursive: true, force: true });
  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log("\nAll live CLI checks passed.");
}

main().catch((err) => { console.error(err); process.exit(1); });

#!/usr/bin/env node

/**
 * Exercises `arkaik pack` + `arkaik open` (issue #223).
 *
 * Two layers, mirroring tests/cli/sync.test.js:
 *  - `runPack()`/`runOpen()` exercised in-process: packages/cli/src/commands/
 *    {pack,open}.ts are esbuild-bundled (same technique build.js uses for the
 *    real CLI, just to a throwaway `.test-build/` dir) into importable ESM
 *    modules, so a mock `opener` seam can be injected straight into `runOpen`
 *    — no subprocess, no real browser launch, ever.
 *  - the built CLI binary (packages/cli/dist/index.js) spawned for the
 *    argv-parsing / exit-code / --help contract. The one CLI-level `open` case
 *    without `--no-open` uses a deliberately INVALID bundle: `runOpen`
 *    validates before ever touching the opener seam, so that path can never
 *    reach the real browser-launch code even unmocked.
 *
 * Covers:
 *  - pack embeds the sidecar journal by default; output is canonical
 *    (matches serializeBundle), parses, and passes validateBundle;
 *  - pack --no-journal omits journal[] entirely;
 *  - pack --inline-assets turns a local relative-path screenshot into a
 *    data: URI (byte-for-byte base64 of the file on disk) while leaving an
 *    https:// URL untouched; without the flag, screenshots are untouched;
 *  - an unknown top-level key and an unknown node field both survive packing
 *    (the bundle-format.md:40 defect this command must not repeat);
 *  - open on an INVALID bundle: ok, valid:false, reports findings, never sets
 *    outPath, never calls the opener;
 *  - open on a VALID bundle with --no-open: writes the packed file, reports
 *    the arkaik.app URL, opener seam NOT called;
 *  - open on a VALID bundle without --no-open: the injected opener IS called
 *    with the URL;
 *  - open --out writes the packed bundle to the given path instead of a temp
 *    file.
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
} = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const PACK_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "pack.ts");
const OPEN_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "open.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build");
const PACK_BUNDLE = path.join(TEST_BUILD_DIR, "pack.mjs");
const OPEN_BUNDLE = path.join(TEST_BUILD_DIR, "open.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

const { serializeBundle, validateBundle } = require("../schema/load-schema").loadSchema();

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
// Fixture: one node with a relative-path screenshot and an https one, a
// snapshot<->journal-consistent sidecar, and a real asset file on disk.
// ---------------------------------------------------------------------------
function makeBundle() {
  return {
    schema_version: 1,
    project: {
      id: "demo",
      title: "Demo",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    },
    nodes: [
      {
        id: "V-home",
        project_id: "demo",
        species: "view",
        title: "Home",
        status: "live",
        platforms: ["web", "ios"],
        metadata: {
          platformScreenshots: {
            web: "assets/home.png",
            ios: "https://cdn.example.com/home-ios.png",
          },
        },
      },
    ],
    edges: [],
  };
}

const JOURNAL_LINES = [
  { id: "01J9ZK4E4N0000000000000001", ts: "2026-01-01T00:00:00.000Z", actor: "claude-code", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
  { id: "01J9ZK4E4N0000000000000002", ts: "2026-01-02T00:00:00.000Z", actor: "claude-code", type: "node.status_changed", node_id: "V-home", from: "idea", to: "development" },
  { id: "01J9ZK4E4N0000000000000003", ts: "2026-01-03T00:00:00.000Z", actor: "claude-code", type: "node.status_changed", node_id: "V-home", from: "development", to: "live" },
];
const JOURNAL = JOURNAL_LINES.map((e) => JSON.stringify(e)).join("\n") + "\n";
const ASSET_BYTES = Buffer.from("FAKE-PNG-BYTES");

const createdDirs = [];

/** Fresh temp dir with bundle.json + journal.jsonl + assets/home.png. */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-pack-"));
  createdDirs.push(dir);
  const bundlePath = path.join(dir, "bundle.json");
  const journalPath = path.join(dir, "journal.jsonl");
  const bundle = makeBundle();
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(journalPath, JOURNAL);
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(path.join(dir, "assets", "home.png"), ASSET_BYTES);
  return { dir, bundlePath, journalPath, originalBundle: bundle };
}

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await Promise.all([
    build({
      entryPoints: [PACK_ENTRY],
      outfile: PACK_BUNDLE,
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      legalComments: "none",
    }),
    build({
      entryPoints: [OPEN_ENTRY],
      outfile: OPEN_BUNDLE,
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      legalComments: "none",
    }),
  ]);
  const { runPack } = await import(pathToFileURL(PACK_BUNDLE).href);
  const { runOpen, OPEN_URL } = await import(pathToFileURL(OPEN_BUNDLE).href);

  // -------------------------------------------------------------------------
  // pack: embeds the sidecar journal by default; canonical + parses + valid.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const result = runPack({ path: bundlePath });

    check("runPack ok", result.ok === true, JSON.stringify(result));
    check(
      "journal embedded by default (3 sidecar events)",
      result.journalIncluded === true && result.journalEventCount === 3,
      JSON.stringify(result),
    );

    const parsed = JSON.parse(result.output);
    check("packed output is canonical (matches serializeBundle)", serializeBundle(parsed) === result.output);
    check(
      "packed output embeds journal[] with all 3 sidecar events",
      Array.isArray(parsed.journal) && parsed.journal.length === 3,
      JSON.stringify(parsed.journal),
    );
    const validation = validateBundle(parsed);
    check("packed output passes validateBundle", validation.valid, JSON.stringify(validation.errors));
    check("no --out given: result.outPath is unset", result.outPath === undefined);
  }

  // -------------------------------------------------------------------------
  // pack --no-journal: omits journal[] entirely.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const result = runPack({ path: bundlePath, noJournal: true });

    check("runPack --no-journal ok", result.ok === true);
    check("journalIncluded is false", result.journalIncluded === false);
    const parsed = JSON.parse(result.output);
    check("no journal key in the output at all", parsed.journal === undefined, JSON.stringify(Object.keys(parsed)));
  }

  // -------------------------------------------------------------------------
  // pack --inline-assets: local relative path -> data: URI; https:// untouched.
  // Without the flag, assets are left exactly as-is.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, originalBundle } = fixture();

    const inlined = runPack({ path: bundlePath, inlineAssets: true });
    check("runPack --inline-assets ok", inlined.ok === true);
    const parsedInlined = JSON.parse(inlined.output);
    const shots = parsedInlined.nodes[0].metadata.platformScreenshots;
    const expectedDataUri = `data:image/png;base64,${ASSET_BYTES.toString("base64")}`;
    check(
      "relative-path screenshot became a byte-accurate data: URI",
      shots.web === expectedDataUri,
      shots.web,
    );
    check("https:// screenshot left untouched", shots.ios === "https://cdn.example.com/home-ios.png");
    check(
      "reports the inlined asset",
      inlined.inlinedAssets.some((a) => a.nodeId === "V-home" && a.platform === "web" && a.path === "assets/home.png"),
      JSON.stringify(inlined.inlinedAssets),
    );

    const plain = runPack({ path: bundlePath });
    const parsedPlain = JSON.parse(plain.output);
    const plainShots = parsedPlain.nodes[0].metadata.platformScreenshots;
    const originalShots = originalBundle.nodes[0].metadata.platformScreenshots;
    check(
      "without --inline-assets, screenshots are left exactly as-is (by value — canonicalization reorders keys, not values)",
      plainShots.web === originalShots.web && plainShots.ios === originalShots.ios,
      JSON.stringify(plainShots),
    );
    check("without --inline-assets, nothing reported as inlined", plain.inlinedAssets.length === 0);
  }

  // -------------------------------------------------------------------------
  // Unknown top-level key + unknown node field survive packing (never
  // reconstructed as {project,nodes,edges} — bundle-format.md:40's defect).
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();
    const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
    raw.custom_top_level = { z: 1, a: 2 };
    raw.nodes[0].custom_node_field = "kept";
    writeFileSync(bundlePath, JSON.stringify(raw, null, 2) + "\n");

    const result = runPack({ path: bundlePath });
    const parsed = JSON.parse(result.output);
    check(
      "unknown top-level key survives packing",
      parsed.custom_top_level && parsed.custom_top_level.a === 2 && parsed.custom_top_level.z === 1,
      JSON.stringify(parsed.custom_top_level),
    );
    check("unknown node field survives packing", parsed.nodes[0].custom_node_field === "kept");
  }

  // -------------------------------------------------------------------------
  // open on an INVALID bundle: findings reported, never packs/writes/opens.
  // -------------------------------------------------------------------------
  {
    const invalidPath = path.join(FIXTURES, "duplicate-node-id.json");
    const openerCalls = [];
    const opener = async (url) => openerCalls.push(url);

    const result = await runOpen({ path: invalidPath, opener });

    check("runOpen ok (validation itself ran without a fatal error)", result.ok === true, JSON.stringify(result));
    check("runOpen reports the bundle invalid", result.valid === false);
    check("runOpen reports at least one error finding", result.errorLines.length > 0, JSON.stringify(result.errorLines));
    check("runOpen does not set outPath for an invalid bundle", result.outPath === undefined);
    check("runOpen does not call the opener for an invalid bundle", openerCalls.length === 0, JSON.stringify(openerCalls));
    check("runOpen reports opened:false for an invalid bundle", result.opened === false);
  }

  // -------------------------------------------------------------------------
  // open on a VALID bundle: --no-open writes the packed file + reports the
  // URL without calling the opener; without --no-open the seam IS called.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();

    const openerCallsA = [];
    const openerA = async (url) => openerCallsA.push(url);
    const noOpenResult = await runOpen({ path: bundlePath, noOpen: true, opener: openerA });

    check("runOpen (valid, --no-open) ok", noOpenResult.ok === true, JSON.stringify(noOpenResult));
    check("runOpen (valid, --no-open) reports valid:true", noOpenResult.valid === true);
    check("--no-open: opener seam NOT called", openerCallsA.length === 0, JSON.stringify(openerCallsA));
    check("--no-open: opened flag is false", noOpenResult.opened === false);
    check(
      "--no-open: packed file was written to disk",
      typeof noOpenResult.outPath === "string" && existsSync(noOpenResult.outPath),
      JSON.stringify(noOpenResult),
    );
    check("--no-open: reports the arkaik.app URL", noOpenResult.url === OPEN_URL, noOpenResult.url);
    const packed = JSON.parse(readFileSync(noOpenResult.outPath, "utf8"));
    check("the packed handoff file itself passes validateBundle", validateBundle(packed).valid, JSON.stringify(validateBundle(packed).errors));

    const openerCallsB = [];
    const openerB = async (url) => openerCallsB.push(url);
    const openResult = await runOpen({ path: bundlePath, opener: openerB });

    check(
      "without --no-open: the injected opener IS called, with the URL",
      openerCallsB.length === 1 && openerCallsB[0] === OPEN_URL,
      JSON.stringify(openerCallsB),
    );
    check("without --no-open: opened flag is true", openResult.opened === true);
  }

  // -------------------------------------------------------------------------
  // open --out writes the packed bundle to the given path.
  // -------------------------------------------------------------------------
  {
    const { bundlePath, dir } = fixture();
    const outPath = path.join(dir, "handoff.json");
    const opener = async () => {};

    const result = await runOpen({ path: bundlePath, out: outPath, noOpen: true, opener });
    check("open --out writes to the given path", result.outPath === outPath, JSON.stringify(result));
    check("the file exists at --out", existsSync(outPath));
  }

  // -------------------------------------------------------------------------
  // CLI-level: argv parsing / exit codes / --help, spawned. The one `open`
  // case run WITHOUT --no-open here uses a deliberately invalid bundle, so it
  // can never reach the real (unmocked) browser-launch code either.
  // -------------------------------------------------------------------------
  {
    const { bundlePath } = fixture();

    const packHelp = runCli(["pack", "--help"]);
    check("pack --help exits 0", packHelp.status === 0 && /arkaik pack/.test(packHelp.stdout), packHelp.stdout);

    const openHelp = runCli(["open", "--help"]);
    check("open --help exits 0", openHelp.status === 0 && /arkaik open/.test(openHelp.stdout), openHelp.stdout);

    const packBadFlag = runCli(["pack", "--nope", bundlePath]);
    check("pack with an unknown flag exits 1", packBadFlag.status === 1);

    const openBadFlag = runCli(["open", "--nope", bundlePath]);
    check("open with an unknown flag exits 1", openBadFlag.status === 1);

    const packStdout = runCli(["pack", bundlePath]);
    check("pack via CLI (no --out) exits 0", packStdout.status === 0, `${packStdout.stdout}\n${packStdout.stderr}`);
    const parsedStdout = JSON.parse(packStdout.stdout);
    check(
      "pack via CLI prints the canonical bundle (with embedded journal) to stdout",
      Array.isArray(parsedStdout.journal) && parsedStdout.journal.length === 3,
      packStdout.stdout,
    );

    const openNoOpenCli = runCli(["open", "--no-open", bundlePath]);
    check(
      "open --no-open via CLI exits 0 (real opener never invoked)",
      openNoOpenCli.status === 0,
      `${openNoOpenCli.stdout}\n${openNoOpenCli.stderr}`,
    );
    check("open --no-open via CLI reports the packed path", /Packed ->/.test(openNoOpenCli.stdout), openNoOpenCli.stdout);

    // No --no-open here — safe only because the bundle is invalid, so runOpen
    // returns before ever touching the opener (verified above, in-process).
    const invalidCli = runCli(["open", path.join(FIXTURES, "duplicate-node-id.json")]);
    check(
      "open on an invalid bundle via CLI (no --no-open) exits 1 without opening a browser",
      invalidCli.status === 1,
      `${invalidCli.stdout}\n${invalidCli.stderr}`,
    );
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

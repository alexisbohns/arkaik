#!/usr/bin/env node

/**
 * Exercises the lane-2 bundle writer (issue #389): `docs/quality/` sidecars
 * folded into a bundle's `quality` section at assembly time.
 *
 * Drives the BUILT CLI in mkdtemp repos, never the repo itself — the same
 * reasoning as tests/cli/kritik.test.js, and the only option available:
 * packages/schema/src/cli/* is not reachable from tests/schema/load-schema.js
 * (which transpiles only src/*.ts and returns index.ts's exports).
 *
 * THE POINT OF THE TWO-AUDIT FIXTURE. With a single audit, a "merge"
 * implemented as plain concatenation and one implemented as "newest audit
 * only" both pass every assertion. So 2026-09 re-scores a cell 2026-08
 * already scored (newer must win, and the row must not be duplicated), adds
 * a cell 2026-08 never had, and leaves 2026-08's finding untouched (it must
 * still be present). Each of the three plausible wrong implementations fails
 * at least one assertion below.
 *
 * THE POINT OF THE VENDORED PACK. Its grade bands and severity buckets are
 * deliberately NOT the schema defaults (A:97 not 85; critical [21,25] not
 * [20,25]) and its weights are 3/1/2, so an assertion on the embedded
 * library can tell "embedded the project's effective pack" from "embedded
 * whatever the CLI shipped with". Phase D lost this distinction for two
 * phases; do not normalize these numbers.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const PACK_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "pack.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-quality");
const PACK_BUNDLE = path.join(TEST_BUILD_DIR, "pack.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
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

// --- the fixture repo ------------------------------------------------------

const BUNDLE = {
  schema_version: 3,
  project: {
    id: "demo",
    title: "Demo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  nodes: [
    { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
  ],
  edges: [],
};

/** Non-default scales and weights on purpose — see the header. */
const PACK = {
  name: "test-pack",
  version: "9.9.9",
  domains: [
    { code: "SEC", name: "Security" },
    { code: "TST", name: "Testing" },
  ],
  criteria: [
    { id: "SEC-01", domain: "SEC", name: "Secrets", weight: 3, question: "Are secrets kept out of the repo?" },
    { id: "SEC-02", domain: "SEC", name: "Authorization", weight: 1 },
    { id: "TST-01", domain: "TST", name: "Unit tests", weight: 2 },
  ],
  scales: {
    grades: { A: 97, B: 88, C: 71, D: 52, E: 0 },
    severity_buckets: { critical: [21, 25], high: [13, 20], medium: [7, 12], low: [3, 6], info: [1, 2] },
    caps: { critical_open: "D", high_open: "C" },
  },
};

const OVERLAY = {
  extends: "9.9.9",
  criteria: [{ id: "SEC-99", domain: "SEC", name: "Project-specific control", weight: 2 }],
};

const PROFILE = {
  surfaces: [
    { id: "web", title: "Web app", platform: "web" },
    { id: "admin", title: "Admin console" },
  ],
  domain_weights: { SEC: 2, TST: 1 },
};

// 9.9.8, where 2026-09 carries 9.9.9: without the difference the
// framework_version assertion below passes against newest-wins,
// oldest-wins and any-wins alike, and so tests nothing.
const SCORES_08 = {
  audit_id: "2026-08",
  commit: "aaaaaaa",
  framework_version: "9.9.8",
  assessments: [
    { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "app/a.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-02", surface: "web", level: 4, evidence: "app/b.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "TST-01", surface: "web", level: 1, evidence: "app/c.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-01", surface: "admin", level: 3, evidence: "app/d.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
  ],
};

// severity/priority are STORED here on purpose: the real sidecars carry them
// and the fold must drop them.
const FINDINGS_08 = {
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
      source_cell: "SEC-01/web",
    },
  ],
};

const SCORES_09 = {
  audit_id: "2026-09",
  commit: "bbbbbbb",
  framework_version: "9.9.9",
  assessments: [
    // Re-scores a 2026-08 cell: 2 -> 4. Newer must win, and the row must not double.
    { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "app/a.ts:9", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
    // A cell 2026-08 never scored.
    { criterion_id: "TST-01", surface: "admin", level: 2, evidence: "app/e.ts:1", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
  ],
};

const FINDINGS_09 = {
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
};

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * A repo with a bundle and, unless told otherwise, a vendored pack, an
 * overlay, a profile and two audits.
 *
 * `pack: false` keeps the audits and the profile but omits the vendored
 * `library.json` — the only way to reach "no criteria pack anywhere", since
 * the in-process layer's esbuild output has no reachable bundled pack either.
 */
function makeRepo(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-"));
  writeJson(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  if (options.profile !== false) writeJson(path.join(dir, "docs", "quality", "profile.json"), PROFILE);
  if (options.audits !== false) {
    if (options.pack !== false) writeJson(path.join(dir, "docs", "quality", "library.json"), PACK);
    writeJson(path.join(dir, "docs", "quality", "criteria.custom.json"), OVERLAY);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "scores.json"), SCORES_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "findings.json"), FINDINGS_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "scores.json"), SCORES_09);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "findings.json"), FINDINGS_09);
  }
  return dir;
}

const runIn = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: dir });

/** `arkaik pack` writes the bundle to stdout and its notices to stderr. */
function packIn(dir, args = []) {
  const result = runIn(dir, ["pack", ...args]);
  let bundle;
  try {
    bundle = JSON.parse(result.stdout);
  } catch {
    bundle = undefined;
  }
  return { result, bundle };
}

// --- 1. the merge ----------------------------------------------------------

{
  const dir = makeRepo();
  const { result, bundle } = packIn(dir);

  check("pack exits 0 on a repo with audits", result.status === 0, `${result.stdout.slice(0, 200)}\n${result.stderr}`);
  check("pack emits a quality section", bundle !== undefined && bundle.quality !== undefined, result.stderr);

  const section = (bundle && bundle.quality) || {};
  const assessments = section.assessments || [];
  const findings = section.findings || [];

  // 5 distinct cells across the two audits. Concatenation gives 6; newest-only gives 2.
  check("merge keeps one row per (criterion x surface)", assessments.length === 5, `got ${assessments.length}`);

  const cell = (criterionId, surface) =>
    assessments.filter((a) => a.criterion_id === criterionId && a.surface === surface);

  check("the re-scored cell appears exactly once", cell("SEC-01", "web").length === 1, JSON.stringify(cell("SEC-01", "web")));
  check(
    "the newer audit wins on the overlap (level 4, not 2)",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].level === 4,
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "the newer audit's row carries its own audit_id",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].audit_id === "2026-09",
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "a cell only the older audit scored survives",
    cell("SEC-02", "web")[0] && cell("SEC-02", "web")[0].level === 4,
    JSON.stringify(cell("SEC-02", "web")),
  );
  check(
    "a cell only the newer audit scored is present",
    cell("TST-01", "admin")[0] && cell("TST-01", "admin")[0].level === 2,
    JSON.stringify(cell("TST-01", "admin")),
  );

  // Findings pool across audits — newest-only would drop the 2026-08 one.
  check("findings pool across every audit", findings.length === 2, `got ${findings.length}`);
  check(
    "a finding from the older audit is still present",
    findings.some((f) => f.id === "F-2026-08-SEC-web-01"),
    JSON.stringify(findings.map((f) => f.id)),
  );

  // --- 2. derived fields stripped, everything else kept ---
  check(
    "no folded finding stores a derived severity",
    findings.every((f) => !("severity" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  check(
    "no folded finding stores a derived priority",
    findings.every((f) => !("priority" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  const stripped = findings.find((f) => f.id === "F-2026-08-SEC-web-01");
  check("the numbers severity is derived FROM survive", stripped && stripped.impact === 5 && stripped.likelihood === 4);
  check("an unknown finding key survives the strip", stripped && stripped.source_cell === "SEC-01/web");

  // --- 3. the rest of the section ---
  check("framework_version comes from the newest audit", section.framework_version === "9.9.9", section.framework_version);
  check(
    "the profile is carried verbatim",
    section.profile &&
      Array.isArray(section.profile.surfaces) &&
      section.profile.surfaces.length === 2 &&
      section.profile.surfaces[0].id === "web" &&
      section.profile.domain_weights &&
      section.profile.domain_weights.SEC === 2 &&
      section.profile.domain_weights.TST === 1,
    JSON.stringify(section.profile),
  );

  // Provenance: the section must embed the pack the scores were TAKEN
  // against, not whichever one the CLI happens to ship, or a reader grades a
  // 97-is-an-A project against an 85-is-an-A scale and calls it a promotion.
  check(
    "the section embeds the project's effective pack, not the shipped one",
    section.library && section.library.scales.grades.A === 97,
    JSON.stringify(section.library && section.library.scales),
  );
  check(
    "the overlay is merged into the embedded library",
    ((section.library && section.library.criteria) || []).some((c) => c.id === "SEC-99"),
    JSON.stringify(((section.library && section.library.criteria) || []).map((c) => c.id)),
  );
  check("the notice names what was folded", /Quality: folded 5 assessment\(s\), 2 finding\(s\) from 2 audit\(s\)/.test(result.stderr), result.stderr);

  // --- 4. the bundle file on disk is NEVER rewritten ---
  const onDisk = require(path.join(dir, "docs", "arkaik", "bundle.json"));
  check("pack does not write quality into the source bundle", onDisk.quality === undefined);
}

// --- 5. `arkaik open` folds too --------------------------------------------

// The two verbs that wrap `runPack` take OPPOSITE postures, and neither may
// be left to whatever `runPack` happens to default to. `push` sends bytes to
// a server and must not carry open findings (push.ts pins that with
// `noQuality: true`); `open` writes a file for the app's own import picker,
// which is precisely where the section is meant to ride along.
{
  const dir = makeRepo();
  const out = path.join(dir, "opened.json");
  const result = runIn(dir, ["open", "--no-open", "--out", out]);

  check("open exits 0 on the fixture repo", result.status === 0, `${result.stdout}\n${result.stderr}`);
  const opened = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;
  check(
    "open hands the app a bundle with the quality section folded in",
    opened && opened.quality && opened.quality.assessments.length === 5,
    JSON.stringify(opened && opened.quality && opened.quality.assessments.length),
  );
}

// --- 6. the root follows the bundle, not the cwd ---------------------------

// Every other input to a pack comes from the bundle's own path: the journal
// is read as its sibling, assets resolve against its directory. Quality
// rooted at the cwd instead meant `cd /elsewhere && arkaik pack
// /repo/docs/arkaik/bundle.json` folded /elsewhere's audits into /repo's
// bundle — here, /elsewhere has none, so the section silently vanished.
{
  const dir = makeRepo();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-cwd-"));
  const { result, bundle } = packIn(elsewhere, [path.join(dir, "docs", "arkaik", "bundle.json")]);

  check("pack from an unrelated cwd exits 0", result.status === 0, result.stderr);
  check(
    "the fold follows the bundle's own repo, not the cwd",
    bundle && bundle.quality && bundle.quality.assessments.length === 5,
    result.stderr,
  );
}

// --- 7. nothing to fold is a notice, never a failure -----------------------

// A repo mid-installation still packs. Each notice names a path AND a way
// forward, because "no audit yet" and "wrong root" are the two ways to land
// here and only the path tells them apart.
//
// What these cases do NOT pin, and cannot: that `foldQualitySection` returns
// on an empty audit list BEFORE resolving the pack. That ordering is real and
// load-bearing — resolving first would make a repo with no quality data at all
// fail `arkaik pack` whenever the bundled pack is missing or broken — but a
// spawned CLI always ships a pack for `resolvePack` to find, so both orderings
// pass here. Do not "simplify" the function by reordering those two.
{
  const bare = makeRepo({ audits: false, profile: false });
  const { result } = packIn(bare, []);
  check(
    "a repo with no audits packs anyway, naming the directory it looked in",
    result.status === 0 && result.stderr.includes(path.join("docs", "quality", "audits")),
    result.stderr,
  );
  check(
    "and the notice says what to do about it",
    /arkaik kritik score/.test(result.stderr),
    result.stderr,
  );

  const noProfile = makeRepo({ profile: false });
  const skipped = packIn(noProfile, []).result;
  check(
    "audits but no profile is skipped, not failed, and points at the fix",
    skipped.status === 0 && /no profile at .*profile\.json.*arkaik kritik profile/.test(skipped.stderr),
    skipped.stderr,
  );

  // `false` is valid JSON and falsy. A `=== null` guard in the CLI seam waves
  // it through, the merge's own `!profile` guard refuses it, and the notice
  // then blames the audits directory for a profile problem — the exact
  // misattribution the notices were rewritten to prevent.
  const falsyProfile = makeRepo();
  writeJson(path.join(falsyProfile, "docs", "quality", "profile.json"), false);
  const falsy = packIn(falsyProfile, []).result;
  check(
    "a falsy-but-valid profile.json is named as the profile, not as missing audits",
    falsy.status === 0 && /no profile at .*profile\.json/.test(falsy.stderr),
    falsy.stderr,
  );
}

// --- 8. a corrupt sidecar names the file it could not parse ----------------

{
  const dir = makeRepo();
  writeFileSync(path.join(dir, "docs", "quality", "audits", "2026-08", "scores.json"), "nope\n");
  const { result } = packIn(dir, []);

  check("a corrupt sidecar fails the pack", result.status === 1, `${result.status}`);
  check(
    "and the FATAL names the file, not just the byte",
    result.stderr.includes(path.join("audits", "2026-08", "scores.json")) && result.stderr.includes("not valid JSON"),
    result.stderr,
  );
}

// --- 9. the argv contract --------------------------------------------------

// `runPack` has honoured these three options since the fold landed; what is
// tested here is only that the flags reach them. The semantics live in
// section 10, in process — no point spawning a CLI twice for the same fact.
{
  const dir = makeRepo();

  // --no-quality: the section is absent, nothing is announced, and NOTHING
  // ELSE moves. The last clause is why this compares whole bundles rather
  // than checking for the key: a strip that also dropped, reordered or
  // re-encoded another top-level key would pass a key check.
  const plain = packIn(dir, []);
  const stripped = packIn(dir, ["--no-quality"]);
  check("--no-quality exits 0", stripped.result.status === 0, stripped.result.stderr);
  check("--no-quality emits no quality section", stripped.bundle && stripped.bundle.quality === undefined, JSON.stringify(stripped.bundle && Object.keys(stripped.bundle)));
  check("--no-quality says nothing about a fold it never ran", !/^Quality:/m.test(stripped.result.stderr), stripped.result.stderr);
  const plainMinusQuality = { ...(plain.bundle || {}) };
  delete plainMinusQuality.quality;
  check(
    "--no-quality changes nothing but that key",
    JSON.stringify(plainMinusQuality) === JSON.stringify(stripped.bundle),
    `${JSON.stringify(Object.keys(plainMinusQuality))}\n${JSON.stringify(stripped.bundle && Object.keys(stripped.bundle))}`,
  );

  // --root: the explicit override, a different branch of resolveQualityRoot
  // from section 6's derivation. The bundle is deliberately NOT at the
  // conventional docs/arkaik/ path, so the derivation cannot find the repo
  // and only the flag can — which is what makes the control below meaningful.
  const stray = path.join(dir, "stray-bundle.json");
  writeJson(stray, BUNDLE);
  const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-root-"));
  const withoutRoot = packIn(elsewhere, [stray]);
  check(
    "a bundle outside docs/arkaik/ finds no repo on its own",
    withoutRoot.bundle && withoutRoot.bundle.quality === undefined,
    withoutRoot.result.stderr,
  );
  const withRoot = packIn(elsewhere, ["--root", dir, stray]);
  check("--root exits 0", withRoot.result.status === 0, withRoot.result.stderr);
  check(
    "--root points the fold at that repo from an unrelated cwd",
    withRoot.bundle && withRoot.bundle.quality && withRoot.bundle.quality.assessments.length === 5,
    withRoot.result.stderr,
  );

  // --audit: the older audit's own numbers, not the merge's.
  const pinned = packIn(dir, ["--audit", "2026-08"]);
  const section = (pinned.bundle && pinned.bundle.quality) || {};
  check("--audit exits 0", pinned.result.status === 0, pinned.result.stderr);
  check("--audit pins that audit's assessments", (section.assessments || []).length === 4, JSON.stringify((section.assessments || []).length));
  const rescored = (section.assessments || []).find((a) => a.criterion_id === "SEC-01" && a.surface === "web");
  check("--audit reports the pre-rescore level, where the merge reports 4", rescored && rescored.level === 2, JSON.stringify(rescored));
  check("--audit takes framework_version from that audit", section.framework_version === "9.9.8", section.framework_version);
  check("--audit counts one audit in the notice", /from 1 audit\(s\)/.test(pinned.result.stderr), pinned.result.stderr);

  const ghost = packIn(dir, ["--audit", "2026-99"]);
  check("an audit id that is not on disk exits 1", ghost.result.status === 1, `${ghost.result.status}`);
  check(
    "and the error names both the id and where it looked",
    /2026-99/.test(ghost.result.stderr) && ghost.result.stderr.includes(path.join("docs", "quality", "audits")),
    ghost.result.stderr,
  );

  const contradiction = packIn(dir, ["--no-quality", "--audit", "2026-08"]);
  check(
    "--no-quality with --audit is refused rather than silently dropping one",
    contradiction.result.status === 1 && /contradict each other/.test(contradiction.result.stderr),
    contradiction.result.stderr,
  );
  // --root is NOT part of that guard: it says where to look, which is inert
  // when nothing is looked up, and wrapper scripts set it unconditionally.
  const inert = packIn(dir, ["--no-quality", "--root", dir]);
  check(
    "--no-quality with --root is fine, because --root is inert rather than contradictory",
    inert.result.status === 0 && inert.bundle && inert.bundle.quality === undefined,
    inert.result.stderr,
  );

  // The value-taking branches, which are the easiest to get wrong and the
  // least likely to be run.
  for (const flag of ["--audit", "--root"]) {
    const missing = packIn(dir, [flag]);
    check(
      `${flag} with no value exits 1 with the usage text`,
      missing.result.status === 1 &&
        missing.result.stderr.includes(`Missing value for ${flag}`) &&
        missing.result.stderr.includes("arkaik pack ["),
      missing.result.stderr,
    );
  }
}

// --- 10. the same options in process ---------------------------------------

/**
 * The SEMANTICS of `noQuality` and `audit`, exercised against `runPack`
 * directly — pack.ts esbuild-bundled, the technique
 * tests/cli/pack-open.test.js and tests/cli/push.test.js use.
 *
 * Section 9 above covers the argv spellings that reach these; this covers
 * what they then do, plus the two cases argv cannot construct at all: a
 * source bundle that arrives already carrying a `quality` section, and the
 * `qualityFolded` / `qualityNotice` fields a caller reads instead of the
 * printed line. `arkaik push` is the shipped caller that sets `noQuality`
 * without a flag, so this layer is where its posture is provable.
 */
async function inProcess() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({
    entryPoints: [PACK_ENTRY],
    outfile: PACK_BUNDLE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    legalComments: "none",
  });
  const { runPack } = await import(pathToFileURL(PACK_BUNDLE).href);

  // noQuality STRIPS, it does not merely decline to fold. Every other fixture
  // starts from a bundle with no `quality` key, which makes an assertion that
  // the output has none pass whether the option deletes or does nothing; this
  // one hands it a section to actually get rid of. It is what `arkaik push`
  // relies on to keep open findings off the wire.
  {
    const dir = makeRepo();
    const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
    writeJson(bundlePath, {
      ...BUNDLE,
      quality: { framework_version: "9.9.9", profile: PROFILE, assessments: [], findings: FINDINGS_08.findings },
    });

    const kept = runPack({ path: bundlePath, cwd: dir });
    check("a source bundle's own quality section is there to strip", JSON.parse(kept.output).quality !== undefined);

    const stripped = runPack({ path: bundlePath, cwd: dir, noQuality: true });
    check("noQuality packs ok", stripped.ok === true, stripped.fatal);
    check(
      "noQuality deletes a quality section the SOURCE bundle carried",
      JSON.parse(stripped.output).quality === undefined,
      JSON.stringify(Object.keys(JSON.parse(stripped.output))),
    );
    check("and reports nothing about a fold it never ran", stripped.qualityNotice === undefined && stripped.qualityFolded === undefined);
  }

  // A pinned audit is a snapshot, not the merge — and it tolerates the same
  // half-finished audit the merge does. An audit opened with a finding before
  // anything on that surface was scored has no scores.json; `pack` succeeding
  // while `pack --audit <that one>` fails would say something untrue about
  // the tree.
  {
    const dir = makeRepo();
    const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");

    const pinned = runPack({ path: bundlePath, cwd: dir, audit: "2026-08" });
    const section = JSON.parse(pinned.output).quality;
    check("--audit pins one audit's snapshot", section && section.assessments.length === 4, JSON.stringify(section && section.assessments.length));
    check("the pinned audit's findings are its own", section && section.findings.length === 1 && section.findings[0].id === "F-2026-08-SEC-web-01");
    check("a pinned snapshot strips derived fields too", section && !("severity" in section.findings[0]));
    check("a pinned snapshot embeds the effective pack", section && section.library && section.library.scales.grades.A === 97);
    check("the notice counts one audit, not every audit", /from 1 audit\(s\)/.test(pinned.qualityNotice || ""), pinned.qualityNotice);
    check("qualityFolded says so without parsing prose", pinned.qualityFolded === true);

    // findings.json with no scores.json beside it.
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-10", "findings.json"), {
      audit_id: "2026-10",
      framework_version: "9.9.9",
      findings: [{ ...FINDINGS_09.findings[0], id: "F-2026-10-TST-admin-01" }],
    });
    const scoreless = runPack({ path: bundlePath, cwd: dir, audit: "2026-10" });
    check("an audit with findings but no scores.json still packs", scoreless.ok === true, scoreless.fatal);
    const sparse = scoreless.ok ? JSON.parse(scoreless.output).quality : undefined;
    check(
      "and yields its findings with no assessments, as the merge would",
      sparse && sparse.assessments.length === 0 && sparse.findings.length === 1,
      JSON.stringify(sparse && { a: sparse.assessments.length, f: sparse.findings.length }),
    );

    const ghost = runPack({ path: bundlePath, cwd: dir, audit: "2099-01" });
    check("a named audit that is not on disk is refused", ghost.ok === false && /no audit "2099-01"/.test(ghost.fatal || ""), ghost.fatal);

    // The guard runs before the it-is-fine-to-have-nothing returns.
    const bare = makeRepo({ audits: false, profile: false });
    const ghostBare = runPack({ path: path.join(bare, "docs", "arkaik", "bundle.json"), cwd: bare, audit: "2099-01" });
    check(
      "and is refused even in a repo with no audits at all",
      ghostBare.ok === false && /no audit "2099-01"/.test(ghostBare.fatal || ""),
      ghostBare.fatal,
    );
  }

  // A criteria pack that cannot be resolved is an ENVIRONMENT problem — a
  // broken install, or a vendored file nobody committed — not a statement
  // about this bundle. It must be loud and it must not be fatal, or "quality
  // is additive to a bundle" is false for the one failure mode a user cannot
  // fix from inside their repo.
  //
  // This layer is where that is reachable at all: under esbuild, `pack.ts`'s
  // BUNDLED_PACK resolves via `import.meta.url` into `.test-build-quality/
  // assets/`, which does not exist. So a fixture with no VENDORED pack has no
  // pack anywhere — the exact state the built CLI can never be asked for,
  // because it ships one.
  {
    const dir = makeRepo({ pack: false });
    const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
    const result = runPack({ path: bundlePath, cwd: dir });

    check("an unresolvable criteria pack does not fail the pack", result.ok === true, result.fatal);
    const packed = result.ok ? JSON.parse(result.output) : {};
    check("no quality section is emitted", packed.quality === undefined, JSON.stringify(Object.keys(packed)));
    check("qualityFolded reports the skip without parsing prose", result.qualityFolded === false, String(result.qualityFolded));
    check(
      "the notice names the problem",
      /Quality: skipped/.test(result.qualityNotice || "") && /no criteria pack found/.test(result.qualityNotice || ""),
      result.qualityNotice,
    );
    check(
      "and says what to do about it",
      /reinstall/.test(result.qualityNotice || ""),
      result.qualityNotice,
    );
    check("the rest of the bundle is packed as normal", Array.isArray(packed.nodes) && packed.nodes.length === 1, JSON.stringify(packed.nodes));
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
}

inProcess()
  .then(() => {
    console.log(`\n${failures === 0 ? "OK" : "FAILURES"}: quality-section-fold`);
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

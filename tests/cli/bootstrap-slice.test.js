#!/usr/bin/env node

/**
 * Exercises `bootstrap slice` and `bootstrap index` — the method's primary
 * token levers (docs/superpowers/plans/2026-08-04-bootstrap-method.md, Task
 * 4). A slice is what one agent reads instead of the whole mined corpus; an
 * index is what it reads instead of the whole bundle. Both commands exist
 * ONLY to bound what an agent reads, so this file's job is to prove they
 * actually do — not just that they run.
 *
 * `bootstrap corpus` and dispatch live in bootstrap-corpus.test.js; `plan`
 * and the profile.json trust boundary live in bootstrap-plan.test.js. This
 * file needs a real corpus AND a real manifest to exercise `slice`, which is
 * different enough setup (from-json corpus + profile.json + plan, all
 * together) that it reads better as its own file than bolted onto either.
 *
 * Runs in fresh mkdtemp dirs, never the repo itself.
 */

const { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require("fs");
const { spawnSync } = require("child_process");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
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

function freshRepoDir(prefix) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(d, ".git"), { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// `bootstrap slice`
// ---------------------------------------------------------------------------

const dir = freshRepoDir("arkaik-bootstrap-slice-");
try {
  check("bootstrap --help lists slice", runCli(["bootstrap", "--help"], dir).stdout.includes("slice"), "");
  check("bootstrap --help lists index", runCli(["bootstrap", "--help"], dir).stdout.includes("index"), "");

  const HUGE_BODY = "x".repeat(6000);

  // A corpus crafted to exercise every probe at once:
  //  - PR 1: touches app/home, inside the era window       -> in w1-home AND w3-first-era
  //  - PR 2: touches package.json (chore), inside the era   -> NOT in w1-home, IS in w3-first-era
  //  - PR 3: touches app/homepage/thing.ts (probe 3: must NOT match "app/home" as a prefix)
  //  - PR 4: touches app/home, merged BEFORE the era window -> in w1-home, NOT in w3-first-era
  //          (probe 1: "what happens to a PR that falls in no era" — excluded, not an error)
  //  - PR 5: touches win/dir/file.ts (POSIX on disk/in the corpus) matched by
  //          an area whose profile.json path is spelled "win\\dir" (probe 3:
  //          a Windows-style separator arriving from profile.json)
  //  - PR 6: touches app/home with a 6000-char body (probe 6: truncation cap)
  const ghPayload = [
    { number: 1, title: "Add home screen", body: "Small body.", mergedAt: "2026-01-05T00:00:00Z", labels: [], files: [{ path: "app/home/page.tsx" }] },
    { number: 2, title: "chore: bump deps", body: "", mergedAt: "2026-01-06T00:00:00Z", labels: [], files: [{ path: "package.json" }] },
    { number: 3, title: "Add homepage marketing", body: "", mergedAt: "2026-01-07T00:00:00Z", labels: [], files: [{ path: "app/homepage/thing.ts" }] },
    { number: 4, title: "Old pre-era home work", body: "", mergedAt: "2025-06-01T00:00:00Z", labels: [], files: [{ path: "app/home/legacy.tsx" }] },
    { number: 5, title: "Windows-separator area", body: "", mergedAt: "2026-01-08T00:00:00Z", labels: [], files: [{ path: "win/dir/file.ts" }] },
    { number: 6, title: "Huge body PR", body: HUGE_BODY, mergedAt: "2026-01-09T00:00:00Z", labels: [], files: [{ path: "app/home/huge.tsx" }] },
  ];
  writeFileSync(path.join(dir, "gh.json"), JSON.stringify(ghPayload));

  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "vision.md"), "# Vision\n\nWhy we build.\n");
  mkdirSync(path.join(dir, "app", "home"), { recursive: true });
  writeFileSync(path.join(dir, "app", "home", "page.tsx"), "export default function Home() {}\n");

  const corpus = runCli(["bootstrap", "corpus", "--from-json", path.join(dir, "gh.json")], dir);
  check("setup: corpus exits 0", corpus.status === 0, corpus.stderr);

  mkdirSync(path.join(dir, ".arkaik", "bootstrap"), { recursive: true });
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "app", title: "App" }],
      platforms: ["web"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home"] },
        { id: "winpath", title: "Winpath", paths: ["win\\dir"] },
      ],
      eras: [
        { slug: "first-era", title: "First era", from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
        { slug: "no-dates-era", title: "No dates era" },
      ],
    }),
  );
  const plan = runCli(["bootstrap", "plan"], dir);
  check("setup: plan exits 0", plan.status === 0, plan.stderr);

  // --- probe 3: matchesPaths prefix semantics ---
  const homeSlice = JSON.parse(runCli(["bootstrap", "slice", "w1-home"], dir).stdout);
  const homeNumbers = homeSlice.prs.map((p) => p.number).sort();
  check(
    "w1-home matches PRs touching app/home (1, 4, 6), not the chore PR",
    JSON.stringify(homeNumbers) === JSON.stringify([1, 4, 6]),
    JSON.stringify(homeNumbers),
  );
  check(
    "w1-home does NOT match app/homepage/thing.ts as a prefix of app/home (PR 3 excluded)",
    !homeSlice.prs.some((p) => p.number === 3),
    JSON.stringify(homeNumbers),
  );
  check("w1-home carries the unit scope", typeof homeSlice.scope === "string" && homeSlice.scope.length > 0, homeSlice.scope);
  check("w1-home omits docs unless asked", homeSlice.docs === undefined, JSON.stringify(homeSlice.docs));
  check(
    "w1-home lists the matching surface",
    homeSlice.surfaces.some((s) => s.path === "app/home/page.tsx"),
    JSON.stringify(homeSlice.surfaces),
  );

  // --- probe 3: a Windows-style separator in profile.json still matches the POSIX corpus ---
  const winSlice = JSON.parse(runCli(["bootstrap", "slice", "w1-winpath"], dir).stdout);
  check(
    "an area path spelled with a backslash still matches the POSIX-stored corpus file",
    winSlice.prs.some((p) => p.number === 5),
    JSON.stringify(winSlice.prs.map((p) => p.number)),
  );

  // --- probe 1: era filtering actually runs ---
  const eraSlice = JSON.parse(runCli(["bootstrap", "slice", "w3-first-era"], dir).stdout);
  const eraNumbers = eraSlice.prs.map((p) => p.number).sort();
  check(
    "w3-first-era is NOT the whole corpus — it's date-windowed (1, 2, 3, 5, 6), not (1..6)",
    JSON.stringify(eraNumbers) === JSON.stringify([1, 2, 3, 5, 6]),
    JSON.stringify(eraNumbers),
  );
  check(
    "a PR merged before the era's `from` is excluded, not an error (PR 4)",
    !eraSlice.prs.some((p) => p.number === 4),
    JSON.stringify(eraNumbers),
  );
  check(
    "the era slice includes a PR outside any area's paths (PR 2, the chore) — era filtering is date-based, not path-based",
    eraSlice.prs.some((p) => p.number === 2),
    JSON.stringify(eraNumbers),
  );

  // --- probe 1: an era with neither `from` nor `to` fails closed, not open ---
  const noDatesSlice = JSON.parse(runCli(["bootstrap", "slice", "w3-no-dates-era"], dir).stdout);
  check(
    "an era with no dates at all matches ZERO PRs (fails closed) rather than the entire corpus (fails open)",
    noDatesSlice.prs.length === 0,
    JSON.stringify(noDatesSlice.prs.map((p) => p.number)),
  );

  // --- probe 2: which unit kinds legitimately get the whole corpus ---
  const statusArcsSlice = JSON.parse(runCli(["bootstrap", "slice", "w3-status-arcs"], dir).stdout);
  check(
    "w3-status-arcs (no paths, no eras by design) gets the entire PR corpus — this is intentional, not the bug",
    statusArcsSlice.prs.length === 6,
    String(statusArcsSlice.prs.length),
  );
  const reconSlice = JSON.parse(runCli(["bootstrap", "slice", "w0-recon"], dir).stdout);
  check("w0-recon gets the docs manifest", Array.isArray(reconSlice.docs) && reconSlice.docs.length === 1, JSON.stringify(reconSlice.docs));
  check("w0-recon (no paths, no eras) also gets the entire PR corpus", reconSlice.prs.length === 6, String(reconSlice.prs.length));

  // --- probe 6: output size — a single outlier body must not blow up the slice ---
  const hugePr = homeSlice.prs.find((p) => p.number === 6);
  check("a normal-size PR body is untouched", homeSlice.prs.find((p) => p.number === 1).body === "Small body.", "");
  check(
    "an oversized PR body is truncated in the slice, not passed through whole",
    hugePr.body.length < HUGE_BODY.length,
    String(hugePr.body.length),
  );
  check("the truncated body says so", hugePr.body.includes("truncated"), hugePr.body.slice(-80));

  // --- probe 6 (mechanical): slice JSON is compact, not pretty-printed ---
  const rawSliceOut = runCli(["bootstrap", "slice", "w1-home"], dir).stdout;
  check(
    "slice output is single-line compact JSON, not indented (every byte here is read by an agent)",
    !rawSliceOut.trimEnd().includes("\n"),
    JSON.stringify(rawSliceOut.slice(0, 120)),
  );

  // --- unknown unit ---
  const badSlice = runCli(["bootstrap", "slice", "no-such-unit"], dir);
  check("unknown unit exits 1", badSlice.status === 1, String(badSlice.status));

  // --- no manifest yet ---
  const noManifestDir = freshRepoDir("arkaik-bootstrap-slice-nomanifest-");
  try {
    const noManifest = runCli(["bootstrap", "slice", "w1-home"], noManifestDir);
    check("slice with no manifest exits 1", noManifest.status === 1, String(noManifest.status));
    check("slice with no manifest names the missing manifest", noManifest.stderr.includes("plan"), noManifest.stderr);
  } finally {
    rmSync(noManifestDir, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// `bootstrap index`
// ---------------------------------------------------------------------------

const idxDir = freshRepoDir("arkaik-bootstrap-index-");
try {
  const bundleDir = path.join(idxDir, "docs", "arkaik");
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    path.join(bundleDir, "bundle.json"),
    JSON.stringify({
      schema_version: 3,
      project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
      nodes: [
        { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"], metadata: { product: "app" } },
        { id: "F-onboarding", project_id: "demo", species: "flow", title: "Onboarding", status: "live", platforms: ["web"] },
        // probe 4: a title with a tab, a CR and a newline — must not corrupt the line format.
        { id: "V-weird", project_id: "demo", species: "view", title: "Weird\tTitle\r\nWith Breaks", status: "live", platforms: ["web"] },
      ],
      edges: [],
    }),
  );
  const idx = runCli(["bootstrap", "index"], idxDir);
  check("index exits 0", idx.status === 0, idx.stderr);
  check("index lists the view with its product", idx.stdout.includes("V-home\tview\tHome\tapp"), idx.stdout);
  check("index lists the flow with no product", idx.stdout.includes("F-onboarding\tflow\tOnboarding\t-"), idx.stdout);

  const idxLines = idx.stdout.trim().split("\n");
  check("index is one line per node plus header", idxLines.length === 4, idx.stdout);
  const weirdLine = idxLines.find((l) => l.startsWith("V-weird\t"));
  check("probe 4: a tab/CR/LF-laden title still produces exactly one line for its node", weirdLine !== undefined, idx.stdout);
  check(
    "probe 4: that line still has exactly 4 tab-separated columns (no column shift, no id-less continuation line)",
    weirdLine !== undefined && weirdLine.split("\t").length === 4,
    JSON.stringify(weirdLine),
  );

  // --- probe 5: a missing bundle fails sanely, not with a raw crash ---
  const missingDir = freshRepoDir("arkaik-bootstrap-index-missing-");
  try {
    const missing = runCli(["bootstrap", "index"], missingDir);
    check("index against a missing bundle exits 1", missing.status === 1, String(missing.status));
    check(
      "index against a missing bundle prints a clean message, not a raw stack trace",
      !missing.stderr.includes("at Object.") && !missing.stderr.includes("throw "),
      missing.stderr,
    );
  } finally {
    rmSync(missingDir, { recursive: true, force: true });
  }

  // --- probe 5: an unparseable bundle fails sanely ---
  const badJsonDir = freshRepoDir("arkaik-bootstrap-index-badjson-");
  try {
    mkdirSync(path.join(badJsonDir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(badJsonDir, "docs", "arkaik", "bundle.json"), "{ not valid json");
    const badJson = runCli(["bootstrap", "index"], badJsonDir);
    check("index against unparseable JSON exits 1", badJson.status === 1, String(badJson.status));
  } finally {
    rmSync(badJsonDir, { recursive: true, force: true });
  }

  // --- probe 5: an absolute path argument resolves to itself, not cwd-joined ---
  const absDir = freshRepoDir("arkaik-bootstrap-index-abs-");
  const absBundleFile = path.join(absDir, "elsewhere-bundle.json");
  try {
    writeFileSync(
      absBundleFile,
      JSON.stringify({
        schema_version: 3,
        project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        nodes: [{ id: "V-abs", project_id: "demo", species: "view", title: "Abs", status: "live", platforms: ["web"] }],
        edges: [],
      }),
    );
    const absIdx = runCli(["bootstrap", "index", absBundleFile], absDir);
    check("index with an absolute path argument exits 0", absIdx.status === 0, absIdx.stderr);
    check(
      "an absolute path argument resolves to itself, not <cwd>/<abs path>",
      absIdx.stdout.includes("V-abs"),
      absIdx.stdout,
    );
  } finally {
    rmSync(absDir, { recursive: true, force: true });
  }
} finally {
  rmSync(idxDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

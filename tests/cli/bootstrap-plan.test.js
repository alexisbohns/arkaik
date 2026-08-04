#!/usr/bin/env node

/**
 * Exercises `arkaik bootstrap` — the deterministic half of the bootstrap
 * method: corpus mining from a captured gh payload, work-unit planning from a
 * recon profile, corpus slicing, and the compact map index.
 * Runs in fresh mkdtemp dirs, never the repo itself.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require("fs");
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

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-plan-"));
try {
  // A real .git dir is not needed — `corpus` only checks for its presence,
  // as the repo-root guard against running from a subdirectory.
  mkdirSync(path.join(dir, ".git"), { recursive: true });

  // --- dispatch ---
  const help = runCli(["bootstrap", "--help"], dir);
  check("bootstrap --help exits 0", help.status === 0, help.stderr);
  check("help lists corpus", help.stdout.includes("corpus"), help.stdout);
  check("help lists merge", help.stdout.includes("merge"), help.stdout);

  const noArgs = runCli(["bootstrap"], dir);
  check("bootstrap with no arguments exits 0", noArgs.status === 0, noArgs.stderr);
  check("bootstrap with no arguments prints usage", noArgs.stdout.includes("Subcommands:"), noArgs.stdout);

  const unknown = runCli(["bootstrap", "nope"], dir);
  check("unknown subcommand exits 1", unknown.status === 1, String(unknown.status));
  check("unknown subcommand error lands on stderr", unknown.stderr.includes("Unknown bootstrap subcommand"), unknown.stderr);

  // --- corpus from a captured gh payload ---
  const ghPayload = [
    {
      number: 1,
      title: "Add the home screen",
      body: "## Lab Note\n\n```yaml\nen:\n  title: \"Home, at last\"\n```",
      mergedAt: "2026-01-02T10:00:00Z",
      labels: [{ name: "feature" }],
      files: [{ path: "app/home/page.tsx" }],
    },
    {
      number: 2,
      title: "chore: bump deps",
      body: "",
      mergedAt: "2026-01-03T10:00:00Z",
      labels: [],
      files: [{ path: "package.json" }],
    },
  ];
  const payloadPath = path.join(dir, "gh.json");
  writeFileSync(payloadPath, JSON.stringify(ghPayload));
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "vision.md"), "# Vision\n\nWhy we build.\n");
  mkdirSync(path.join(dir, "app", "home"), { recursive: true });
  writeFileSync(path.join(dir, "app", "home", "page.tsx"), "export default function Home() {}\n");

  const corpus = runCli(["bootstrap", "corpus", "--from-json", payloadPath], dir);
  check("corpus exits 0", corpus.status === 0, corpus.stderr);

  const prLines = readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8").trim().split("\n");
  check("both PRs captured", prLines.length === 2, String(prLines.length));
  const pr1 = JSON.parse(prLines[0]);
  check("PRs sorted oldest first", pr1.number === 1, String(pr1.number));
  check("changed paths flattened to strings", pr1.files[0] === "app/home/page.tsx", JSON.stringify(pr1.files));
  check("lab note detected", pr1.has_lab_note === true, JSON.stringify(pr1.has_lab_note));
  check("chore PR has no lab note", JSON.parse(prLines[1]).has_lab_note === false, prLines[1]);

  // --- regression: merge date orders the corpus, not PR number ---
  // PR #60 merged before #50 — review latency and long-lived branches make
  // this routine, not exotic. Sorting by number alone (the original bug,
  // caught on the --from-git path but present on the gh path too) would put
  // #50 first; merge date must win.
  const orderDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-order-"));
  try {
    mkdirSync(path.join(orderDir, ".git"), { recursive: true });
    const disagreeingPayload = [
      { number: 60, title: "PR 60, merged first", body: "", mergedAt: "2026-01-01T00:00:00Z", labels: [], files: [] },
      { number: 50, title: "PR 50, merged second", body: "", mergedAt: "2026-01-05T00:00:00Z", labels: [], files: [] },
    ];
    const disagreeingPath = path.join(orderDir, "gh.json");
    writeFileSync(disagreeingPath, JSON.stringify(disagreeingPayload));
    const orderRun = runCli(["bootstrap", "corpus", "--from-json", disagreeingPath], orderDir);
    check("merge-date-vs-number corpus exits 0", orderRun.status === 0, orderRun.stderr);
    const orderedLines = readFileSync(path.join(orderDir, ".arkaik", "corpus", "prs.jsonl"), "utf8").trim().split("\n");
    check(
      "merge date wins over number when they disagree",
      JSON.parse(orderedLines[0]).number === 60 && JSON.parse(orderedLines[1]).number === 50,
      orderedLines.join("\n"),
    );
  } finally {
    rmSync(orderDir, { recursive: true, force: true });
  }

  // --- regression: --from-git doesn't mint duplicate PR numbers ---
  // Real history duplicated numbers two ways: a `#N` mention mid-subject
  // matched the same regex as a real "Merge pull request #N" line, and the
  // positional fallback (starting at 1) could land on a real number. Three
  // merges: one GitHub-authored (#5), one plain merge with no number at all
  // (must fall back), and one that only *mentions* #5 (must NOT match it —
  // an unanchored regex would collide with the real #5 here).
  const gitDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-fromgit-"));
  try {
    const git = (args) => spawnSync("git", args, { cwd: gitDir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["commit", "-q", "--allow-empty", "-m", "chore: init"]);
    const branch = git(["symbolic-ref", "--short", "HEAD"]).stdout.trim();

    git(["checkout", "-q", "-b", "feature-a"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature A"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-a", "-m", "Merge pull request #5 from acme/feature-a"]);

    git(["checkout", "-q", "-b", "feature-b"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature B"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-b", "-m", "Merge branch 'feature-b'"]);

    git(["checkout", "-q", "-b", "feature-c"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature C"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-c", "-m", "See #5 for context, unrelated change"]);

    const fromGitRun = runCli(["bootstrap", "corpus", "--from-git"], gitDir);
    check("--from-git corpus exits 0", fromGitRun.status === 0, fromGitRun.stderr);
    const fromGitPrs = readFileSync(path.join(gitDir, ".arkaik", "corpus", "prs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    check("--from-git produced 3 PRs", fromGitPrs.length === 3, String(fromGitPrs.length));
    const fromGitNumbers = fromGitPrs.map((p) => p.number);
    check(
      "--from-git numbers are all distinct (no collision)",
      new Set(fromGitNumbers).size === fromGitNumbers.length,
      JSON.stringify(fromGitNumbers),
    );
    const realFive = fromGitPrs.find((p) => p.title.startsWith("Merge pull request #5 "));
    check(
      "the anchored match won: only the GitHub-authored subject claims #5",
      realFive !== undefined && realFive.number === 5,
      JSON.stringify(fromGitPrs),
    );
    const mention = fromGitPrs.find((p) => p.title === "See #5 for context, unrelated change");
    check(
      "a mid-subject #5 mention did not steal the real PR's number",
      mention !== undefined && mention.number !== 5,
      JSON.stringify(fromGitPrs),
    );
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }

  const docs = JSON.parse(readFileSync(path.join(dir, ".arkaik", "corpus", "docs.json"), "utf8"));
  check("docs manifest found vision.md", docs.some((d) => d.path === "docs/vision.md"), JSON.stringify(docs));
  check("docs manifest carries the heading", docs.some((d) => d.title === "Vision"), JSON.stringify(docs));

  const surfacesRaw = readFileSync(path.join(dir, ".arkaik", "corpus", "surfaces.json"), "utf8");
  const surfaces = JSON.parse(surfacesRaw);
  check("surfaces found the page", surfaces.some((s) => s.path === "app/home/page.tsx"), JSON.stringify(surfaces));
  check(
    "surface classified as page (SURFACE_RULES ordering)",
    surfaces.find((s) => s.path === "app/home/page.tsx")?.kind === "page",
    JSON.stringify(surfaces),
  );

  check(
    "corpus gitignores .arkaik",
    readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".arkaik/"),
    "no .gitignore entry",
  );

  const prsRaw = readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8");

  const again = runCli(["bootstrap", "corpus", "--from-json", payloadPath], dir);
  check("corpus is idempotent", again.status === 0, again.stderr);
  check(
    "gitignore not duplicated",
    readFileSync(path.join(dir, ".gitignore"), "utf8").match(/\.arkaik\//g).length === 1,
    readFileSync(path.join(dir, ".gitignore"), "utf8"),
  );
  check(
    "prs.jsonl is byte-identical on re-run",
    readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8") === prsRaw,
    "content differs between runs",
  );
  check(
    "surfaces.json is byte-identical on re-run",
    readFileSync(path.join(dir, ".arkaik", "corpus", "surfaces.json"), "utf8") === surfacesRaw,
    "content differs between runs",
  );

  // --- corpus option validation ---
  const missingValue = runCli(["bootstrap", "corpus", "--from-json"], dir);
  check("--from-json with no value exits 1", missingValue.status === 1, String(missingValue.status));
  check(
    "--from-json with no value fails fast instead of falling through to gh",
    missingValue.stderr.includes("Missing value for --from-json"),
    missingValue.stderr,
  );

  const unknownOpt = runCli(["bootstrap", "corpus", "--nope"], dir);
  check("corpus unknown option exits 1", unknownOpt.status === 1, String(unknownOpt.status));
  check("corpus unknown option reports the flag", unknownOpt.stderr.includes("Unknown option: --nope"), unknownOpt.stderr);

  const badLimit = runCli(["bootstrap", "corpus", "--from-json", payloadPath, "--limit", "abc"], dir);
  check("--limit with a non-integer exits 1", badLimit.status === 1, String(badLimit.status));
  check("--limit error names the bad value", badLimit.stderr.includes("abc"), badLimit.stderr);

  const badSince = runCli(["bootstrap", "corpus", "--from-json", payloadPath, "--since", "not-a-date"], dir);
  check("--since with an unparseable date exits 1", badSince.status === 1, String(badSince.status));
  check("--since error names the bad value", badSince.stderr.includes("not-a-date"), badSince.stderr);

  const noGitRoot = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-nogit-"));
  try {
    const outsideRepo = runCli(["bootstrap", "corpus", "--from-json", payloadPath], noGitRoot);
    check("corpus outside a repo root exits 1", outsideRepo.status === 1, String(outsideRepo.status));
    check(
      "corpus outside a repo root names the reason",
      outsideRepo.stderr.includes("repository root"),
      outsideRepo.stderr,
    );
  } finally {
    rmSync(noGitRoot, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

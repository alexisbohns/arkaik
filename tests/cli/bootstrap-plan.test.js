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

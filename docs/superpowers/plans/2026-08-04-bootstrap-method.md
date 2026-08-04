# Bootstrap Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the one-time capability that takes any repo from "no map" or "stale map" to a complete Arkaik graph — determinism in the CLI, judgment in a skill, agents meeting them at a fragment file boundary.

**Architecture:** A new `arkaik bootstrap` command group owns everything deterministic (corpus mining, work-unit planning, corpus slicing, compact indexing, fragment merging). A new on-demand `arkaik-bootstrap` skill owns everything judgmental. A new `PUT /api/graph/projects/{id}/bundle` endpoint plus `arkaik restore` lets a bootstrapped bundle — history included — land on a hosted project, which the mutation API cannot express because its journal is derived server-side.

**Tech Stack:** TypeScript, the hand-rolled dependency-free CLI dispatcher in `packages/cli`, `@arkaik/schema` for all validation/serialization, Next.js route handlers + `pg` for the server, plain `node tests/**/*.test.js` for tests (no framework).

---

## Read first

- Spec: [`docs/superpowers/specs/2026-08-04-bootstrap-method-design.md`](../specs/2026-08-04-bootstrap-method-design.md)
- The method this generalizes: [`docs/superpowers/specs/2026-08-04-content-population-design.md`](../specs/2026-08-04-content-population-design.md)
- The CLI's conventions: `packages/cli/src/index.ts` (hand-rolled dispatch, each command parses its own flags), `packages/cli/src/commands/link.ts` (the `httpClient` injection seam and `ARKAIK_TOKEN` handling), `packages/cli/src/commands/push.ts` (the `--api` flag pattern)
- Test conventions: `tests/cli/deliverable.test.js` — CommonJS, `spawnSync` against `packages/cli/dist/index.js`, `mkdtempSync` working dirs, hand-rolled `check(name, cond, detail)` counters, exit non-zero on failure

**Three constraints that come from this repo, not from the spec:**

1. **CI gates on lint.** `main` carries pre-existing errors; the bar is *no new error in a file you touch*.
2. **There is no local Postgres.** Anything DB-touching no-ops locally. That is why Part B puts every decision rule in pure functions with real tests, and leaves only the SQL in the route.
3. **Nothing here belongs in `@arkaik/schema`.** Fragment and manifest types stay CLI-local so no generated artifact moves and `npm run generate` stays untouched.

---

## File structure

**Part A — CLI bootstrap surface (PR 1)**

| File | Responsibility |
|---|---|
| `packages/cli/src/commands/bootstrap.ts` | Subcommand dispatch + flag parsing + usage. No logic. |
| `packages/cli/src/lib/bootstrap/paths.ts` | `.arkaik/` layout constants; `ensureGitignored`. |
| `packages/cli/src/lib/bootstrap/corpus.ts` | PR/docs/surfaces mining and the corpus file writes. |
| `packages/cli/src/lib/bootstrap/manifest.ts` | Manifest + profile types, planning, resume. |
| `packages/cli/src/lib/bootstrap/slice.ts` | Resolve one unit's corpus subset. |
| `packages/cli/src/lib/bootstrap/index-view.ts` | Compact map index rendering. |
| `packages/cli/src/lib/bootstrap/event-id.ts` | Deterministic ULID-shaped event ids. |
| `packages/cli/src/lib/bootstrap/fragments.ts` | Fragment types, loading, shape checks. |
| `packages/cli/src/lib/bootstrap/merge.ts` | Pure merge: nodes, edges, reconcile ops, journal. |
| `tests/cli/bootstrap-plan.test.js` | Corpus, plan, slice, index. |
| `tests/cli/bootstrap-merge.test.js` | Merge semantics + determinism. |
| `tests/cli/bootstrap-e2e.test.js` | Golden fixture repo, corpus → plan → merge → validate. |

**Part B — hosted restore (PR 2)**

| File | Responsibility |
|---|---|
| `lib/services/graph/restore.ts` | Pure: version matching, delta computation. |
| `lib/services/graph/store.ts` | `replaceProjectBundle` (SQL only). |
| `app/api/graph/projects/[projectId]/bundle/route.ts` | `PUT` handler. |
| `packages/cli/src/commands/restore.ts` | Backup, dry-run, `If-Match` PUT. |
| `tests/services/graph-restore.test.js` | The pure functions. |
| `tests/cli/bootstrap-restore.test.js` | CLI against a local stub server. |

**Part C — skill + wiring (PR 3)**

| File | Responsibility |
|---|---|
| `plugin/skills/arkaik-bootstrap/skill.md` | The judgment skill. |
| `plugin/skills/arkaik-bootstrap/references/fragments.md` | Fragment contract for agents. |
| `plugin/skills/arkaik-bootstrap/references/waves.md` | Wave catalog + reviewer checklists. |
| `packages/cli/src/commands/init.ts` | `--bootstrap` / `--remove-bootstrap`. |
| `docs/bootstrap.md` | The method, for humans. |

---

# Part A — PR 1: the CLI bootstrap surface

### Task 1: Command scaffold and dispatch

**Files:**
- Create: `packages/cli/src/commands/bootstrap.ts`
- Create: `packages/cli/src/lib/bootstrap/paths.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `tests/cli/bootstrap-plan.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/bootstrap-plan.test.js`:

```js
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
  // --- dispatch ---
  const help = runCli(["bootstrap", "--help"], dir);
  check("bootstrap --help exits 0", help.status === 0, help.stderr);
  check("help lists corpus", help.stdout.includes("corpus"), help.stdout);
  check("help lists merge", help.stdout.includes("merge"), help.stdout);

  const unknown = runCli(["bootstrap", "nope"], dir);
  check("unknown subcommand exits 1", unknown.status === 1, String(unknown.status));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: FAIL — `bootstrap --help exits 0` fails because the dispatcher prints the top-level usage and exits 1 on an unknown command.

- [ ] **Step 3: Write `paths.ts`**

Create `packages/cli/src/lib/bootstrap/paths.ts`:

```ts
/**
 * Where bootstrap keeps its working material.
 *
 * Everything here is scratch: the mined corpus, the plan, and the agent
 * fragments. None of it is the repo's contract — the bundle, the journal and
 * `arkaik validate` are. It all lives under one ignored directory so a
 * bootstrap run leaves no trace in git once the bundle lands.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Forward-slash literals, not path.join: these constants are serialized into
// manifest.json and into user-facing text (not just used as filesystem
// paths), and path.join would emit backslashes on Windows.
export const BOOTSTRAP_ROOT = ".arkaik";
export const CORPUS_DIR = ".arkaik/corpus";
export const PLAN_DIR = ".arkaik/bootstrap";
export const FRAGMENTS_DIR = ".arkaik/bootstrap/fragments";
export const MANIFEST_FILE = ".arkaik/bootstrap/manifest.json";
export const PROFILE_FILE = ".arkaik/bootstrap/profile.json";
export const PRS_FILE = ".arkaik/corpus/prs.jsonl";
export const DOCS_FILE = ".arkaik/corpus/docs.json";
export const SURFACES_FILE = ".arkaik/corpus/surfaces.json";

/**
 * Absolute path for one of the constants above, under `cwd`. Node accepts
 * forward slashes in path.join on every platform, so the literals above pass
 * through unchanged.
 */
export function at(cwd: string, relative: string): string {
  return path.join(cwd, relative);
}

/** Create a directory (and parents) if it is missing. */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

/**
 * Add `.arkaik/` to the repo's .gitignore unless a `.arkaik` or `.arkaik/`
 * line is already present. Returns true when the file was written. Idempotent:
 * a second run is a no-op. Expects `cwd` to be the repo root — it writes to
 * `<cwd>/.gitignore`, not the git root, so calling this from a subdirectory
 * would drop a stray .gitignore there.
 */
export function ensureGitignored(cwd: string): boolean {
  const file = path.join(cwd, ".gitignore");
  const line = `${BOOTSTRAP_ROOT}/`;
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const ignored = current
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l === line || l === BOOTSTRAP_ROOT);
  if (ignored) return false;
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(file, `${current}${prefix}${line}\n`);
  return true;
}
```

- [ ] **Step 4: Write the dispatcher**

Create `packages/cli/src/commands/bootstrap.ts`:

```ts
/**
 * `arkaik bootstrap <subcommand>` — the deterministic half of the bootstrap
 * method (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md).
 *
 * Determinism lives here; judgment lives in the `arkaik-bootstrap` skill. The
 * two meet at a file boundary: agents read a slice, agents write a fragment,
 * and this command group owns everything else — ID uniqueness, edge
 * resolution, journal construction, validation gating.
 */
const USAGE = `arkaik bootstrap <subcommand> [options]

Subcommands:
  corpus [options]        Mine merged PRs, docs and surfaces into .arkaik/corpus/.
  plan [options]          Emit the work-unit manifest (--issues files GitHub issues).
  slice <unit>            Print exactly the corpus subset one work unit needs.
  index [path]            Print a compact id/title/species listing of the map.
  merge [options]         Assemble fragments onto the bundle, then validate.

Options:
  -h, --help              Show this help.

Run "arkaik bootstrap <subcommand> --help" for subcommand help.`;

export function runBootstrap(argv: string[]): void {
  const [sub, ...rest] = argv;

  if (sub === undefined || sub === "-h" || sub === "--help" || sub === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (sub) {
    default:
      console.error(`Unknown bootstrap subcommand: ${sub}\n\n${USAGE}`);
      process.exit(1);
  }
}
```

- [ ] **Step 5: Wire it into the dispatcher**

In `packages/cli/src/index.ts`, add the import beside the others:

```ts
import { runBootstrap } from "./commands/bootstrap";
```

Add to the `USAGE` command list, immediately after the `link` entry:

```
  bootstrap <sub> [options]   One-time onboarding: mine, plan, slice, merge a map from a repo.
```

Add the case to the `switch`, after `case "link":`:

```ts
    case "bootstrap":
      runBootstrap(rest);
      return;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: PASS on all four checks.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/bootstrap.ts packages/cli/src/lib/bootstrap/paths.ts packages/cli/src/index.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): arkaik bootstrap command scaffold"
```

---

### Task 2: `bootstrap corpus`

The corpus is the repo's history and shape, captured once so agents never re-mine it. `gh` is the default source; `--from-json` replays a captured payload, which is what makes this testable offline and re-runnable without re-hitting the API.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/corpus.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-plan.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the `try` block of `tests/cli/bootstrap-plan.test.js`, before the closing brace:

```js
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
```

Also add, right after `try {` (before the `--- dispatch ---` block): `mkdirSync(path.join(dir, ".git"), { recursive: true });` — `corpus` refuses to run outside a repo root (Task 2 review), and the mkdtemp scratch dir has no `.git` of its own.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-plan.test.js`
Expected: FAIL — `corpus exits 0` fails with "Unknown bootstrap subcommand: corpus".

- [ ] **Step 3: Write `corpus.ts`**

Create `packages/cli/src/lib/bootstrap/corpus.ts`:

```ts
/**
 * Corpus mining: the repo's history and shape, captured once.
 *
 * Three files, all working material under `.arkaik/corpus/`:
 *  - `prs.jsonl`  — every merged PR, oldest first, one JSON object per line
 *  - `docs.json`  — a manifest of design docs (path + first heading)
 *  - `surfaces.json` — a code inventory by conventional globs
 *
 * `gh` is the default source. `--from-json` replays a captured
 * `gh pr list --json ...` payload instead, which keeps the command testable
 * offline and re-runnable without paying the API cost twice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { at, CORPUS_DIR, DOCS_FILE, ensureDir, PRS_FILE, SURFACES_FILE } from "./paths";

/** One merged PR, normalized. The shape agents read. */
export interface CorpusPr {
  number: number;
  title: string;
  body: string;
  merged_at: string;
  labels: string[];
  files: string[];
  has_lab_note: boolean;
}

/** One design doc worth reading during the story wave. */
export interface CorpusDoc {
  path: string;
  title: string;
}

/** One code surface worth mapping during the anatomy wave. */
export interface CorpusSurface {
  path: string;
  kind: "page" | "route" | "screen" | "api" | "component";
}

const GH_FIELDS = "number,title,body,mergedAt,labels,files";

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".arkaik", "ios", "android", "Pods",
]);

/** Conventional surface globs, ordered most specific first. */
const SURFACE_RULES: ReadonlyArray<{ test: RegExp; kind: CorpusSurface["kind"] }> = [
  { test: /(^|\/)app\/api\/.*\/route\.[tj]sx?$/, kind: "api" },
  { test: /(^|\/)pages\/api\/.*\.[tj]sx?$/, kind: "api" },
  { test: /(^|\/)app\/.*\/page\.[tj]sx?$/, kind: "page" },
  { test: /(^|\/)pages\/(?!api\/).*\.[tj]sx?$/, kind: "page" },
  { test: /(^|\/)(screens|views)\/[^/]+\.[tj]sx?$/, kind: "screen" },
  { test: /(^|\/)app\/.*\/route\.[tj]sx?$/, kind: "route" },
  { test: /(^|\/)components\/[^/]+\.[tj]sx?$/, kind: "component" },
];

/**
 * Raw `gh` rows → normalized `CorpusPr`s, sorted oldest merged first by merge
 * date (`number` only breaks ties) — see the sort below for why.
 */
export function normalizePrs(raw: unknown): CorpusPr[] {
  if (!Array.isArray(raw)) return [];
  const prs: CorpusPr[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const body = typeof r.body === "string" ? r.body : "";
    prs.push({
      // The primary key: readCorpusPrs blind-casts this back to `number`, and
      // JSON.stringify would silently write NaN as `null` otherwise.
      number: typeof r.number === "number" && Number.isFinite(r.number) ? r.number : 0,
      title: typeof r.title === "string" ? r.title : "",
      body,
      merged_at: typeof r.mergedAt === "string" ? r.mergedAt : "",
      labels: Array.isArray(r.labels)
        ? r.labels.map((l) => (typeof l === "string" ? l : String((l as { name?: unknown })?.name ?? ""))).filter(Boolean)
        : [],
      files: Array.isArray(r.files)
        ? r.files.map((f) => (typeof f === "string" ? f : String((f as { path?: unknown })?.path ?? ""))).filter(Boolean)
        : [],
      // A Lab Note means user-visible by definition — the story wave's cheapest
      // signal, and the reason its deliverable copy is nearly free.
      has_lab_note: /^##\s+Lab Note/m.test(body),
    });
  }
  return prs.sort((a, b) => {
    // Merge date, not number: PR #50 can merge after #60, and the corpus
    // exists to reconstruct a chronological narrative. `number` only breaks
    // ties (same-second merges, or the --from-git fallback where a repo with
    // no GitHub remote yields positional numbers).
    const aTime = Date.parse(a.merged_at);
    const bTime = Date.parse(b.merged_at);
    const av = Number.isNaN(aTime) ? Infinity : aTime;
    const bv = Number.isNaN(bTime) ? Infinity : bTime;
    if (av !== bv) return av - bv;
    return a.number - b.number;
  });
}

/** Run `gh pr list` for every merged PR. Throws with gh's own stderr on failure. */
export function fetchPrsViaGh(cwd: string, limit: number): unknown {
  const res = spawnSync("gh", ["pr", "list", "--state", "merged", "--limit", String(limit), "--json", GH_FIELDS], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) throw new Error(`gh not runnable: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`gh exited ${res.status}: ${res.stderr.trim()}`);
  return JSON.parse(res.stdout);
}

/**
 * Merge-commit fallback for repos with no GitHub remote. Loses Lab Notes.
 *
 * `--reverse` makes the walk oldest-first, matching the `gh` path's contract.
 * The real PR number is parsed out of the merge subject when GitHub wrote it
 * ("Merge pull request #103 from …") — the story wave keys deliverables as
 * `pr-<number>`, so a synthetic index would mint wrong ids. Subjects without a
 * number fall back to position, which stays monotonic because of `--reverse`.
 */
export function fetchPrsViaGit(cwd: string): unknown {
  const res = spawnSync("git", ["log", "--merges", "--reverse", "--date=iso-strict", "--pretty=%ad%x1f%s"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`git not runnable: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`git log failed: ${(res.stderr ?? "").trim()}`);

  const lines = res.stdout.split("\n").filter(Boolean);
  const parsed = lines.map((line) => {
    const [date, subject] = line.split("\x1f");
    // Anchored: only a subject GitHub itself wrote carries the PR number. A
    // `#N` mention mid-message, a branch named `feature/#123-x`, or a revert
    // of a merge would otherwise mint someone else's number.
    const matched = /^Merge pull request #(\d+) /.exec(subject ?? "");
    return { date: date ?? "", subject: subject ?? "", number: matched ? Number(matched[1]) : undefined };
  });

  // Fallback numbers must not collide with real ones: the story wave keys
  // deliverables as `pr-<number>`, so a collision mints one id for two merges.
  const taken = new Set(parsed.map((p) => p.number).filter((n): n is number => n !== undefined));
  let next = 1;
  return parsed.map((p) => {
    let number = p.number;
    if (number === undefined) {
      while (taken.has(next)) next += 1;
      number = next;
      taken.add(number);
    }
    return { number, title: p.subject, body: "", mergedAt: p.date, labels: [], files: [] };
  });
}

function walk(root: string, cwd: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return; // an unreadable directory skips its subtree, it does not abort the run
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    // Dirent types are lstat-like: a symlinked directory is neither traversed
    // nor followed, so a symlink cycle cannot inflate the inventory. The same
    // check silently drops symlinked *files* too (isFile() is false for a
    // symlink) — a deliberate trade for the same reason, not a gap: git
    // itself stores a symlink as a link, not as tracked content at that path,
    // so a monorepo that symlinks shared docs in should point corpus mining
    // at the real path instead of relying on the link to be walked.
    if (entry.isDirectory()) walk(full, cwd, out);
    else if (entry.isFile()) out.push(path.relative(cwd, full).split(path.sep).join("/"));
  }
}

/** Every tracked-looking file path, repo-relative, POSIX separators. */
export function listFiles(cwd: string): string[] {
  const out: string[] = [];
  walk(cwd, cwd, out);
  return out.sort();
}

/** Design docs: markdown under docs/, titled by first ATX heading. */
export function buildDocsManifest(cwd: string, files: readonly string[]): CorpusDoc[] {
  return files
    .filter((f) => f.startsWith("docs/") && f.endsWith(".md"))
    .map((f) => {
      const text = readFileSync(path.join(cwd, f), "utf8");
      const heading = /^#\s+(.+)$/m.exec(text);
      return { path: f, title: heading ? heading[1].trim() : path.basename(f, ".md") };
    });
}

/** Code surfaces, by convention. A hint for the anatomy wave, not a source of truth. */
export function buildSurfaceInventory(files: readonly string[]): CorpusSurface[] {
  const out: CorpusSurface[] = [];
  for (const file of files) {
    const rule = SURFACE_RULES.find((r) => r.test.test(file));
    if (rule) out.push({ path: file, kind: rule.kind });
  }
  return out;
}

export interface CorpusOptions {
  cwd: string;
  fromJson?: string;
  fromGit?: boolean;
  limit: number;
  since?: string;
}

export interface CorpusResult {
  prs: number;
  docs: number;
  surfaces: number;
  /**
   * PRs `--since` dropped for a missing/unparseable `merged_at`, as opposed
   * to genuinely merging before the cutoff. The sort treats these PRs as
   * newest (they land last, via `Infinity`); `--since` treats them as
   * un-showably old and excludes them. Both are defensible in isolation, but
   * the same record can't silently be both — this count is how the caller
   * finds out instead of the corpus just getting quietly smaller.
   */
  sinceDroppedUndated: number;
}

/** Mine the repo and write the three corpus files. */
export function buildCorpus(options: CorpusOptions): CorpusResult {
  const { cwd } = options;
  const raw = options.fromJson
    ? JSON.parse(readFileSync(path.resolve(cwd, options.fromJson), "utf8"))
    : options.fromGit
      ? fetchPrsViaGit(cwd)
      : fetchPrsViaGh(cwd, options.limit);

  let prs = normalizePrs(raw);
  let sinceDroppedUndated = 0;
  if (options.since) {
    const floor = Date.parse(options.since);
    if (Number.isNaN(floor)) {
      throw new Error(`--since is not a parseable date: ${options.since} (try an ISO date like 2026-01-31)`);
    }
    prs = prs.filter((pr) => {
      const merged = Date.parse(pr.merged_at);
      // A PR whose own merged_at doesn't parse can't be shown to fall after
      // the cutoff either, so it is dropped here too. Without --since the
      // same PR would sort as the newest thing in the corpus (see the
      // `Infinity` fallback above) — dropping it here is the opposite call,
      // so it is counted rather than done silently (CorpusResult.sinceDroppedUndated).
      if (Number.isNaN(merged)) {
        sinceDroppedUndated += 1;
        return false;
      }
      return merged >= floor;
    });
  }

  const files = listFiles(cwd);
  const docs = buildDocsManifest(cwd, files);
  const surfaces = buildSurfaceInventory(files);

  ensureDir(at(cwd, CORPUS_DIR));
  writeFileSync(at(cwd, PRS_FILE), prs.map((pr) => JSON.stringify(pr)).join("\n") + (prs.length ? "\n" : ""));
  writeFileSync(at(cwd, DOCS_FILE), `${JSON.stringify(docs, null, 2)}\n`);
  writeFileSync(at(cwd, SURFACES_FILE), `${JSON.stringify(surfaces, null, 2)}\n`);

  return { prs: prs.length, docs: docs.length, surfaces: surfaces.length, sinceDroppedUndated };
}

/** Read the mined PRs back. Returns [] when the corpus has not been built. */
export function readCorpusPrs(cwd: string): CorpusPr[] {
  const file = at(cwd, PRS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusPr);
}
```

- [ ] **Step 4: Wire the subcommand**

In `packages/cli/src/commands/bootstrap.ts`, add the imports and the case:

```ts
import { existsSync } from "node:fs";
import path from "node:path";

import { buildCorpus } from "../lib/bootstrap/corpus";
import { BOOTSTRAP_ROOT, CORPUS_DIR, ensureGitignored } from "../lib/bootstrap/paths";

const CORPUS_USAGE = `arkaik bootstrap corpus [options]

Mine merged PRs, design docs and code surfaces into .arkaik/corpus/.

Options:
  --from-json <file>  Replay a captured \`gh pr list --json\` payload instead of calling gh.
  --from-git          Mine merge commits with git instead of gh (loses Lab Notes).
  --limit <n>         Max PRs to fetch from gh (default: 1000).
  --since <iso-date>  Keep only PRs merged at or after this date.
  -h, --help          Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `argv[i]`, failing loudly instead of silently falling through as `undefined`. */
function nextValue(argv: string[], i: number, flag: string, usage: string): string {
  const value = argv[i];
  if (value === undefined) fail(`Missing value for ${flag}\n\n${usage}`);
  return value;
}

function runCorpus(argv: string[]): void {
  const cwd = process.cwd();
  let fromJson: string | undefined;
  let fromGit = false;
  let limit = 1000;
  let since: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(CORPUS_USAGE);
      process.exit(0);
    } else if (arg === "--from-json") {
      fromJson = nextValue(argv, ++i, "--from-json", CORPUS_USAGE);
    } else if (arg === "--from-git") {
      fromGit = true;
    } else if (arg === "--limit") {
      const raw = nextValue(argv, ++i, "--limit", CORPUS_USAGE);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        fail(`--limit must be a positive integer, got: ${raw}\n\n${CORPUS_USAGE}`);
      }
      limit = parsed;
    } else if (arg === "--since") {
      since = nextValue(argv, ++i, "--since", CORPUS_USAGE);
    } else {
      fail(`Unknown option: ${arg}\n\n${CORPUS_USAGE}`);
    }
  }

  // Task 1's ensureGitignored expects cwd to be the repo root; from a
  // subdirectory --from-git still walks full history while listFiles only
  // sees the subtree, so a silently inconsistent corpus is worse than
  // refusing to run.
  if (!existsSync(path.join(cwd, ".git"))) {
    fail("`arkaik bootstrap corpus` must run from the repository root (no .git here).");
  }

  try {
    const result = buildCorpus({ cwd, fromJson, fromGit, limit, since });
    const ignored = ensureGitignored(cwd);
    console.log(`Corpus written to ${CORPUS_DIR}/`);
    console.log(`  ${result.prs} merged PRs, ${result.docs} docs, ${result.surfaces} surfaces`);
    if (result.sinceDroppedUndated > 0) {
      console.log(`  --since also dropped ${result.sinceDroppedUndated} PR(s) with a missing/unparseable merge date`);
    }
    if (ignored) console.log(`  added ${BOOTSTRAP_ROOT}/ to .gitignore`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Add to the `switch` in `runBootstrap`:

```ts
    case "corpus":
      runCorpus(rest);
      return;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: PASS on every check including the idempotence pair.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/bootstrap/corpus.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): bootstrap corpus — mine PRs, docs and surfaces"
```

---

### Task 3: `bootstrap plan` — the manifest

The manifest is what makes this a method rather than a story about one session: unit status lives on disk, so a killed run resumes. `plan` is repo-agnostic because it expands from the recon profile — with no profile it emits only the wave-0 recon unit.

**Implementation note (post-review):** the reference code below was written in one pass and never executed. Quality review on Tasks 1–2 found real defects inherited from an un-executed reference implementation elsewhere in this plan, so Task 3 was implemented with five specific probes applied against the snippet before it shipped. Four turned up genuine bugs, fixed below; the fifth (fragments orphaned when an area drops out of the profile) was traced and found to be harmless by construction, not fixed. All five are recorded here so later tasks don't have to re-discover them:

1. **Wave-3 gating was wrong.** The original gated `w3-decisions` / `w3-status-arcs` on `profile.eras?.length` — a profile with real `areas` but zero `eras` (a young repo, or one recon judged has no story worth splitting into eras yet) silently lost decision-mining and status arcs, even though neither unit reads era boundaries (decisions mines docs, status-arcs arcs anatomy nodes). **Fixed:** gated on `profile !== null` (recon has run) instead.
2. **Status carry-forward didn't check the definition.** The original carried `done` forward by unit id alone. If the profile later changed an area's `paths`, the old fragment on disk was written against the old slice, but the unit still read `done` — `merge` would silently consume stale output. **Fixed:** a unit's status only carries forward when its `title`, `scope`, and `slice` are unchanged from the previous plan; otherwise it resets to `pending` (an honest signal that this unit needs redoing).
3. **Fragments for a dropped area are orphaned, not dangerous.** If recon later drops an area from `profile.json`, its unit vanishes from the next plan's `units` array, but `.arkaik/bootstrap/fragments/<old-id>.json` remains on disk. Traced against Task 6's `loadFragments`: it iterates `manifest.units` and looks up each unit's own fragment path — it never scans the fragments directory — so a fragment with no matching unit is simply never read. No silent data risk; just an inert file. Left unfixed (nothing to fix), noted here so Task 6 doesn't have to re-trace it.
4. **Mode detection used `existsSync`, contradicting the spec's own rule.** § 1 of the design spec says greenfield is "no bundle, **or a stub**" — but the reference code was `existsSync(bundle) ? "brownfield" : "greenfield"`, which reads a freshly-scaffolded `arkaik init` bundle (`{nodes: [], edges: []}`) as brownfield. **Fixed:** `detectMode` reads the bundle when present and checks `nodes.length === 0` (a stub) vs. `> 0` (real content); a bundle that exists but fails to parse throws rather than silently guessing a mode.
5. **Unit ids reach a filesystem path with no validation.** Area ids and era slugs come from `profile.json`, written by an agent, and become fragment filenames verbatim (`${FRAGMENTS_DIR}/${id}.json`). An id containing `/` or `..` would make that path escape the fragments directory; two ids landing on the same string (including an era slug colliding with the reserved `w3-decisions` / `w3-status-arcs` names) would mint two units pointing at the same fragment file, one silently clobbering the other's output. **Fixed:** `assertSafeId` rejects any area id / era slug that isn't `[A-Za-z0-9][A-Za-z0-9-]*`, and a post-build pass rejects any duplicate unit id — both throw with the offending id/value named, caught by `runPlan` and reported via `process.exit(1)` before anything is written.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/manifest.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-plan.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the `try` block — the base plan/resume checks plus one regression test per probe above (stub-bundle mode, gating without eras, status invalidation on a changed slice, unsafe/duplicate ids):

```js
  // --- plan with no profile: recon only ---
  const plan0 = runCli(["bootstrap", "plan"], dir);
  check("plan exits 0 without a profile", plan0.status === 0, plan0.stderr);
  const m0 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check("only the recon unit is planned", m0.units.length === 1, JSON.stringify(m0.units.map((u) => u.id)));
  check("recon unit is wave 0", m0.units[0].wave === 0, String(m0.units[0].wave));
  check("mode is greenfield with no bundle", m0.mode === "greenfield", m0.mode);

  // --- plan with a profile: full expansion ---
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "app", title: "App" }],
      platforms: ["web", "ios"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home"] },
        { id: "settings", title: "Settings", paths: ["app/settings"] },
      ],
      eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-02-01" }],
    }),
  );
  const plan1 = runCli(["bootstrap", "plan"], dir);
  check("plan exits 0 with a profile", plan1.status === 0, plan1.stderr);
  const m1 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  const ids = m1.units.map((u) => u.id);
  check("one anatomy unit per area", ids.includes("w1-home") && ids.includes("w1-settings"), JSON.stringify(ids));
  check("one acceptance unit per area", ids.includes("w2-home") && ids.includes("w2-settings"), JSON.stringify(ids));
  check("one story unit per era", ids.includes("w3-first-light"), JSON.stringify(ids));
  check("decisions unit planned", ids.includes("w3-decisions"), JSON.stringify(ids));
  check("status arcs unit planned", ids.includes("w3-status-arcs"), JSON.stringify(ids));
  check("every unit starts pending", m1.units.every((u) => u.status === "pending"), JSON.stringify(m1.units));
  check(
    "fragment paths are namespaced by unit",
    m1.units.every((u) => u.fragment === `.arkaik/bootstrap/fragments/${u.id}.json`),
    JSON.stringify(m1.units.map((u) => u.fragment)),
  );

  // --- resume preserves completed status ---
  const reconUnit1 = m1.units.find((u) => u.id === "w0-recon");
  reconUnit1.status = "done";
  writeFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(m1));
  const plan2 = runCli(["bootstrap", "plan"], dir);
  check("re-plan exits 0", plan2.status === 0, plan2.stderr);
  const m2 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check(
    "re-plan preserves done status for an unchanged unit",
    m2.units.find((u) => u.id === "w0-recon").status === "done",
    JSON.stringify(m2.units.find((u) => u.id === "w0-recon")),
  );

  // --- probe 2 regression: a unit whose slice changed must NOT keep a stale "done" ---
  m2.units.find((u) => u.id === "w1-home").status = "done";
  m2.units.find((u) => u.id === "w2-home").status = "done";
  m2.units.find((u) => u.id === "w1-settings").status = "done";
  writeFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(m2));
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "app", title: "App" }],
      platforms: ["web", "ios"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home", "app/dashboard"] }, // paths changed
        { id: "settings", title: "Settings", paths: ["app/settings"] }, // unchanged
      ],
      eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-02-01" }],
    }),
  );
  const plan3 = runCli(["bootstrap", "plan"], dir);
  check("re-plan after a profile edit exits 0", plan3.status === 0, plan3.stderr);
  const m3 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check(
    "a unit whose slice changed resets to pending, not done",
    m3.units.find((u) => u.id === "w1-home").status === "pending",
    JSON.stringify(m3.units.find((u) => u.id === "w1-home")),
  );
  check(
    "every unit sharing the changed area's slice resets, including the acceptance unit",
    m3.units.find((u) => u.id === "w2-home").status === "pending",
    JSON.stringify(m3.units.find((u) => u.id === "w2-home")),
  );
  check(
    "a unit whose slice did NOT change keeps its done status",
    m3.units.find((u) => u.id === "w1-settings").status === "done",
    JSON.stringify(m3.units.find((u) => u.id === "w1-settings")),
  );
  check(
    "recon status is untouched by an area's paths changing",
    m3.units.find((u) => u.id === "w0-recon").status === "done",
    JSON.stringify(m3.units.find((u) => u.id === "w0-recon")),
  );
```

Isolated mkdtemp blocks (following the `orderDir` / `gitDir` pattern from Task 2) additionally cover: probe 1 (`areas` with `eras: []` still plans `w3-decisions` / `w3-status-arcs`), probe 4 (a `{nodes: [], edges: []}` bundle reads `greenfield`; the same bundle with one node reads `brownfield`), and probe 5 (an area id of `"../evil"` and an era slug with a space both exit 1 and write no manifest; an era slug of `"decisions"` exits 1 naming the duplicate `w3-decisions` id). See `tests/cli/bootstrap-plan.test.js` for the full text — the CLI's baseline stood at 39 checks before Task 3; the additions above brought it to 71.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-plan.test.js`
Expected: FAIL — "Unknown bootstrap subcommand: plan".

- [ ] **Step 3: Write `manifest.ts`**

Create `packages/cli/src/lib/bootstrap/manifest.ts`:

```ts
/**
 * The work-unit manifest — bootstrap's unit of resumability.
 *
 * Unit status lives on disk, not in a session, so a killed run picks up at the
 * first `pending` unit instead of starting over. `plan` is repo-agnostic: with
 * no recon profile it emits only the wave-0 recon unit, and re-running after
 * recon expands waves 1–3 from whatever areas and eras that profile declares.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { at, ensureDir, FRAGMENTS_DIR, MANIFEST_FILE, PLAN_DIR, PROFILE_FILE } from "./paths";

export type UnitStatus = "pending" | "done" | "rejected";

export interface WorkUnit {
  /** Stable, filesystem-safe: also names the fragment file. */
  id: string;
  wave: 0 | 1 | 2 | 3;
  title: string;
  /** What the agent is asked to produce, in words. */
  scope: string;
  /** How `bootstrap slice` resolves this unit's corpus subset. */
  slice: { paths?: string[]; eras?: string[]; docs?: boolean };
  /** Where the agent writes its fragment, repo-relative. */
  fragment: string;
  status: UnitStatus;
}

export interface Manifest {
  version: 1;
  mode: "greenfield" | "brownfield";
  bundle: string;
  units: WorkUnit[];
}

export interface Profile {
  products?: Array<{ id: string; title: string }>;
  platforms?: string[];
  areas?: Array<{ id: string; title: string; paths: string[] }>;
  eras?: Array<{ slug: string; title: string; from?: string; to?: string }>;
}

export function readProfile(cwd: string): Profile | null {
  const file = at(cwd, PROFILE_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Profile;
}

export function readManifest(cwd: string): Manifest | null {
  const file = at(cwd, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

export function writeManifest(cwd: string, manifest: Manifest): void {
  ensureDir(at(cwd, PLAN_DIR));
  ensureDir(at(cwd, FRAGMENTS_DIR));
  writeFileSync(at(cwd, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Greenfield vs brownfield: the spec's rule is "no bundle, OR A STUB" — an
 * `arkaik init` scaffold is a real file with zero nodes, so `existsSync`
 * alone would misclassify it as brownfield and send agents into reconcile
 * mode against nothing. Only a bundle that already carries nodes is
 * brownfield. A bundle file that exists but can't be parsed as JSON is a
 * real problem, not a mode to silently guess at, so it throws instead of
 * defaulting either way.
 */
export function detectMode(cwd: string, bundlePath: string): Manifest["mode"] {
  const file = at(cwd, bundlePath);
  if (!existsSync(file)) return "greenfield";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read bundle at ${bundlePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const nodes =
    parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { nodes?: unknown }).nodes)
      ? (parsed as { nodes: unknown[] }).nodes
      : [];
  return nodes.length === 0 ? "greenfield" : "brownfield";
}

function unit(id: string, wave: WorkUnit["wave"], title: string, scope: string, slice: WorkUnit["slice"]): WorkUnit {
  return { id, wave, title, scope, slice, fragment: `${FRAGMENTS_DIR}/${id}.json`, status: "pending" };
}

const RECON_SCOPE =
  "Read the corpus and the repo. Write .arkaik/bootstrap/profile.json declaring products, the platform axis, " +
  "the areas to fan out over (id, title, code paths), and the thematic eras the merged PRs fall into. " +
  "Then re-run `arkaik bootstrap plan` to expand waves 1-3.";

/** Letters, digits and hyphens only — no `/`, no `..`, no whitespace. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Area ids and era slugs come from profile.json — written by an agent, not
 * by this code — and become fragment filenames verbatim
 * (`${FRAGMENTS_DIR}/${id}.json`). An id containing `/` or `..` would make
 * that path escape the fragments directory; whitespace or other punctuation
 * just means "not what a human meant to type." Reject rather than sanitize:
 * silently mangling the id would let two different-looking ids collide
 * without anyone noticing.
 */
function assertSafeId(kind: "area" | "era", id: unknown): void {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id)) {
    throw new Error(
      `profile.json has an unsafe ${kind} id: ${JSON.stringify(id)}. Work-unit ids become fragment filenames ` +
        `under ${FRAGMENTS_DIR}/, so they must contain only letters, digits and hyphens (no "/", "..", or ` +
        "whitespace). Fix profile.json and re-run `arkaik bootstrap plan`.",
    );
  }
}

/**
 * Build the manifest for this repo. `previous` (when given) carries unit
 * statuses forward so re-planning after recon never loses completed work —
 * but only for a unit whose title/scope/slice is unchanged from the last
 * plan. If the profile edited an area's paths (or an era's slug) since then,
 * the old fragment on disk was written against the old definition; carrying
 * `done` forward would let `merge` consume that stale output with no signal
 * anything is wrong, so the unit resets to `pending` instead.
 */
export function planUnits(options: {
  mode: Manifest["mode"];
  bundle: string;
  profile: Profile | null;
  previous: Manifest | null;
}): Manifest {
  const { mode, bundle, profile, previous } = options;

  for (const area of profile?.areas ?? []) assertSafeId("area", area.id);
  for (const era of profile?.eras ?? []) assertSafeId("era", era.slug);

  const units: WorkUnit[] = [unit("w0-recon", 0, "Recon", RECON_SCOPE, { docs: true })];

  for (const area of profile?.areas ?? []) {
    units.push(
      unit(
        `w1-${area.id}`,
        1,
        `Anatomy — ${area.title}`,
        mode === "brownfield"
          ? `Reconcile the existing map for ${area.title} against the code. Emit add/update/retire; never delete.`
          : `Map the anatomy of ${area.title}: flows, views, data models, API endpoints, and the edges between them.`,
        { paths: area.paths },
      ),
    );
  }

  for (const area of profile?.areas ?? []) {
    units.push(
      unit(
        `w2-${area.id}`,
        2,
        `Acceptances — ${area.title}`,
        `Write acceptances for ${area.title}: one Given/When/Then each, 1-3 value elements, covers edges to real nodes, ` +
          `platform scoping per the platform axis in profile.json.`,
        { paths: area.paths },
      ),
    );
  }

  for (const era of profile?.eras ?? []) {
    units.push(
      unit(
        `w3-${era.slug}`,
        3,
        `Story — ${era.title}`,
        `Turn this era's user-visible PRs into deliverables and tag the era as a release. A PR with a Lab Note is ` +
          `user-visible by definition; judge the rest.`,
        { eras: [era.slug] },
      ),
    );
  }

  // Gated on recon having run at all, not on eras existing: the decisions
  // unit mines design docs and the status-arc unit arcs anatomy nodes,
  // neither of which reads era boundaries. A profile with real areas but
  // zero eras (a young repo, or one recon judged has no story worth
  // splitting yet) should still get both — gating on `eras.length` silently
  // dropped decision-mining and status arcs for exactly that repo shape.
  if (profile) {
    units.push(
      unit("w3-decisions", 3, "Story — decisions", "Mine decisions from the design docs; emit DEC- nodes, their edges, and their events.", {
        docs: true,
      }),
      unit("w3-status-arcs", 3, "Story — status arcs", "Give each anatomy node an honest 1-3 event status arc ending at its snapshot status.", {
        docs: false,
      }),
    );
  }

  // Ids come from profile.json (area ids, era slugs) alongside two hardcoded
  // wave-3 ids ("decisions", "status-arcs"). Any collision — two areas
  // sharing an id, two eras sharing a slug, or an era slug landing on one of
  // the reserved wave-3 names — would mint two units pointing at the same
  // fragment file, silently losing whichever agent's output the other one's
  // write clobbers. Catch it here, not when `merge` finds a fragment that
  // doesn't match the unit that supposedly produced it.
  const seen = new Set<string>();
  for (const u of units) {
    if (seen.has(u.id)) {
      throw new Error(
        `duplicate work-unit id "${u.id}" — check profile.json for a repeated area id or era slug (or one that ` +
          'collides with the reserved "decisions" / "status-arcs" era names).',
      );
    }
    seen.add(u.id);
  }

  const previousById = new Map((previous?.units ?? []).map((u) => [u.id, u]));
  for (const u of units) {
    const before = previousById.get(u.id);
    if (!before) continue;
    const sameDefinition =
      before.title === u.title && before.scope === u.scope && JSON.stringify(before.slice) === JSON.stringify(u.slice);
    if (sameDefinition) u.status = before.status;
  }

  return { version: 1, mode, bundle, units };
}
```

- [ ] **Step 4: Wire the subcommand**

In `packages/cli/src/commands/bootstrap.ts` add. `existsSync` (node:fs) and `path` (node:path) are already imported by Task 2's corpus wiring, and `fail`/`nextValue` by the same task — don't add second copies:

```ts
import { detectMode, planUnits, readManifest, readProfile, writeManifest } from "../lib/bootstrap/manifest";

const PLAN_USAGE = `arkaik bootstrap plan [options]

Emit the work-unit manifest at .arkaik/bootstrap/manifest.json. With no recon
profile only the wave-0 recon unit is planned; re-run after recon writes
profile.json to expand waves 1-3. Existing unit statuses are preserved for
units whose scope/slice is unchanged since the last plan.

Options:
  --bundle <path>  Bundle to bootstrap (default: docs/arkaik/bundle.json).
  -h, --help       Show this help.`;

function runPlan(argv: string[]): void {
  const cwd = process.cwd();
  // A literal, not path.join: this value is written into manifest.json by
  // writeManifest, so it must not become `docs\arkaik\bundle.json` on Windows.
  // Every other command in this CLI spells it the same way (init.ts:36,
  // pack.ts:38, push.ts:54, sync.ts:59, open.ts:35, release.ts:30).
  let bundle = "docs/arkaik/bundle.json";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(PLAN_USAGE);
      process.exit(0);
    } else if (arg === "--bundle") {
      bundle = nextValue(argv, ++i, "--bundle", PLAN_USAGE);
    } else {
      fail(`Unknown option: ${arg}\n\n${PLAN_USAGE}`);
    }
  }

  try {
    const mode = detectMode(cwd, bundle);
    const manifest = planUnits({ mode, bundle, profile: readProfile(cwd), previous: readManifest(cwd) });
    writeManifest(cwd, manifest);

    const pending = manifest.units.filter((u) => u.status === "pending").length;
    console.log(`Planned ${manifest.units.length} units (${pending} pending) in ${mode} mode.`);
    for (const u of manifest.units) console.log(`  [${u.status}] w${u.wave} ${u.id} — ${u.title}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Add `case "plan": runPlan(rest); return;` to the switch. Note `mode` detection and `planUnits` both now throw on bad input (an unparseable bundle, an unsafe or duplicate unit id) — both are caught by the `try`/`catch` above rather than left to crash the process uncaught.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: PASS on all 71 checks (39 from Tasks 1–2 + 32 from Task 3).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/bootstrap/manifest.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): bootstrap plan — resumable work-unit manifest"
```

---

### Task 4: `bootstrap slice` and `bootstrap index`

These two are the token levers: a slice is what one agent reads instead of the whole corpus; an index is what it reads instead of the whole bundle.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/slice.ts`
- Create: `packages/cli/src/lib/bootstrap/index-view.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-plan.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the `try` block:

```js
  // --- slice ---
  const slice = runCli(["bootstrap", "slice", "w1-home"], dir);
  check("slice exits 0", slice.status === 0, slice.stderr);
  const sliced = JSON.parse(slice.stdout);
  check("slice carries the unit scope", typeof sliced.scope === "string" && sliced.scope.length > 0, slice.stdout);
  check("slice matched the home PR", sliced.prs.length === 1 && sliced.prs[0].number === 1, JSON.stringify(sliced.prs));
  check("slice excluded the chore PR", !sliced.prs.some((p) => p.number === 2), JSON.stringify(sliced.prs));
  check("slice lists matching surfaces", sliced.surfaces.some((s) => s.path === "app/home/page.tsx"), JSON.stringify(sliced.surfaces));
  check("slice omits docs unless asked", sliced.docs === undefined, JSON.stringify(sliced.docs));

  const reconSlice = JSON.parse(runCli(["bootstrap", "slice", "w0-recon"], dir).stdout);
  check("docs unit gets the docs manifest", Array.isArray(reconSlice.docs), JSON.stringify(reconSlice.docs));

  const badSlice = runCli(["bootstrap", "slice", "no-such-unit"], dir);
  check("unknown unit exits 1", badSlice.status === 1, String(badSlice.status));

  // --- index ---
  const bundleDir = path.join(dir, "docs", "arkaik");
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    path.join(bundleDir, "bundle.json"),
    JSON.stringify({
      schema_version: 3,
      project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
      nodes: [
        { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"], metadata: { product: "app" } },
        { id: "F-onboarding", project_id: "demo", species: "flow", title: "Onboarding", status: "live", platforms: ["web"] },
      ],
      edges: [],
    }),
  );
  const idx = runCli(["bootstrap", "index"], dir);
  check("index exits 0", idx.status === 0, idx.stderr);
  check("index lists the view with its product", idx.stdout.includes("V-home\tview\tHome\tapp"), idx.stdout);
  check("index lists the flow with no product", idx.stdout.includes("F-onboarding\tflow\tOnboarding\t-"), idx.stdout);
  check("index is one line per node plus header", idx.stdout.trim().split("\n").length === 3, idx.stdout);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-plan.test.js`
Expected: FAIL — "Unknown bootstrap subcommand: slice".

- [ ] **Step 3: Write `slice.ts`**

Create `packages/cli/src/lib/bootstrap/slice.ts`:

```ts
/**
 * Resolve exactly the corpus subset one work unit needs.
 *
 * This is the method's primary token lever: an agent reads ~30-60KB of its own
 * slice instead of the whole mined corpus. Path matching is prefix-based on
 * repo-relative POSIX paths — a unit that owns `app/home` gets every PR that
 * touched anything beneath it.
 */
import { existsSync, readFileSync } from "node:fs";

import type { CorpusDoc, CorpusPr, CorpusSurface } from "./corpus";
import { readCorpusPrs } from "./corpus";
import type { WorkUnit } from "./manifest";
import { at, DOCS_FILE, SURFACES_FILE } from "./paths";

export interface Slice {
  unit: string;
  wave: number;
  scope: string;
  fragment: string;
  prs: CorpusPr[];
  surfaces: CorpusSurface[];
  docs?: CorpusDoc[];
}

function readJsonArray<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** True when `filePath` sits at or beneath any of `paths`. */
export function matchesPaths(filePath: string, paths: readonly string[]): boolean {
  return paths.some((p) => filePath === p || filePath.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export function resolveSlice(cwd: string, unit: WorkUnit): Slice {
  const paths = unit.slice.paths ?? [];
  const allPrs = readCorpusPrs(cwd);
  const surfaces = readJsonArray<CorpusSurface>(at(cwd, SURFACES_FILE));

  // A unit with no paths (recon, decisions, eras) is not path-filtered: the
  // era units want their whole date window, and recon wants the shape of
  // everything. Path filtering exists for the per-area waves.
  const prs = paths.length > 0 ? allPrs.filter((pr) => pr.files.some((f) => matchesPaths(f, paths))) : allPrs;

  const slice: Slice = {
    unit: unit.id,
    wave: unit.wave,
    scope: unit.scope,
    fragment: unit.fragment,
    prs,
    surfaces: paths.length > 0 ? surfaces.filter((s) => matchesPaths(s.path, paths)) : surfaces,
  };

  if (unit.slice.docs) slice.docs = readJsonArray<CorpusDoc>(at(cwd, DOCS_FILE));

  return slice;
}
```

- [ ] **Step 4: Write `index-view.ts`**

Create `packages/cli/src/lib/bootstrap/index-view.ts`:

```ts
/**
 * A compact listing of the current map: id, species, title, product — one
 * tab-separated line per node.
 *
 * An agent that must reference existing nodes (every brownfield reconcile unit,
 * every acceptance unit writing `covers` edges) needs their ids, not their
 * bodies. For a 173-node map this is a few KB against a 164KB bundle.
 */
interface IndexNode {
  id?: unknown;
  species?: unknown;
  title?: unknown;
  metadata?: { product?: unknown } | null;
}

export function renderIndex(bundle: { nodes?: unknown }): string {
  const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as IndexNode[]) : [];
  const lines = ["id\tspecies\ttitle\tproduct"];
  for (const node of nodes) {
    const product = node.metadata && typeof node.metadata === "object" ? node.metadata.product : undefined;
    lines.push(
      [String(node.id ?? ""), String(node.species ?? ""), String(node.title ?? ""), product ? String(product) : "-"].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 5: Wire both subcommands**

In `packages/cli/src/commands/bootstrap.ts` add:

```ts
import { readBundle } from "../lib/bundle-io";
import { renderIndex } from "../lib/bootstrap/index-view";
import { resolveSlice } from "../lib/bootstrap/slice";

function runSlice(argv: string[]): void {
  const cwd = process.cwd();
  const unitId = argv[0];
  if (unitId === undefined || unitId === "-h" || unitId === "--help") {
    console.log("arkaik bootstrap slice <unit>\n\nPrint the corpus subset one work unit needs, as JSON.");
    process.exit(unitId === undefined ? 1 : 0);
  }

  const manifest = readManifest(cwd);
  if (!manifest) {
    console.error("No manifest. Run `arkaik bootstrap plan` first.");
    process.exit(1);
  }
  const unit = manifest.units.find((u) => u.id === unitId);
  if (!unit) {
    console.error(`Unknown unit: ${unitId}\nKnown units: ${manifest.units.map((u) => u.id).join(", ")}`);
    process.exit(1);
  }

  console.log(JSON.stringify(resolveSlice(cwd, unit), null, 2));
}

function runIndex(argv: string[]): void {
  if (argv[0] === "-h" || argv[0] === "--help") {
    console.log("arkaik bootstrap index [path]\n\nPrint a compact id/species/title/product listing of the map.");
    process.exit(0);
  }
  const target = argv[0] ?? path.join("docs", "arkaik", "bundle.json");
  try {
    process.stdout.write(renderIndex(readBundle(path.resolve(process.cwd(), target)) as { nodes?: unknown }));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Add both cases to the switch: `case "slice": runSlice(rest); return;` and `case "index": runIndex(rest); return;`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: PASS on every check in the file.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/bootstrap/slice.ts packages/cli/src/lib/bootstrap/index-view.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): bootstrap slice + index — the two token levers"
```

---

### Task 5: Deterministic event ids

`makeEvent` mints a random ULID, which would make merge output differ run to run. Bootstrap constructs history, so its event ids must be a pure function of what the event *is*.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/event-id.ts`
- Test: `tests/cli/bootstrap-merge.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/bootstrap-merge.test.js`:

```js
#!/usr/bin/env node

/**
 * Exercises `arkaik bootstrap merge` — fragment assembly onto a bundle:
 * ID uniqueness, cross-fragment edge resolution, reconcile ops, journal
 * construction, and byte-identical determinism across runs.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
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

/** A repo with a manifest, an empty-ish bundle, and the given fragments. */
function scaffold(fragments, bundle) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-merge-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  mkdirSync(path.join(dir, ".arkaik", "bootstrap", "fragments"), { recursive: true });
  if (bundle) writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle));
  const units = Object.keys(fragments).map((id) => ({
    id,
    wave: Number(id[1]) || 1,
    title: id,
    scope: "",
    slice: {},
    fragment: `.arkaik/bootstrap/fragments/${id}.json`,
    status: "pending",
  }));
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "manifest.json"),
    JSON.stringify({ version: 1, mode: bundle ? "brownfield" : "greenfield", bundle: "docs/arkaik/bundle.json", units }),
  );
  for (const [id, fragment] of Object.entries(fragments)) {
    writeFileSync(path.join(dir, ".arkaik", "bootstrap", "fragments", `${id}.json`), JSON.stringify(fragment));
  }
  return dir;
}

const BASE = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [],
  edges: [],
};

// --- deterministic event ids ---
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [
        { id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"], created_ts: "2026-01-02T10:00:00.000Z" },
      ],
      edges: [],
    },
  }, BASE);
  try {
    const first = runCli(["bootstrap", "merge"], dir);
    check("merge exits 0", first.status === 0, first.stderr);
    const bundleA = readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8");
    const journalA = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8");

    runCli(["bootstrap", "merge"], dir);
    const bundleB = readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8");
    const journalB = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8");

    check("bundle output is byte-identical across runs", bundleA === bundleB, "bundle differed");
    check("journal output is byte-identical across runs", journalA === journalB, "journal differed");

    const events = journalA.trim().split("\n").map((l) => JSON.parse(l));
    check("node.created synthesized", events.length === 1 && events[0].type === "node.created", journalA);
    check("node.created uses the fragment's created_ts", events[0].ts === "2026-01-02T10:00:00.000Z", events[0].ts);
    check("event id is ULID-shaped", /^[0-9A-HJKMNP-TV-Z]{26}$/.test(events[0].id), events[0].id);
    check("created_ts is not persisted onto the node", !("created_ts" in JSON.parse(bundleA).nodes[0]), bundleA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-merge.test.js`
Expected: FAIL — "Unknown bootstrap subcommand: merge".

- [ ] **Step 3: Write `event-id.ts`**

Create `packages/cli/src/lib/bootstrap/event-id.ts`:

```ts
/**
 * Deterministic, ULID-shaped event ids.
 *
 * `@arkaik/schema`'s `ulid()` mints a random component, which is right for live
 * writes and wrong here: bootstrap CONSTRUCTS history, and re-running a merge
 * over unchanged fragments must produce a byte-identical journal. So the id is
 * a pure function of (timestamp, key): the standard 10-character Crockford
 * base32 time prefix, then 16 characters derived from a hash of the key.
 *
 * The envelope only requires a string (`id: z.string()`), but keeping the ULID
 * shape preserves the property everything downstream assumes — ids sort in
 * time order.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(ms: number): string {
  let remaining = Math.max(0, Math.floor(ms));
  let out = "";
  for (let i = 0; i < TIME_LEN; i += 1) {
    out = ENCODING[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A stable id for the event identified by `key` at `ts`. Two different keys at
 * the same timestamp get different ids; the same pair always gets the same id.
 */
export function deterministicEventId(ts: string, key: string): string {
  const ms = Date.parse(ts);
  let h = fnv1a(key);
  let random = "";
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    random += ENCODING[h % 32];
    h = (Math.imul(h ^ (h >>> 13), 0x01000193) >>> 0) || 0x811c9dc5;
  }
  return encodeTime(Number.isNaN(ms) ? 0 : ms) + random;
}
```

- [ ] **Step 4: Run the id test in isolation**

There is no separate unit test for this file; it is proven by the determinism checks in Task 6. Move on — the next task makes these checks pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/bootstrap/event-id.ts tests/cli/bootstrap-merge.test.js
git commit -m "feat(cli): deterministic ULID-shaped event ids for bootstrap merge"
```

---

### Task 6: `bootstrap merge` — fragments, nodes, edges, journal

**Files:**
- Create: `packages/cli/src/lib/bootstrap/fragments.ts`
- Create: `packages/cli/src/lib/bootstrap/merge.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-merge.test.js`

- [ ] **Step 1: Write `fragments.ts`**

Create `packages/cli/src/lib/bootstrap/fragments.ts`:

```ts
/**
 * The fragment contract — the file boundary where agents meet the CLI.
 *
 * An agent never reads the bundle and never writes it. It writes one of these,
 * and `merge` owns everything else: ID uniqueness, edge endpoint resolution,
 * journal construction, ordering. Shapes are checked here so a malformed
 * fragment fails with the unit's name attached rather than corrupting a merge.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Manifest, WorkUnit } from "./manifest";

/** A node as an agent writes it: no project_id, plus an optional `created_ts`. */
export interface FragmentNode extends Record<string, unknown> {
  id: string;
  species: string;
  title: string;
  /** When this surface first shipped — becomes the `node.created` ts. */
  created_ts?: string;
}

export interface FragmentEdge extends Record<string, unknown> {
  source_id: string;
  target_id: string;
  kind: string;
}

export interface Fragment {
  unit: string;
  wave: number;
  /** Greenfield anatomy / acceptance output. */
  nodes?: FragmentNode[];
  edges?: FragmentEdge[];
  /** Brownfield reconcile output. */
  add?: FragmentNode[];
  update?: Array<{ id: string; patch: Record<string, unknown> }>;
  retire?: Array<{ id: string; reason: string }>;
  /** Story output. */
  events?: Array<Record<string, unknown>>;
}

export interface LoadedFragment {
  unit: WorkUnit;
  fragment: Fragment;
}

export interface FragmentProblem {
  unit: string;
  message: string;
}

export interface FragmentLoad {
  loaded: LoadedFragment[];
  problems: FragmentProblem[];
  missing: string[];
}

function isArrayOfObjects(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null));
}

/** Load every fragment named by the manifest. Absent files are reported, not fatal. */
export function loadFragments(cwd: string, manifest: Manifest): FragmentLoad {
  const loaded: LoadedFragment[] = [];
  const problems: FragmentProblem[] = [];
  const missing: string[] = [];

  for (const unit of manifest.units) {
    const file = path.join(cwd, unit.fragment);
    if (!existsSync(file)) {
      missing.push(unit.id);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      problems.push({ unit: unit.id, message: `not valid JSON: ${err instanceof Error ? err.message : "parse error"}` });
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      problems.push({ unit: unit.id, message: "fragment must be a JSON object" });
      continue;
    }
    const fragment = parsed as Fragment;
    for (const key of ["nodes", "edges", "add", "update", "retire", "events"] as const) {
      if (!isArrayOfObjects(fragment[key])) {
        problems.push({ unit: unit.id, message: `\`${key}\` must be an array of objects` });
      }
    }
    loaded.push({ unit, fragment });
  }

  return { loaded, problems, missing };
}
```

- [ ] **Step 2: Write `merge.ts`**

Create `packages/cli/src/lib/bootstrap/merge.ts`:

```ts
/**
 * Deterministic fragment assembly.
 *
 * Everything an agent must not have to think about lives here: ID uniqueness
 * across independently-written fragments, edge endpoint resolution, the
 * `node.created` events the validator requires, reconcile ops, journal order.
 *
 * Two rules shape the whole file:
 *  - **Bootstrap never deletes.** `retire` sets `status: archived` and records
 *    a reason; removal stays a human act, which is what makes re-runs safe.
 *  - **Merging is pure.** Same fragments in, byte-identical bundle out —
 *    hence `deterministicEventId` rather than a random ULID.
 */
import { edgeId } from "@arkaik/schema";

import { deterministicEventId } from "./event-id";
import type { Fragment, LoadedFragment } from "./fragments";

export interface MergeProblem {
  unit: string;
  message: string;
}

export interface MergeResult {
  bundle: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  errors: MergeProblem[];
  counts: { nodesAdded: number; nodesUpdated: number; nodesRetired: number; edgesAdded: number; eventsAdded: number };
}

type AnyRecord = Record<string, unknown>;

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

/** Sort events by ts, then id — the same total order `orderEvents` gives. */
function sortEvents(events: AnyRecord[]): AnyRecord[] {
  return [...events].sort((a, b) => {
    const at = String(a.ts ?? "");
    const bt = String(b.ts ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    const ai = String(a.id ?? "");
    const bi = String(b.id ?? "");
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

export interface MergeInput {
  base: AnyRecord;
  baseJournal: AnyRecord[];
  fragments: readonly LoadedFragment[];
  /** Fallback `node.created` timestamp when a fragment supplies no `created_ts`. */
  fallbackTs: string;
}

export function mergeFragments(input: MergeInput): MergeResult {
  const errors: MergeProblem[] = [];
  const projectId = String((input.base.project as AnyRecord | undefined)?.id ?? "");

  const nodes = new Map<string, AnyRecord>();
  const nodeOrigin = new Map<string, string>();
  for (const node of asArray(input.base.nodes)) nodes.set(String(node.id), { ...node });

  const edges = new Map<string, AnyRecord>();
  for (const edge of asArray(input.base.edges)) {
    edges.set(String(edge.id ?? edgeId(String(edge.source_id), String(edge.target_id))), { ...edge });
  }

  const newEvents: AnyRecord[] = [];
  const counts = { nodesAdded: 0, nodesUpdated: 0, nodesRetired: 0, edgesAdded: 0, eventsAdded: 0 };

  // --- pass 1: nodes (every fragment, so edges in pass 2 can see all of them)
  for (const { unit, fragment } of input.fragments) {
    for (const raw of [...(fragment.nodes ?? []), ...(fragment.add ?? [])]) {
      const id = String(raw.id ?? "");
      if (!id) {
        errors.push({ unit: unit.id, message: "a node has no id" });
        continue;
      }
      const { created_ts: createdTs, ...node } = raw;
      if (nodes.has(id)) {
        const existingTitle = String(nodes.get(id)?.title ?? "");
        const incomingTitle = String(node.title ?? "");
        const owner = nodeOrigin.get(id);
        if (owner && existingTitle !== incomingTitle) {
          // Two agents minted the same id for different things. Never union
          // them silently — print both titles and fail the merge.
          errors.push({
            unit: unit.id,
            message: `id collision on \`${id}\`: "${existingTitle}" (from ${owner}) vs "${incomingTitle}"`,
          });
        }
        continue;
      }
      nodes.set(id, { ...node, id, project_id: projectId });
      nodeOrigin.set(id, unit.id);
      counts.nodesAdded += 1;

      const ts = typeof createdTs === "string" && createdTs ? createdTs : input.fallbackTs;
      newEvents.push({
        id: deterministicEventId(ts, `node.created:${id}`),
        ts,
        actor: "bootstrap",
        type: "node.created",
        node_id: id,
        species: node.species,
        title: node.title,
      });
    }

    for (const patch of fragment.update ?? []) {
      const id = String(patch.id ?? "");
      const target = nodes.get(id);
      if (!target) {
        errors.push({ unit: unit.id, message: `update targets unknown node \`${id}\`` });
        continue;
      }
      Object.assign(target, patch.patch ?? {}, { id, project_id: projectId });
      counts.nodesUpdated += 1;
    }

    for (const retire of fragment.retire ?? []) {
      const id = String(retire.id ?? "");
      const target = nodes.get(id);
      if (!target) {
        errors.push({ unit: unit.id, message: `retire targets unknown node \`${id}\`` });
        continue;
      }
      // Never a delete: archived, with the reason kept on the node.
      target.status = "archived";
      const metadata = (target.metadata as AnyRecord | undefined) ?? {};
      target.metadata = { ...metadata, retired_reason: retire.reason };
      counts.nodesRetired += 1;
    }
  }

  // --- pass 2: edges, now that every node id is known
  for (const { unit, fragment } of input.fragments) {
    for (const raw of fragment.edges ?? []) {
      const source = String(raw.source_id ?? "");
      const target = String(raw.target_id ?? "");
      if (!nodes.has(source) || !nodes.has(target)) {
        errors.push({
          unit: unit.id,
          message: `edge ${source} -> ${target} references ${!nodes.has(source) ? source : target}, which no fragment created`,
        });
        continue;
      }
      const id = edgeId(source, target);
      if (edges.has(id)) continue;
      edges.set(id, { ...raw, id, project_id: projectId, source_id: source, target_id: target });
      counts.edgesAdded += 1;
    }
  }

  // --- pass 3: story events
  for (const { unit, fragment } of input.fragments) {
    for (const raw of fragment.events ?? []) {
      const type = String(raw.type ?? "");
      const ts = String(raw.ts ?? "");
      if (!type || !ts) {
        errors.push({ unit: unit.id, message: "an event is missing `type` or `ts`" });
        continue;
      }
      const key = `${type}:${String(raw.node_id ?? raw.deliverable_id ?? raw.version ?? "")}:${ts}`;
      newEvents.push({ ...raw, id: raw.id ?? deterministicEventId(ts, key), ts, type });
    }
  }

  counts.eventsAdded = newEvents.length;

  // Existing history is preserved verbatim; new events are merged in and the
  // whole file is written in ts order. Nothing is ever rewritten or dropped.
  const journal = sortEvents([...input.baseJournal, ...newEvents]);

  const bundle: AnyRecord = {
    ...input.base,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
  delete bundle.journal;

  return { bundle, journal, errors, counts };
}
```

- [ ] **Step 3: Wire the subcommand**

In `packages/cli/src/commands/bootstrap.ts` add:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { serializeBundle } from "@arkaik/schema";
import { loadFragments } from "../lib/bootstrap/fragments";
import { mergeFragments } from "../lib/bootstrap/merge";
import { journalPathFor, readJournalEvents } from "../lib/journal-io";

const MERGE_USAGE = `arkaik bootstrap merge [options]

Assemble every fragment named by the manifest onto the bundle: verify ID
uniqueness, resolve edge endpoints, apply reconcile ops, synthesize the
required node.created events, and write the bundle plus its journal sidecar.

Options:
  --dry-run    Report what would change; write nothing.
  -h, --help   Show this help.`;

function runMerge(argv: string[]): void {
  const cwd = process.cwd();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(MERGE_USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      console.error(`Unknown option: ${arg}\n\n${MERGE_USAGE}`);
      process.exit(1);
    }
  }

  const manifest = readManifest(cwd);
  if (!manifest) {
    console.error("No manifest. Run `arkaik bootstrap plan` first.");
    process.exit(1);
  }

  const bundlePath = path.resolve(cwd, manifest.bundle);
  const base = existsSync(bundlePath)
    ? (JSON.parse(readFileSync(bundlePath, "utf8")) as Record<string, unknown>)
    : {
        schema_version: 3,
        project: {
          id: path.basename(cwd),
          title: path.basename(cwd),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        nodes: [],
        edges: [],
      };

  const journalPath = journalPathFor(bundlePath);
  const baseJournal = existsSync(journalPath)
    ? (readJournalEvents(journalPath) as unknown as Array<Record<string, unknown>>)
    : [];

  const { loaded, problems, missing } = loadFragments(cwd, manifest);
  for (const problem of problems) console.error(`fragment ${problem.unit}: ${problem.message}`);
  if (problems.length > 0) process.exit(1);

  const fallbackTs = String((base.project as Record<string, unknown>).created_at ?? new Date().toISOString());
  const result = mergeFragments({ base, baseJournal, fragments: loaded, fallbackTs });

  for (const error of result.errors) console.error(`merge ${error.unit}: ${error.message}`);
  if (result.errors.length > 0) process.exit(1);

  const project = result.bundle.project as Record<string, unknown>;
  const lastTs = result.journal.length > 0 ? String(result.journal[result.journal.length - 1].ts) : undefined;
  result.bundle.project = { ...project, updated_at: lastTs ?? project.updated_at };

  const serialized = serializeBundle(result.bundle as never);
  const journalText = result.journal.map((e) => JSON.stringify(e)).join("\n") + (result.journal.length ? "\n" : "");

  if (!dryRun) {
    writeFileSync(bundlePath, serialized);
    writeFileSync(journalPath, journalText);
  }

  console.log(`${dryRun ? "[dry-run] " : ""}Merged ${loaded.length} fragments:`);
  console.log(
    `  +${result.counts.nodesAdded} nodes, ~${result.counts.nodesUpdated} updated, ` +
      `${result.counts.nodesRetired} retired, +${result.counts.edgesAdded} edges, +${result.counts.eventsAdded} events`,
  );
  console.log(`  bundle ${(Buffer.byteLength(serialized) / 1024).toFixed(0)}KB, journal ${result.journal.length} events`);
  if (missing.length > 0) console.log(`  ${missing.length} units have no fragment yet: ${missing.join(", ")}`);
  console.log(`Next: arkaik validate ${manifest.bundle}`);
}
```

Add `case "merge": runMerge(rest); return;` to the switch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-merge.test.js`
Expected: PASS on all seven checks in the determinism block.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/bootstrap/fragments.ts packages/cli/src/lib/bootstrap/merge.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-merge.test.js
git commit -m "feat(cli): bootstrap merge — deterministic fragment assembly"
```

---

### Task 7: Merge semantics — collisions, orphan edges, reconcile

**Files:**
- Test: `tests/cli/bootstrap-merge.test.js`

- [ ] **Step 1: Write the failing tests**

Append before `process.exit(...)` in `tests/cli/bootstrap-merge.test.js`:

```js
// --- id collision across fragments ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "V-settings", species: "view", title: "Settings" }], edges: [] },
    "w1-b": { unit: "w1-b", wave: 1, nodes: [{ id: "V-settings", species: "view", title: "Account settings" }], edges: [] },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("id collision exits 1", res.status === 1, String(res.status));
    check("collision names both titles", res.stderr.includes("Settings") && res.stderr.includes("Account settings"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- same id, same title across fragments is a no-op, not an error ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "V-home", species: "view", title: "Home" }], edges: [] },
    "w1-b": { unit: "w1-b", wave: 1, nodes: [{ id: "V-home", species: "view", title: "Home" }], edges: [] },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("identical re-declaration is accepted", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check("node appears exactly once", bundle.nodes.filter((n) => n.id === "V-home").length === 1, JSON.stringify(bundle.nodes));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- cross-fragment edges resolve; orphans fail ---
{
  const dir = scaffold({
    "w1-a": { unit: "w1-a", wave: 1, nodes: [{ id: "F-onboarding", species: "flow", title: "Onboarding" }], edges: [] },
    "w1-b": {
      unit: "w1-b",
      wave: 1,
      nodes: [{ id: "V-welcome", species: "view", title: "Welcome" }],
      edges: [{ source_id: "F-onboarding", target_id: "V-welcome", kind: "composes" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("cross-fragment edge resolves", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    check("edge id is canonical", bundle.edges[0].id === "e-F-onboarding-V-welcome", JSON.stringify(bundle.edges));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [{ id: "F-onboarding", species: "flow", title: "Onboarding" }],
      edges: [{ source_id: "F-onboarding", target_id: "V-ghost", kind: "composes" }],
    },
  }, BASE);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("orphan edge exits 1", res.status === 1, String(res.status));
    check("orphan error names the missing endpoint", res.stderr.includes("V-ghost"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- brownfield reconcile: update patches, retire archives, nothing is deleted ---
{
  const existing = {
    ...BASE,
    nodes: [
      { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "development", platforms: ["web"] },
      { id: "V-legacy", project_id: "demo", species: "view", title: "Legacy", status: "live", platforms: ["web"] },
    ],
  };
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      update: [{ id: "V-home", patch: { status: "live" } }],
      retire: [{ id: "V-legacy", reason: "replaced by V-home" }],
    },
  }, existing);
  try {
    const res = runCli(["bootstrap", "merge"], dir);
    check("reconcile exits 0", res.status === 0, res.stderr);
    const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
    const home = bundle.nodes.find((n) => n.id === "V-home");
    const legacy = bundle.nodes.find((n) => n.id === "V-legacy");
    check("update applied the patch", home.status === "live", JSON.stringify(home));
    check("retire archived rather than deleted", legacy && legacy.status === "archived", JSON.stringify(legacy));
    check("retire recorded the reason", legacy.metadata.retired_reason === "replaced by V-home", JSON.stringify(legacy.metadata));
    check("node count unchanged by retire", bundle.nodes.length === 2, String(bundle.nodes.length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- existing journal history is preserved and re-sorted, never dropped ---
{
  const dir = scaffold({
    "w1-a": {
      unit: "w1-a",
      wave: 1,
      nodes: [{ id: "V-late", species: "view", title: "Late", created_ts: "2026-06-01T00:00:00.000Z" }],
      edges: [],
    },
  }, { ...BASE, nodes: [{ id: "V-old", project_id: "demo", species: "view", title: "Old", status: "live", platforms: ["web"] }] });
  try {
    writeFileSync(
      path.join(dir, "docs", "arkaik", "journal.jsonl"),
      `${JSON.stringify({ id: "01AAAAAAAAAAAAAAAAAAAAAAAA", ts: "2026-03-01T00:00:00.000Z", type: "node.created", node_id: "V-old", species: "view", title: "Old" })}\n`,
    );
    const res = runCli(["bootstrap", "merge"], dir);
    check("merge with existing journal exits 0", res.status === 0, res.stderr);
    const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("existing event preserved", events.some((e) => e.node_id === "V-old"), JSON.stringify(events));
    check("new event appended", events.some((e) => e.node_id === "V-late"), JSON.stringify(events));
    check("journal is ts-ordered", events[0].ts < events[1].ts, JSON.stringify(events.map((e) => e.ts)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Run to verify they pass**

Run: `node tests/cli/bootstrap-merge.test.js`
Expected: PASS on every check. The merge implementation from Task 6 already covers these paths; if any fails, fix `merge.ts` rather than the test.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/bootstrap-merge.test.js
git commit -m "test(cli): merge collisions, orphan edges, reconcile, journal preservation"
```

---

### Task 8: `plan --issues`

**Files:**
- Modify: `packages/cli/src/lib/bootstrap/manifest.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-plan.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the `try` block of `tests/cli/bootstrap-plan.test.js`:

```js
  // --- issues mode renders one issue body per pending unit ---
  const issues = runCli(["bootstrap", "plan", "--issues", "--print"], dir);
  check("plan --issues --print exits 0", issues.status === 0, issues.stderr);
  const rendered = JSON.parse(issues.stdout);
  check("one issue per unit", rendered.length >= 5, String(rendered.length));
  const homeIssue = rendered.find((i) => i.title.includes("w1-home"));
  check("issue title names the unit", Boolean(homeIssue), issues.stdout);
  check("issue body tells the agent how to slice", homeIssue.body.includes("arkaik bootstrap slice w1-home"), homeIssue.body);
  check("issue body names the fragment path", homeIssue.body.includes(".arkaik/bootstrap/fragments/w1-home.json"), homeIssue.body);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-plan.test.js`
Expected: FAIL — "Unknown option: --issues".

- [ ] **Step 3: Add the renderer**

Append to `packages/cli/src/lib/bootstrap/manifest.ts`:

```ts
export interface RenderedIssue {
  unit: string;
  title: string;
  body: string;
}

/**
 * One GitHub issue per pending unit — the alternate output mode.
 *
 * Same manifest, different driver: durable and parallel across machines, at
 * the cost of a cold-start context tax per unit that in-session fan-out does
 * not pay. Nothing about the fragment contract changes.
 */
export function renderIssues(manifest: Manifest): RenderedIssue[] {
  return manifest.units
    .filter((u) => u.status === "pending")
    .map((u) => ({
      unit: u.id,
      title: `[bootstrap] ${u.id} — ${u.title}`,
      body: [
        `**Wave ${u.wave}.** ${u.scope}`,
        "",
        "### How to work this unit",
        "",
        "```bash",
        `arkaik bootstrap slice ${u.id} > slice.json`,
        "```",
        "",
        `Read \`slice.json\`, then write your fragment to \`${u.fragment}\`.`,
        "Do not edit the bundle. Do not edit another unit's fragment.",
        "",
        "The `arkaik-bootstrap` skill defines the fragment contract and the",
        "judgment rules for this wave. When the fragment is written, set this",
        `unit's status to \`done\` in \`${MANIFEST_FILE}\`.`,
      ].join("\n"),
    }));
}
```

- [ ] **Step 4: Wire the flags**

In `runPlan` in `packages/cli/src/commands/bootstrap.ts`, add `renderIssues` to the manifest import, declare the flags alongside `bundle`:

```ts
  let issues = false;
  let print = false;
```

Add the two branches to the flag loop, before the `else` that errors:

```ts
    } else if (arg === "--issues") {
      issues = true;
    } else if (arg === "--print") {
      print = true;
```

And replace the trailing summary block with:

```ts
  if (issues) {
    const rendered = renderIssues(manifest);
    if (print) {
      console.log(JSON.stringify(rendered, null, 2));
      return;
    }
    for (const issue of rendered) {
      const res = spawnSync("gh", ["issue", "create", "--title", issue.title, "--body", issue.body], {
        cwd,
        encoding: "utf8",
      });
      if (res.status !== 0) {
        console.error(`gh issue create failed for ${issue.unit}: ${res.stderr.trim()}`);
        process.exit(1);
      }
      console.log(`Filed ${issue.unit}: ${res.stdout.trim()}`);
    }
    return;
  }

  const pending = manifest.units.filter((u) => u.status === "pending").length;
  console.log(`Planned ${manifest.units.length} units (${pending} pending) in ${mode} mode.`);
  for (const u of manifest.units) console.log(`  [${u.status}] w${u.wave} ${u.id} — ${u.title}`);
```

Add `import { spawnSync } from "node:child_process";` at the top of the file.

Extend `PLAN_USAGE` with:

```
  --issues         File one GitHub issue per pending unit instead of driving in-session.
  --print          With --issues, print the rendered issues as JSON instead of filing them.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js`
Expected: PASS on every check.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/bootstrap/manifest.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): bootstrap plan --issues, the alternate driver"
```

---

### Task 9: Golden end-to-end + CI wiring + PR 1

**Files:**
- Create: `tests/cli/bootstrap-e2e.test.js`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the end-to-end test**

Create `tests/cli/bootstrap-e2e.test.js`:

```js
#!/usr/bin/env node

/**
 * The regression test for the METHOD, not for one command: a tiny fixture repo
 * driven corpus -> plan -> recon profile -> plan -> fragments -> merge ->
 * validate, exactly as a real bootstrap run goes.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
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

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-e2e-"));
try {
  // A 5-PR, 3-surface fixture repo.
  mkdirSync(path.join(dir, "app", "home"), { recursive: true });
  mkdirSync(path.join(dir, "app", "settings"), { recursive: true });
  mkdirSync(path.join(dir, "app", "api", "notes"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "app", "home", "page.tsx"), "export default function Home() {}\n");
  writeFileSync(path.join(dir, "app", "settings", "page.tsx"), "export default function Settings() {}\n");
  writeFileSync(path.join(dir, "app", "api", "notes", "route.ts"), "export async function GET() {}\n");
  writeFileSync(path.join(dir, "docs", "vision.md"), "# Vision\n\nA place for notes.\n");

  const prs = [
    { number: 1, title: "Home screen", body: "## Lab Note\n\n```yaml\nen:\n  title: \"Home\"\n```", mergedAt: "2026-01-05T10:00:00Z", labels: [], files: [{ path: "app/home/page.tsx" }] },
    { number: 2, title: "Notes API", body: "", mergedAt: "2026-01-10T10:00:00Z", labels: [], files: [{ path: "app/api/notes/route.ts" }] },
    { number: 3, title: "Settings screen", body: "", mergedAt: "2026-02-02T10:00:00Z", labels: [], files: [{ path: "app/settings/page.tsx" }] },
    { number: 4, title: "chore: deps", body: "", mergedAt: "2026-02-03T10:00:00Z", labels: [], files: [{ path: "package.json" }] },
    { number: 5, title: "Settings polish", body: "", mergedAt: "2026-02-10T10:00:00Z", labels: [], files: [{ path: "app/settings/page.tsx" }] },
  ];
  writeFileSync(path.join(dir, "gh.json"), JSON.stringify(prs));

  check("corpus", runCli(["bootstrap", "corpus", "--from-json", "gh.json"], dir).status === 0, "corpus failed");
  check("first plan", runCli(["bootstrap", "plan"], dir).status === 0, "plan failed");

  // Wave 0 output, as the recon agent would write it.
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "notes", title: "Notes" }],
      platforms: ["web"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home"] },
        { id: "settings", title: "Settings", paths: ["app/settings"] },
        { id: "api", title: "API", paths: ["app/api"] },
      ],
      eras: [{ slug: "first-light", title: "First light" }],
    }),
  );
  check("second plan expands", runCli(["bootstrap", "plan"], dir).status === 0, "re-plan failed");

  // Wave 1-2 output, as area agents would write it.
  const frag = (name, body) =>
    writeFileSync(path.join(dir, ".arkaik", "bootstrap", "fragments", `${name}.json`), JSON.stringify(body));

  frag("w1-home", {
    unit: "w1-home",
    wave: 1,
    nodes: [
      { id: "F-notes", species: "flow", title: "Notes", status: "live", platforms: ["web"], created_ts: "2026-01-05T10:00:00.000Z", metadata: { playlist: ["V-home"] } },
      { id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"], created_ts: "2026-01-05T10:00:00.000Z" },
    ],
    edges: [{ source_id: "F-notes", target_id: "V-home", kind: "composes" }],
  });
  frag("w1-settings", {
    unit: "w1-settings",
    wave: 1,
    nodes: [{ id: "V-settings", species: "view", title: "Settings", status: "live", platforms: ["web"], created_ts: "2026-02-02T10:00:00.000Z" }],
    edges: [],
  });
  frag("w1-api", {
    unit: "w1-api",
    wave: 1,
    nodes: [{ id: "A-get-notes", species: "api-endpoint", title: "GET /api/notes", status: "live", platforms: ["web"], created_ts: "2026-01-10T10:00:00.000Z" }],
    edges: [{ source_id: "V-home", target_id: "A-get-notes", kind: "calls" }],
  });

  const merged = runCli(["bootstrap", "merge"], dir);
  check("merge exits 0", merged.status === 0, merged.stderr);
  check("merge reports the bundle size", merged.stdout.includes("KB"), merged.stdout);

  const validated = runCli(["validate", path.join("docs", "arkaik", "bundle.json")], dir);
  check("validate exits 0 on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);

  const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
  check("all four nodes landed", bundle.nodes.length === 4, JSON.stringify(bundle.nodes.map((n) => n.id)));
  check("cross-fragment edge landed", bundle.edges.some((e) => e.id === "e-V-home-A-get-notes"), JSON.stringify(bundle.edges));

  const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n");
  check("one node.created per node", events.length === 4, String(events.length));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-e2e.test.js`
Expected: PASS on all eight checks. If `validate` fails, read its findings — the fixture must satisfy playlist↔`composes` coherence, which is why `F-notes` carries `metadata.playlist`.

- [ ] **Step 3: Wire the test script**

In `package.json`, add after the `test:cli` entry:

```json
    "test:bootstrap": "npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js && node tests/cli/bootstrap-merge.test.js && node tests/cli/bootstrap-e2e.test.js",
```

- [ ] **Step 4: Wire CI**

In `.github/workflows/ci.yml`, add a step immediately after the `test:cli` step, matching the surrounding style:

```yaml
      - name: Bootstrap method tests
        run: npm run test:bootstrap
```

- [ ] **Step 5: Verify the whole gate**

Run: `npm run test:bootstrap && npm run lint && npm run validate:seeds`
Expected: all three exit 0. `lint` may print pre-existing errors in files this work did not touch — the bar is no new error in `packages/cli/src/**` or `tests/cli/**`.

- [ ] **Step 6: Commit and open PR 1**

```bash
git add package.json .github/workflows/ci.yml tests/cli/bootstrap-e2e.test.js
git commit -m "test: golden end-to-end bootstrap run + CI wiring"
git push -u origin HEAD
```

Open the PR with this body section:

````markdown
## Lab Note

```yaml
en:
  title: "Map an existing codebase in one pass"
  summary: "Arkaik can now read a whole repository — its screens, its APIs, its merged pull requests — and build the map for you, instead of you drawing it node by node."
fr:
  title: "Cartographie ton dépôt en une passe"
  summary: "Arkaik lit maintenant tout ton dépôt — écrans, APIs, pull requests fusionnées — et construit la carte à ta place, au lieu de te la faire dessiner nœud par nœud."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
````

After opening, read the PR's comments — the Lab Note reminder posts there and clears itself once the body is right.

---

# Part B — PR 2: hosted restore

### Task 10: The pure decision rules

Every rule that decides *whether* a restore may proceed lives in pure functions, because this machine has no Postgres and untested SQL-adjacent logic is where the risk actually sits.

**Files:**
- Create: `lib/services/graph/restore.ts`
- Test: `tests/services/graph-restore.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/services/graph-restore.test.js`:

```js
#!/usr/bin/env node

/**
 * The pure half of hosted restore: optimistic-concurrency matching and the
 * delta a caller sees before a destructive replace. No database involved —
 * these are the rules, not the SQL.
 */

const { versionMatches, computeBundleDelta } = require("../../lib/services/graph/restore.ts");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

// --- versionMatches ---
check("exact match passes", versionMatches("v7", "v7") === true);
check("quoted header matches", versionMatches('"v7"', "v7") === true);
check("mismatch fails", versionMatches("v6", "v7") === false);
check("missing If-Match fails closed", versionMatches(undefined, "v7") === false);
check("empty If-Match fails closed", versionMatches("", "v7") === false);
check("wildcard is not accepted", versionMatches("*", "v7") === false);

// --- computeBundleDelta ---
const prev = {
  nodes: [{ id: "V-a", title: "A" }, { id: "V-b", title: "B" }],
  edges: [{ id: "e-1" }],
  journal: [{ id: "01A" }],
};
const next = {
  nodes: [{ id: "V-a", title: "A renamed" }, { id: "V-c", title: "C" }],
  edges: [{ id: "e-1" }, { id: "e-2" }],
  journal: [{ id: "01A" }, { id: "01B" }],
};
const delta = computeBundleDelta(prev, next);
check("added nodes counted", delta.nodesAdded === 1, JSON.stringify(delta));
check("removed nodes counted", delta.nodesRemoved === 1, JSON.stringify(delta));
check("changed nodes counted", delta.nodesChanged === 1, JSON.stringify(delta));
check("added edges counted", delta.edgesAdded === 1, JSON.stringify(delta));
check("removed edges counted", delta.edgesRemoved === 0, JSON.stringify(delta));
check("added events counted", delta.eventsAdded === 1, JSON.stringify(delta));
check("dropped events counted", delta.eventsDropped === 0, JSON.stringify(delta));

const shrinking = computeBundleDelta(next, prev);
check("a restore that drops history is visible", shrinking.eventsDropped === 1, JSON.stringify(shrinking));

process.exit(failures === 0 ? 0 : 1);
```

Note: this repo's service tests are plain CommonJS against TypeScript sources; follow whatever loader `tests/services/*.test.js` already uses (check `tests/services/auth-guard.test.js` and mirror its import style exactly — if it imports a compiled path or uses a register hook, do the same here).

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/services/graph-restore.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `restore.ts`**

Create `lib/services/graph/restore.ts`:

```ts
/**
 * The rules a hosted restore obeys, as pure functions.
 *
 * A restore replaces a project's snapshot AND its journal wholesale — the only
 * way mined history can reach a hosted project, because the mutation path
 * derives its events server-side and cannot express a backdated one. That makes
 * it the one destructive verb in the graph API, so its guards live here where
 * they can be tested without a database.
 */

/**
 * Optimistic concurrency: the caller must state which version it read.
 *
 * Fails CLOSED. A missing, empty, or wildcard `If-Match` is a mismatch, never a
 * pass — "replace whatever is there" is exactly the operation this endpoint
 * must not offer.
 */
export function versionMatches(ifMatch: string | undefined | null, current: string): boolean {
  if (!ifMatch) return false;
  const normalized = ifMatch.trim().replace(/^"|"$/g, "");
  if (normalized === "" || normalized === "*") return false;
  return normalized === current;
}

export interface BundleDelta {
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  eventsAdded: number;
  eventsDropped: number;
}

interface Identified {
  id?: unknown;
}

function byId(list: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const id = (item as Identified)?.id;
    if (typeof id === "string") map.set(id, item);
  }
  return map;
}

/**
 * What a restore would do, in counts — what `--dry-run` prints and what a
 * human reads before authorising a replace. `eventsDropped` is the one to
 * watch: history is append-only by contract, so a non-zero value means the
 * inbound bundle is missing events the server already holds.
 */
export function computeBundleDelta(
  prev: { nodes?: unknown; edges?: unknown; journal?: unknown },
  next: { nodes?: unknown; edges?: unknown; journal?: unknown },
): BundleDelta {
  const prevNodes = byId(prev.nodes);
  const nextNodes = byId(next.nodes);
  const prevEdges = byId(prev.edges);
  const nextEdges = byId(next.edges);
  const prevEvents = byId(prev.journal);
  const nextEvents = byId(next.journal);

  let nodesChanged = 0;
  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id);
    if (before && JSON.stringify(before) !== JSON.stringify(node)) nodesChanged += 1;
  }

  const countMissing = (from: Map<string, unknown>, into: Map<string, unknown>): number => {
    let n = 0;
    for (const id of from.keys()) if (!into.has(id)) n += 1;
    return n;
  };

  return {
    nodesAdded: countMissing(nextNodes, prevNodes),
    nodesRemoved: countMissing(prevNodes, nextNodes),
    nodesChanged,
    edgesAdded: countMissing(nextEdges, prevEdges),
    edgesRemoved: countMissing(prevEdges, nextEdges),
    eventsAdded: countMissing(nextEvents, prevEvents),
    eventsDropped: countMissing(prevEvents, nextEvents),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/services/graph-restore.test.js`
Expected: PASS on all fifteen checks.

- [ ] **Step 5: Wire the script and CI**

In `package.json`:

```json
    "test:graph-restore": "node tests/services/graph-restore.test.js",
```

In `.github/workflows/ci.yml`, after the `test:graph` step:

```yaml
      - name: Graph restore rules
        run: npm run test:graph-restore
```

- [ ] **Step 6: Commit**

```bash
git add lib/services/graph/restore.ts tests/services/graph-restore.test.js package.json .github/workflows/ci.yml
git commit -m "feat(graph): pure rules for hosted bundle restore"
```

---

### Task 11: `replaceProjectBundle` + the PUT route

**Files:**
- Modify: `lib/services/graph/store.ts`
- Create: `app/api/graph/projects/[projectId]/bundle/route.ts`

- [ ] **Step 1: Add the store function**

Append to `lib/services/graph/store.ts`, after `applyMutation`:

```ts
export interface ReplaceProjectBundleInput {
  projectId: string;
  ownerIds: readonly string[];
  /** A full ProjectBundle from the client, already parsed as JSON. */
  bundle: unknown;
  /** The version the caller read. A mismatch is refused. */
  ifMatch: string | undefined;
  tier: string;
}

export type ReplaceResult =
  | { ok: true; version: string; delta: BundleDelta }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; current: string }
  | { ok: false; reason: "validation"; errors: ValidationFinding[] }
  | { ok: false; reason: "limit"; limit: number; actual: number; tier: string };

/**
 * Replace a hosted project's snapshot AND journal wholesale.
 *
 * The mutation path derives journal events from the diff it applies, which is
 * why it cannot express a backdated `node.status_changed` or a
 * `deliverable.shipped` mined from a merged PR. Bootstrap constructs exactly
 * that history offline, so it needs a verb that accepts a finished bundle.
 *
 * The bundle gets the FULL inbound gate — shape, vocabulary migration, and
 * semantic rules with the journal included — the same one `createProject`
 * applies, and for the same reason: the bundle and its history both arrive
 * from outside and neither can be trusted.
 */
export async function replaceProjectBundle(input: ReplaceProjectBundleInput): Promise<ReplaceResult> {
  const validation = validateInboundBundle(input.bundle);
  if (!validation.ok) return { ok: false, reason: "validation", errors: validation.findings };

  const bundle = validation.bundle;
  const limits = getHostedLimitsForTier(input.tier);
  const count = entityCount(bundle.nodes, bundle.edges);
  if (count > limits.entities) {
    return { ok: false, reason: "limit", limit: limits.entities, actual: count, tier: input.tier };
  }

  const { journal = [], ...snapshot } = bundle;

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ snapshot: SnapshotShape; version: string }>(
      `select snapshot, version from graph_projects
        where id = $1 and owner_id = any($2::text[]) and archived_at is null
        for update`,
      [input.projectId, input.ownerIds as string[]],
    );
    const current = rows[0];
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (!versionMatches(input.ifMatch, current.version)) {
      return { ok: false, reason: "conflict", current: current.version } as const;
    }

    const previousJournal = await loadJournalRows(client, input.projectId);
    const delta = computeBundleDelta(
      { ...current.snapshot, journal: previousJournal },
      { ...snapshot, journal },
    );

    const version = randomBytes(8).toString("hex");
    await client.query(
      `update graph_projects
          set snapshot = $2, version = $3, entity_count = $4, title = $5, updated_at = now()
        where id = $1`,
      [input.projectId, snapshot, version, count, String((snapshot as SnapshotShape).project?.title ?? "")],
    );
    await replaceJournalRows(client, input.projectId, journal);

    return { ok: true, version, delta } as const;
  });
}
```

Add the imports at the top of the file:

```ts
import { computeBundleDelta, versionMatches, type BundleDelta } from "@/lib/services/graph/restore";
```

**Two helpers this depends on:** `loadJournalRows(client, projectId)` and `replaceJournalRows(client, projectId, events)`. Read how `createProject` and `getJournal` already read and write the journal table in this file, and write these two as thin siblings using the same table name, column names, and ordering. Do not invent a new shape — mirror what is there. If `createProject` inserts journal rows inline, extract that insert into `replaceJournalRows` and call it from both, so there is one writer.

- [ ] **Step 2: Write the route**

Create `app/api/graph/projects/[projectId]/bundle/route.ts`:

```ts
import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { getUserTier, replaceProjectBundle } from "@/lib/services/graph/store";

/**
 * PUT /api/graph/projects/{projectId}/bundle — replace snapshot + journal.
 *
 * The landing path for a bootstrapped map. `POST .../mutations` stays the write
 * path for ordinary edits; this exists only because mined history cannot be
 * expressed as mutations — the journal there is derived, not supplied.
 *
 * Destructive by construction, so: `If-Match` is REQUIRED (no wildcard), the
 * caller must own the project, and `arkaik restore` writes a local backup
 * before it ever calls this.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;
  const ifMatch = req.headers.get("if-match") ?? undefined;
  if (!ifMatch) {
    return Response.json(
      { error: "if_match_required", message: "Send If-Match with the version you read." },
      { status: 428 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const tier = await getUserTier(caller.userId);
    const result = await replaceProjectBundle({
      projectId,
      ownerIds: caller.ownerIds,
      bundle: (body as { bundle?: unknown })?.bundle ?? body,
      ifMatch,
      tier,
    });

    if (result.ok) {
      return Response.json(
        { version: result.version, delta: result.delta },
        { status: 200, headers: { ETag: `"${result.version}"` } },
      );
    }
    if (result.reason === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
    if (result.reason === "conflict") {
      return Response.json(
        { error: "conflict", message: "The project changed since you read it.", current: result.current },
        { status: 412 },
      );
    }
    if (result.reason === "limit") {
      return Response.json(
        { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
        { status: 413 },
      );
    }
    return Response.json({ error: "invalid_bundle", findings: result.errors }, { status: 422 });
  } catch (err) {
    console.error("[graph] PUT bundle failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to replace the bundle." }, { status: 500 });
  }
}
```

Check `getCaller`'s return shape before using `caller.userId` — mirror exactly how the mutations route obtains the tier (`getUserTier(...)` there is called with whatever field that route uses).

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors in `lib/services/graph/*` or `app/api/graph/**`.

- [ ] **Step 4: Commit**

```bash
git add lib/services/graph/store.ts app/api/graph/projects/\[projectId\]/bundle/route.ts
git commit -m "feat(graph): PUT /bundle — owner-only, If-Match-gated whole-bundle restore"
```

---

### Task 12: `arkaik restore`

**Files:**
- Create: `packages/cli/src/commands/restore.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `tests/cli/bootstrap-restore.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/bootstrap-restore.test.js`:

```js
#!/usr/bin/env node

/**
 * `arkaik restore` against a stub server: it must export the current hosted
 * state to a local backup BEFORE sending, refuse to proceed when it cannot
 * write that backup, send If-Match, and surface a 412 as a clear conflict.
 */

const { spawnSync } = require("child_process");
const http = require("http");
const { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

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

const HOSTED = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-old", project_id: "demo", species: "view", title: "Old", status: "live", platforms: ["web"] }],
  edges: [],
  journal: [],
};

const LOCAL = {
  ...HOSTED,
  nodes: [
    HOSTED.nodes[0],
    { id: "V-new", project_id: "demo", species: "view", title: "New", status: "live", platforms: ["web"] },
  ],
};

const received = [];
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.endsWith("/export")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ bundle: HOSTED }));
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ETag: '"v1"' });
    res.end(JSON.stringify({ bundle: HOSTED, version: "v1" }));
    return;
  }
  if (req.method === "PUT") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ ifMatch: req.headers["if-match"], body: JSON.parse(body) });
      if (req.headers["if-match"] !== '"v1"') {
        res.writeHead(412, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "conflict", current: "v1" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "v2", delta: { nodesAdded: 1 } }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  const api = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-restore-"));
  const env = { ...process.env, ARKAIK_TOKEN: "test-token" };
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: dir, env });

  try {
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo", remote: api }));
    writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(LOCAL));

    // --- dry run sends nothing ---
    const dry = run(["restore", "--dry-run", "--api", api]);
    check("dry-run exits 0", dry.status === 0, dry.stderr);
    check("dry-run sent no PUT", received.length === 0, JSON.stringify(received));
    check("dry-run reports the delta", dry.stdout.includes("nodesAdded") || dry.stdout.includes("+1 node"), dry.stdout);

    // --- real restore backs up first, then sends If-Match ---
    const real = run(["restore", "--api", api]);
    check("restore exits 0", real.status === 0, real.stderr);
    check("one PUT sent", received.length === 1, String(received.length));
    check("If-Match carried the read version", received[0].ifMatch === '"v1"', String(received[0].ifMatch));
    check("body carried the local bundle", received[0].body.bundle.nodes.length === 2, JSON.stringify(received[0].body.bundle.nodes));

    const backups = readdirSync(path.join(dir, "docs", "arkaik", ".backups"));
    check("a backup was written before sending", backups.length === 1, JSON.stringify(backups));
    const backup = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", ".backups", backups[0]), "utf8"));
    check("the backup holds the PRE-restore hosted state", backup.nodes.length === 1, JSON.stringify(backup.nodes));

    // --- refuses when the backup cannot be written ---
    const locked = mkdtempSync(path.join(tmpdir(), "arkaik-restore-locked-"));
    mkdirSync(path.join(locked, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(locked, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_demo", remote: api }));
    writeFileSync(path.join(locked, "docs", "arkaik", "bundle.json"), JSON.stringify(LOCAL));
    mkdirSync(path.join(locked, "docs", "arkaik", ".backups"));
    chmodSync(path.join(locked, "docs", "arkaik", ".backups"), 0o500);
    const before = received.length;
    const blocked = spawnSync(process.execPath, [CLI, "restore", "--api", api], { encoding: "utf8", cwd: locked, env });
    check("unwritable backup dir refuses", blocked.status === 1, String(blocked.status));
    check("nothing was sent when the backup failed", received.length === before, String(received.length));
    chmodSync(path.join(locked, "docs", "arkaik", ".backups"), 0o700);
    rmSync(locked, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-restore.test.js`
Expected: FAIL — the CLI does not know the `restore` command.

- [ ] **Step 3: Write `restore.ts`**

Create `packages/cli/src/commands/restore.ts`:

```ts
/**
 * `arkaik restore [--dry-run] [--api <base-url>] [path]`
 *
 * Land a locally-built bundle — history included — on the hosted project this
 * repo is linked to. The one destructive verb the CLI offers, so it is fenced:
 *
 *  1. read the link file for the project id and remote;
 *  2. GET the project for its current version, and GET its export;
 *  3. write that export to `docs/arkaik/.backups/<ts>-bundle.json` and REFUSE
 *     to continue if that write fails — a restore you cannot undo is not one
 *     this command will perform;
 *  4. print the delta; stop here on `--dry-run`;
 *  5. PUT the local bundle with `If-Match` set to the version read in step 2.
 *
 * A 412 means someone edited the project since step 2. That is not an error to
 * retry blindly — re-run and read the new delta.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const USAGE = `arkaik restore [options] [path]

Replace the linked hosted project's bundle AND journal with a local bundle.

Options:
  --dry-run          Report the delta; send nothing.
  --api <base-url>   Override the remote from docs/arkaik/arkaik.json.
  -h, --help         Show this help.

Environment:
  ARKAIK_TOKEN       Required. Create one at <origin>/settings/tokens.`;

const LINK_FILE = path.join("docs", "arkaik", "arkaik.json");

export interface RestoreOptions {
  httpClient?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export async function runRestore(argv: string[], options: RestoreOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let dryRun = false;
  let apiOverride: string | undefined;
  let bundleArg: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--api") {
      apiOverride = argv[++i];
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      bundleArg = arg;
    }
  }

  const linkPath = path.join(cwd, LINK_FILE);
  if (!existsSync(linkPath)) fail(`No ${LINK_FILE}. Run \`arkaik link\` first — restore only targets hosted projects.`);
  const link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  const projectId = link.project_id;
  if (!projectId) fail(`${LINK_FILE} has no project_id.`);
  const baseUrl = (apiOverride ?? link.remote ?? "https://arkaik.app").replace(/\/$/, "");

  const token = env.ARKAIK_TOKEN;
  if (!token) fail(`ARKAIK_TOKEN is not set. Create a token at ${baseUrl}/settings/tokens and export it.`);

  const bundlePath = path.resolve(cwd, bundleArg ?? path.join("docs", "arkaik", "bundle.json"));
  if (!existsSync(bundlePath)) fail(`No bundle at ${bundlePath}.`);
  const local = JSON.parse(readFileSync(bundlePath, "utf8")) as Record<string, unknown>;

  const journalPath = path.join(path.dirname(bundlePath), "journal.jsonl");
  if (existsSync(journalPath)) {
    local.journal = readFileSync(journalPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const projectRes = await doFetch(`${baseUrl}/api/graph/projects/${projectId}`, { headers });
  if (!projectRes.ok) fail(`Could not read the project (${projectRes.status}). Check ARKAIK_TOKEN and the project id.`);
  const { version } = (await projectRes.json()) as { version: string };

  const exportRes = await doFetch(`${baseUrl}/api/graph/projects/${projectId}/export`, { headers });
  if (!exportRes.ok) fail(`Could not export the current project (${exportRes.status}). Refusing to restore without a backup.`);
  const { bundle: current } = (await exportRes.json()) as { bundle: unknown };

  const backupDir = path.join(path.dirname(bundlePath), ".backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${stamp}-bundle.json`);
  try {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    writeFileSync(backupPath, `${JSON.stringify(current, null, 2)}\n`);
  } catch (err) {
    fail(
      `Could not write the pre-restore backup to ${backupPath}: ${err instanceof Error ? err.message : String(err)}\n` +
        `Refusing to restore — this verb replaces the hosted project's snapshot and journal.`,
    );
  }
  console.log(`Backed up the current hosted project to ${path.relative(cwd, backupPath)}`);

  if (dryRun) {
    const currentBundle = current as { nodes?: unknown[]; edges?: unknown[]; journal?: unknown[] };
    const nodes = Array.isArray(local.nodes) ? local.nodes.length : 0;
    const edges = Array.isArray(local.edges) ? local.edges.length : 0;
    const events = Array.isArray(local.journal) ? local.journal.length : 0;
    console.log("[dry-run] would replace the hosted bundle:");
    console.log(`  nodes  ${currentBundle.nodes?.length ?? 0} -> ${nodes} (nodesAdded ${nodes - (currentBundle.nodes?.length ?? 0)})`);
    console.log(`  edges  ${currentBundle.edges?.length ?? 0} -> ${edges}`);
    console.log(`  events ${currentBundle.journal?.length ?? 0} -> ${events}`);
    console.log("[dry-run] nothing sent.");
    return;
  }

  const res = await doFetch(`${baseUrl}/api/graph/projects/${projectId}/bundle`, {
    method: "PUT",
    headers: { ...headers, "If-Match": `"${version}"` },
    body: JSON.stringify({ bundle: local }),
  });

  if (res.status === 412) {
    const body = (await res.json()) as { current?: string };
    fail(
      `Conflict — the project changed since this run read version ${version} (now ${body.current ?? "unknown"}).\n` +
        `Nothing was written. Re-run to read the new state; your backup is at ${path.relative(cwd, backupPath)}.`,
    );
  }
  if (res.status === 422) {
    const body = (await res.json()) as { findings?: Array<{ message?: string }> };
    console.error("The bundle was rejected by the server's validator:");
    for (const finding of body.findings ?? []) console.error(`  ${finding.message ?? JSON.stringify(finding)}`);
    process.exit(1);
  }
  if (!res.ok) fail(`Restore failed (${res.status}): ${await res.text()}`);

  const body = (await res.json()) as { version: string; delta: Record<string, number> };
  console.log(`Restored. New version ${body.version}.`);
  console.log(`  ${JSON.stringify(body.delta)}`);
}
```

- [ ] **Step 4: Wire the dispatcher**

In `packages/cli/src/index.ts`, import and add the case. Because `runRestore` is async, mirror however the dispatcher already handles async commands (`runPushCli`, `runLinkCli`) — match that exact pattern, including its error handling:

```ts
import { runRestore } from "./commands/restore";
```

```ts
    case "restore":
      void runRestore(rest);
      return;
```

And in `USAGE`, after the `link` line:

```
  restore [options] [path]   Replace the linked hosted project's bundle + journal (backs up first).
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-restore.test.js`
Expected: PASS on all ten checks.

- [ ] **Step 6: Wire the script and open PR 2**

In `package.json`, extend the bootstrap script:

```json
    "test:bootstrap": "npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js && node tests/cli/bootstrap-merge.test.js && node tests/cli/bootstrap-e2e.test.js && node tests/cli/bootstrap-restore.test.js",
```

```bash
npm run test:bootstrap && npm run test:graph-restore && npm run lint
git add packages/cli/src/commands/restore.ts packages/cli/src/index.ts tests/cli/bootstrap-restore.test.js package.json
git commit -m "feat(cli): arkaik restore — backup, dry-run, If-Match"
git push
```

PR 2 body:

````markdown
## Lab Note

```yaml
en:
  title: "Bring a whole history to a hosted map"
  summary: "A map you built offline — every screen and every past release — can now land on your hosted project in one step, and Arkaik saves a copy of what was there before it does."
fr:
  title: "Amène tout un historique vers une carte hébergée"
  summary: "Une carte construite hors ligne — chaque écran, chaque release passée — peut maintenant rejoindre ton projet hébergé en une étape, et Arkaik garde une copie de l'état précédent avant de le faire."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
````

---

# Part C — PR 3: the skill and its wiring

### Task 13: The `arkaik-bootstrap` skill

**Files:**
- Create: `plugin/skills/arkaik-bootstrap/skill.md`
- Create: `plugin/skills/arkaik-bootstrap/references/fragments.md`
- Create: `plugin/skills/arkaik-bootstrap/references/waves.md`

- [ ] **Step 1: Read the sibling skill first**

Read `plugin/skills/arkaik/skill.md` (and `docs/arkaik-skill/skill.md`) end to end before writing a line. The new skill must match its frontmatter shape, its template-parameter convention (`{{PRODUCT_NAME}}`, `{{BUNDLE_PATH}}`), its `version` stamp, and its voice. Do not restate what the maintenance skill already teaches — link to it.

- [ ] **Step 2: Write `skill.md`**

Create `plugin/skills/arkaik-bootstrap/skill.md` with frontmatter mirroring the sibling's shape (`name: arkaik-bootstrap`, `version: 1.0.0`, a `description` that fires on "map this repo", "bootstrap the map", "retro-populate", "backfill the map"), and a body covering exactly these sections:

1. **When this skill applies** — a one-time onboarding run, greenfield or brownfield. Ongoing edits belong to the `arkaik` skill. Say so explicitly, and say that this skill can be removed after the run (`arkaik init --remove-bootstrap`).
2. **The contract you work under** — you never read the bundle, you never write the bundle, you never write merge logic. You read a slice, you write a fragment. Include the two commands verbatim:
   ```bash
   arkaik bootstrap slice <unit> > slice.json   # what to read
   arkaik bootstrap index                        # existing node ids, when you need to reference them
   ```
3. **Species discrimination** — flow vs view vs data model vs API endpoint, with the concept-vs-physical-table `DM-` rule (`DM-project` the concept, `DM-projects` the table) spelled out with both examples.
4. **Playlists** — every flow ships a real `metadata.playlist`; it must agree with its `composes` edges and stay cycle-free.
5. **Acceptances** — one Given/When/Then in `metadata.gherkin`; `covers` edges to real anchors; single-product anchoring.
6. **Values** — 1–3 Bain elements; most specific element wins; a higher tier only when genuinely earned. Point at `references/values.md` in the sibling skill rather than restating the table.
7. **Platform scoping** — `AC-x@ios` and the trap in bold: **an unscoped promotion claims every platform.** Scope to the fewest platforms that are true.
8. **What counts as user-visible** — a PR with a Lab Note is user-visible by definition; chores, CI and refactors are not; judge the rest and say why in the fragment's `notes`.
9. **Status arcs** — 1–3 events per node, ending at the node's snapshot status. Never invent a transition that did not happen.
10. **Never delete** — `retire` with a reason; a human decides removal.

- [ ] **Step 3: Write `references/fragments.md`**

Document the fragment contract exactly as `packages/cli/src/lib/bootstrap/fragments.ts` defines it — the wave-1/2 shape (`nodes`/`edges`, or `add`/`update`/`retire`), the wave-3 shape (`events`), and `created_ts`. Include one complete, valid example of each, copied from the fixtures in `tests/cli/bootstrap-e2e.test.js` so the two cannot drift.

- [ ] **Step 4: Write `references/waves.md`**

The wave catalog (0 recon → 1 anatomy/reconcile → 2 acceptances+values → 3 story) and one reviewer checklist per wave. The wave-2 checklist must include the values-balance check: **if more than half the acceptances land on one value element, the wave is rejected and re-run** — an unchecked acceptance wave collapses into ~90% `simplifies`. The wave-1 brownfield checklist must include the churn guard: **a unit proposing retire/update on more than 20% of existing nodes stops for human review.**

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/arkaik-bootstrap
git commit -m "feat(skill): arkaik-bootstrap — the judgment half of the method"
```

---

### Task 14: `init --bootstrap` / `--remove-bootstrap`

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Test: `tests/cli/init.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/init.test.js`, following the file's existing helper names and dir setup:

```js
// --- bootstrap skill installs on demand and removes cleanly ---
{
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-init-bootstrap-"));
  try {
    const plain = runCli(["init", "--product", "Demo"], dir);
    check("plain init exits 0", plain.status === 0, plain.stderr);
    check(
      "plain init does NOT install the bootstrap skill",
      !existsSync(path.join(dir, ".claude", "skills", "arkaik-bootstrap")),
      "bootstrap skill was installed without being asked for",
    );

    const withBootstrap = runCli(["init", "--product", "Demo", "--bootstrap"], dir);
    check("init --bootstrap exits 0", withBootstrap.status === 0, withBootstrap.stderr);
    check(
      "bootstrap skill installed",
      existsSync(path.join(dir, ".claude", "skills", "arkaik-bootstrap", "skill.md")),
      "skill.md missing",
    );
    check(
      "bootstrap references installed",
      existsSync(path.join(dir, ".claude", "skills", "arkaik-bootstrap", "references", "fragments.md")),
      "references missing",
    );

    const removed = runCli(["init", "--remove-bootstrap"], dir);
    check("init --remove-bootstrap exits 0", removed.status === 0, removed.stderr);
    check(
      "bootstrap skill removed",
      !existsSync(path.join(dir, ".claude", "skills", "arkaik-bootstrap")),
      "skill dir still present",
    );
    check(
      "the maintenance skill survives removal",
      existsSync(path.join(dir, ".claude", "skills", "arkaik", "skill.md")),
      "maintenance skill was collateral damage",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

Adjust the skills path (`.claude/skills/...`) to whatever `init.ts`'s `DEFAULT_SKILLS_DIR` actually is — read it first and use that constant's value.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/init.test.js`
Expected: FAIL — "Unknown option: --bootstrap".

- [ ] **Step 3: Implement**

In `packages/cli/src/commands/init.ts`:

1. Add `--bootstrap` and `--remove-bootstrap` to `USAGE`, described as *"install (or remove) the one-time bootstrap skill; it is not installed by default because it is a large skill for a one-time job."*
2. Parse both flags in the existing flag loop, beside `--update` and `--no-values`.
3. When `--bootstrap` is set, render `plugin/skills/arkaik-bootstrap/**` into the skills dir using the **same** renderer the maintenance skill already goes through — template substitution and version stamping included. Do not hand-roll a second copy path.
4. When `--remove-bootstrap` is set, remove only the `arkaik-bootstrap` directory (`rmSync(..., { recursive: true, force: true })`) and print what was removed. Never touch the `arkaik` skill.
5. `--remove-bootstrap` on a repo that has no bootstrap skill prints a notice and exits 0 — removal is idempotent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/init.test.js`
Expected: PASS, including the pre-existing checks in that file.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts tests/cli/init.test.js
git commit -m "feat(cli): init --bootstrap / --remove-bootstrap"
```

---

### Task 15: The human-facing method doc + PR 3

**Files:**
- Create: `docs/bootstrap.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/bootstrap.md`**

A human's walkthrough of one run, in this order, with the exact commands:

```bash
arkaik init --update                       # brownfield: get the current skill first
arkaik init --bootstrap                    # install the one-time skill
arkaik bootstrap corpus                    # mine PRs, docs, surfaces
arkaik bootstrap plan                      # wave 0 only
# ... recon agent writes .arkaik/bootstrap/profile.json ...
arkaik bootstrap plan                      # expands waves 1-3
arkaik bootstrap slice w1-home             # what one agent reads
# ... agents write fragments ...
arkaik bootstrap merge
arkaik validate docs/arkaik/bundle.json    # the gate — warning-clean
arkaik restore --dry-run                   # hosted only
arkaik restore
arkaik init --remove-bootstrap             # the skill has done its job
```

Cover: the two modes; why the CLI owns determinism; the token model (slices, index, warm subagents, the `--issues` trade-off); the wave gates; that `.arkaik/` is scratch and gitignored; and that restore is destructive, `If-Match`-gated, and always backs up first.

**One thing this doc must say plainly:** the first run in a brownfield repo needs `arkaik init --update` *before* anything else, because repo-local validators reject the `acceptance` and `decision` species until the skill is current.

- [ ] **Step 2: Link it from the README**

Add one line to `README.md`'s docs list, matching the surrounding format:

```markdown
- [Bootstrap](docs/bootstrap.md) — onboarding an existing repo onto Arkaik in one run.
```

- [ ] **Step 3: Full verification**

Run each and confirm each exits 0:

```bash
npm run test:bootstrap
npm run test:graph-restore
npm run test:cli
npm run validate:seeds
npm run lint
```

`lint` may report pre-existing errors on `main`; the bar is no new error in a file this branch touched. If any command fails, fix it before opening the PR — do not open with a red gate.

- [ ] **Step 4: Commit and open PR 3**

```bash
git add docs/bootstrap.md README.md
git commit -m "docs: the bootstrap method, for humans"
git push
```

PR 3 body:

````markdown
## Lab Note

```yaml
en:
  title: "A guided way to map a codebase you already have"
  summary: "Point Arkaik at an existing project and it walks you through mapping it — what to look at first, what to write down, and when you are done. Once the map exists, the guide steps out of the way."
fr:
  title: "Une méthode guidée pour cartographier un projet existant"
  summary: "Pointe Arkaik vers un projet existant et il t'accompagne pour le cartographier : par quoi commencer, quoi noter, et quand c'est terminé. Une fois la carte prête, le guide s'efface."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
````

---

## After this plan

**The Pebbles run is not in this plan** — it is an execution of what this plan ships, and it gets its own run doc once PR 3 lands. Its sequence is fixed in the spec (§ 8): `arkaik init --update` first, then corpus over 324 merged PRs, recon confirming the ios/web platform axis, wave 1 reconciling the 173 existing nodes, waves 2 and 3, then `restore --dry-run` and `restore` to `prj_5dDiZc-G6lseF3cb`.

**Two follow-ups deliberately left out:** the self-map gaining nodes for the bootstrap surface (dogfood, its own small PR), and a server-side pre-image table for restore (would need a manual prod migration; the client-side backup covers the realistic failure and costs nothing).

---

## Self-review notes (already applied)

- **Spec coverage.** Every section of the spec maps to a task: §3 corpus/plan/slice/index/merge → Tasks 2–7; §3 working directory → Task 1 (`ensureGitignored`); §4 skill → Task 13; §5 waves + reviewer checklists → Task 13 step 4; §6 token model → documented in Task 15; §7 hosted restore → Tasks 10–12; §8 Pebbles run → deliberately deferred with its sequence recorded above; §9 delivery → the three PR tasks; §10 testing → Tasks 9, 10, and the verification in Task 15.
- **Type consistency.** `WorkUnit.fragment` is a repo-relative path everywhere (manifest, slice, issue body, test assertions). `Fragment` field names (`nodes`, `edges`, `add`, `update`, `retire`, `events`, `created_ts`) are identical in `fragments.ts`, `merge.ts`, every test fixture, and the skill reference. `deterministicEventId(ts, key)` keeps that argument order at both call sites in `merge.ts`. `versionMatches(ifMatch, current)` keeps its order in the test, `restore.ts`, and `store.ts`.
- **Two places the plan says "read first, then match."** Task 10's test loader (mirror `tests/services/auth-guard.test.js`), Task 11's journal row helpers (mirror `createProject`/`getJournal`), Task 12's async dispatch (mirror `runPushCli`), and Task 14's skill renderer (reuse the maintenance skill's path). These are deliberate: inventing a second convention beside an existing one is worse than reading the existing one.
- **`created_ts` is stripped before the node is stored** — it is fragment-only metadata that becomes the `node.created` timestamp. Asserted in Task 5's test so it cannot regress.

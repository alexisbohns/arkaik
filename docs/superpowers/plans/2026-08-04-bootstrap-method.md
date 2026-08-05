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
| `packages/cli/src/lib/bootstrap/profile-validate.ts` | `profile.json`'s trust-boundary validation, extracted from `manifest.ts`. |
| `packages/cli/src/lib/bootstrap/era-window.ts` | Half-open era date math, shared by `profile-validate.ts` and `slice.ts`. |
| `packages/cli/src/lib/bootstrap/slice.ts` | Resolve one unit's corpus subset. |
| `packages/cli/src/lib/bootstrap/body-budget.ts` | PR-body truncation cap, Lab-Note-safe. |
| `packages/cli/src/lib/bootstrap/index-view.ts` | Compact map index rendering. |
| `packages/cli/src/lib/bootstrap/event-id.ts` | Deterministic, sortable, collision-resistant event ids. |
| `packages/cli/src/lib/bootstrap/fragments.ts` | Fragment types, loading, shape checks. |
| `packages/cli/src/lib/bootstrap/merge.ts` | Pure merge: nodes, edges, reconcile ops, journal. |
| `tests/cli/bootstrap-corpus.test.js` | Dispatch + `corpus` (split from `bootstrap-plan.test.js`, Task 3). |
| `tests/cli/bootstrap-plan.test.js` | `plan` — manifest, resume, mode detection. |
| `tests/cli/bootstrap-slice.test.js` | `slice` + `index` (Task 4). |
| `tests/cli/bootstrap-era-window.test.js` | Direct-require: half-open era date math (Task 4). |
| `tests/cli/bootstrap-body-budget.test.js` | Direct-require: PR-body truncation (Task 4). |
| `tests/cli/bootstrap-event-id.test.js` | Direct-require: `deterministicEventId` (Task 5). |
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

**Implementation note (post-review, four rounds):** the reference code below was written in one pass and never executed. Quality review on Tasks 1–2 found real defects inherited from an un-executed reference implementation elsewhere in this plan, so Task 3 went through four review passes before it settled. **Round 1** (five self-applied probes): four turned up genuine bugs, fixed below (items 1, 2, 4, 5); the fifth (fragments orphaned when an area drops out of the profile) was traced and found harmless, not fixed (item 3). Spec review confirmed round 1's fixes, caught one refinement (title's role in item 2), and asked that an absolute-path finding from self-review be folded in (item 6). **Round 2** (quality review, closer scrutiny of the `profile.json` trust boundary specifically) found four more real issues, all in the same place: *the id field reaching a filesystem path had been hardened; everything else profile.json declares had not.* Items 7–10 below, plus a run of minors. **Round 3** (coordinator review of Task 4's `bootstrap slice`) pointed straight back at this file: a finding about era date filtering turned out to be an unvalidated `planUnits` input, the same shape as item 8 but for `eras` instead of `areas` — item 11. **Round 4** (coordinator review of round 3's own fix) found the round-3 era-window design itself was structurally broken — inclusive bounds and a no-touching rule are incompatible with date-only bounds, and dropped 51 of 195 real PRs into neither era on this repo — and asked for the validation logic to be pulled out of this file entirely. Item 12, plus the extraction described just below. All twelve (plus minors) are recorded here so later tasks don't have to re-discover them:

**Round 4's extraction:** by round 3, profile.json's validation — `assertSafeId`, `assertArrayField`, the malformed-entry checks, `assertEraWindow`, `assertNoOverlappingEras` — was roughly 30% of this file's line count (351 → 425 lines) and had nothing to do with the manifest's own job (building `units`, carrying status forward). It moved to **`packages/cli/src/lib/bootstrap/profile-validate.ts`**, exposing one call, `assertValidProfile(profile)`, that `planUnits` now makes instead of running the checks inline. `assertEraWindow` is also exported individually — `slice.ts` needs the identical check at slice time too (item 4 below, and Task 4's own notes). The overlap check's date math (`eraStart`/`eraEnd`) moved further still, into **`packages/cli/src/lib/bootstrap/era-window.ts`**, shared with `slice.ts`'s PR-membership check — the two independently reimplementing the same date math is exactly how they drifted apart in round 3 (see item 12 and Task 4's item 4).

1. **Wave-3 gating was wrong.** The original gated `w3-decisions` / `w3-status-arcs` on `profile.eras?.length` — a profile with real `areas` but zero `eras` (a young repo, or one recon judged has no story worth splitting into eras yet) silently lost decision-mining and status arcs, even though neither unit reads era boundaries (decisions mines docs, status-arcs arcs anatomy nodes). **Fixed:** gated on `profile !== null` (recon has run) instead.
2. **Status carry-forward didn't check the definition — and neither `title` nor `scope` belongs in that check.** The original carried `done` forward by unit id alone. **Fixed, in two steps:** round 1 made carry-forward conditional on `scope` and `slice` matching the previous plan (excluding `title`, since era units' scope text never mentions `era.title` — comparing it forced a needless redo on a cosmetic rename). Round 2 went further and dropped `scope` too: only w1's scope text is mode-dependent ("map the anatomy" vs. "reconcile the existing map"), and a plain greenfield→brownfield mode flip — which happens on every ordinary run, the moment `merge` lands wave-1 nodes and `plan` runs again — was resetting every finished wave-1 unit to `pending` even though nothing the agent read had changed. Under `plan --issues` (Task 8) that means re-filing a GitHub issue for work already merged. **The rule now:** `sameSlice` (extracted as its own named function) compares `slice` alone. `slice` is the invalidation key — it's the exact corpus subset the agent read. `scope` and `title` are presentation, generated from templates, never hand-edited; neither can tell you whether the fragment on disk is still correct.
3. **Fragments for a dropped area are orphaned, not dangerous.** If recon later drops an area from `profile.json`, its unit vanishes from the next plan's `units` array, but `.arkaik/bootstrap/fragments/<old-id>.json` remains on disk. Traced against Task 6's `loadFragments`: it iterates `manifest.units` and looks up each unit's own fragment path — it never scans the fragments directory — so a fragment with no matching unit is simply never read. No silent data risk; just an inert file. Left unfixed (nothing to fix), noted here so Task 6 doesn't have to re-trace it. **A related, weaker link for Task 6 to close, not this task:** `loadFragments` does `path.join(cwd, unit.fragment)` — it trusts the `fragment` string *stored in the manifest* rather than re-deriving `${FRAGMENTS_DIR}/${id}.json` from the already-validated `id`. `manifest.json` is edited between `plan` and `merge` (units get marked `done`/`rejected` externally — see the "resume" tests), so nothing stops that same edit from also rewriting `fragment` to point somewhere else. Task 6 should either re-derive the path from `id` and ignore the stored `fragment` field, or assert the resolved path stays under `FRAGMENTS_DIR` before reading/writing it.
4. **Mode detection used `existsSync`, contradicting the spec's own rule.** § 1 of the design spec says greenfield is "no bundle, **or a stub**" — but the reference code was `existsSync(bundle) ? "brownfield" : "greenfield"`, which reads a freshly-scaffolded `arkaik init` bundle (`{nodes: [], edges: []}`) as brownfield. **Fixed:** `detectMode` reads the bundle when present and checks `nodes.length === 0` (a stub) vs. `> 0` (real content); a bundle that exists but fails to parse throws rather than silently guessing a mode.
5. **Unit ids reach a filesystem path with no validation — and case-differing ids collide on this very platform.** Area ids and era slugs come from `profile.json`, written by an agent, and become fragment filenames verbatim (`${FRAGMENTS_DIR}/${id}.json`). Round 1 fixed the traversal risk (`/`, `..`) with a case-permissive regex (`[A-Za-z0-9][A-Za-z0-9-]*`) and a case-sensitive duplicate check — round 2 found that combination still lets `Home` and `home` both pass validation *and* pass the duplicate check as "different" ids, while macOS and Windows both resolve them to the **same fragment file** by default. Reproduced: the second agent's fragment silently clobbered the first's. **Fixed:** `SAFE_ID_RE` is now lowercase-only (`^[a-z0-9][a-z0-9-]*$`), stricter than lowercasing the comparison and matching this codebase's own id convention (`kebabCase()` in `packages/schema/src/id-gen.ts` lowercases everything; the bundle schema documents ids as kebab-case). The error message says ids must be lowercase kebab-case. A length cap (`MAX_ID_LENGTH = 64`) was added alongside it — an oversized id previously deferred a raw `ENAMETOOLONG` to whenever an agent tried to write the fragment; now it fails at `plan` with a clear message. The post-build duplicate-id pass (unaffected by this fix, still needed for the reserved-name-collision case) is unchanged.
6. **`detectMode` mis-resolved an absolute `--bundle` path.** Found during self-review, confirmed real at spec review: the bundle file was located via `at(cwd, bundlePath)` (i.e. `path.join`), and `path.join("/repo", "/abs/bundle.json")` produces `/repo/abs/bundle.json` — a path that doesn't exist, so an absolute `--bundle` pointing at a real, populated bundle silently read as greenfield. **Fixed:** `detectMode` resolves via `path.resolve(cwd, bundlePath)` instead, which returns an already-absolute second argument unchanged and behaves identically to the old `path.join` for the ordinary relative case. **This matters for Task 6:** `runMerge`'s reference code resolves the same `manifest.bundle` field via `path.resolve(cwd, manifest.bundle)` — the two now agree; if Task 6 changes its resolution strategy, `detectMode` needs to change with it, or `plan` and `merge` will disagree about what `--bundle` points at.
7. **`runPlan` skipped both of `runCorpus`'s guards.** `corpus` refuses to run outside a repo root and calls `ensureGitignored`; `plan` did neither. Running `plan` before `corpus` (a legitimate order — recon can run against a repo with no corpus yet) left an untracked, un-ignored `.arkaik/`, breaking `paths.ts`'s own stated contract that the directory is always ignored; from a subdirectory, `plan` would scatter `.arkaik/bootstrap/` somewhere `corpus` — and a human — would never look for it. **Fixed:** `runPlan` now has the same `.git`-presence guard and calls `ensureGitignored` after a successful plan, reusing both from what `runCorpus` already imports.
8. **`area.paths` was unvalidated and failed *open*.** `readProfile` is a bare `JSON.parse(...) as Profile` — no runtime shape checking. An area with no `paths` (or `paths: []`) produces `slice: {}`, which Task 4's `resolveSlice` reads as `?? []` → no filter → that unit's agent receives the **entire corpus**, silently, with nothing in the manifest that looks wrong — the method's primary token lever failing open. Only `id` had been hardened, because it reaches a filesystem path; `paths` decides what the agent actually reads and got no scrutiny at all. **Fixed:** each area asserts `Array.isArray(area.paths) && area.paths.length > 0`, naming the offending area on failure.
9. **`areas`/`eras` shape was unguarded, and individual malformed entries could crash raw.** `areas: "home"` silently iterated the string's characters instead of erroring (each "area" a single character, `.id` reliably `undefined`, caught downstream only by luck); `areas: 5` reached a `for...of` and threw a raw `"5 is not iterable"` with no mention of profile.json. Separately, a malformed *entry* inside an otherwise-valid array (`areas: [null]`, `eras: [null]`) crashed on `.id`/`.slug` access off `null` before any validation ran. **Fixed:** `assertArrayField` checks `areas`/`eras` are arrays when present, and each entry is checked for `null`/non-object before its fields are read — both throw a clear, profile.json-naming error instead of a raw TypeError.
10. **Minors, taken as part of round 2:** `readProfile`/`readManifest` now wrap their `JSON.parse` and name the file in the thrown error (matching `detectMode`'s existing style) — with three JSON files in play (`profile.json`, `manifest.json`, the bundle), a bare `Unexpected end of JSON input` didn't say which one; `profile.json` is agent-written and the likeliest to be malformed. The status-carry-forward comparison was extracted into a named `sameSlice` function so the "JSON.stringify is key-order sensitive, fine today because every slice literal has exactly one key" caveat sits where someone adding a two-key slice shape will actually be standing. `tests/cli/bootstrap-plan.test.js` was split: everything through Task 2 (dispatch + `corpus`) moved to `tests/cli/bootstrap-corpus.test.js` unchanged, so Task 9's CI wiring touches each file once instead of touching one 600-line file that mixes two tasks. A test now pins that `units` is non-decreasing in `wave` — the "resume at the first pending unit" contract depends on it and nothing had pinned it before.
11. **(Round 3, added during Task 4 review) `era.from`/`era.to` were unvalidated and failed *open* — the same shape as item 8, just landing on the opposite silent failure.** Task 4's `resolveSlice` originally treated an era with neither bound as matching zero PRs ("fails closed" — safer-looking than item 8's original "everything," but still silent: a story unit writes an empty fragment and contributes nothing to the changelog, with nothing in the manifest that looks wrong). **Fixed:** `assertEraWindow` rejects an era with neither `from` nor `to`, and rejects any present bound that doesn't parse (mirroring `corpus.ts`'s `--since` validation — same trust boundary, same treatment). An era with only one bound stays legal: a meaningful open-ended window, not a mistake. Round 3 also added `assertNoOverlappingEras`, reasoning from **inclusive-at-both-ends** bounds — **that reasoning was wrong; see item 12.**
12. **(Round 4) Round 3's era-window design was structurally broken: inclusive bounds plus "reject touching windows" are incompatible with date-only dates, and the combination is what round 3 itself chose.** `Date.parse("2026-01-31")` is that day's `T00:00:00Z`. With inclusive bounds, an era ending `to: "2026-01-31"` excluded every PR merged LATER that same day — on a real 4-era partition of this repo, **51 of 195 PRs** landed in NEITHER era. Zero of those 195 merged at exactly `T00:00:00Z`, so the double-count inclusive bounds were defending against never actually happens in practice. **Fixed — the whole scheme replaced with half-open intervals plus end-of-day expansion** (now in `era-window.ts`): a `from` date-only value is that day's `T00:00:00Z`; a `to` date-only value is the **next** day's `T00:00:00Z` (so the whole named day is included); membership is `start <= merged && merged < end`; the overlap check becomes `a.start < b.end && b.start < a.end`, which **permits** two eras whose windows touch exactly (one's `to` the day before the next's `from`) — under half-open semantics, touching is a clean partition, not a collision. Two eras that share the SAME calendar date for one's `to` and the next's `from` still genuinely overlap by a full day under this scheme (a date-only `to` includes its whole named day) and are still correctly rejected — see Task 4's boundary-day test for the PR-membership proof this was fixed correctly, not just re-broken differently. **Also fixed, a follow-on the reviewer caught:** two eras that both carry only a `from` (a natural way to write successive open-ended chapters) always overlap under half-open semantics (each extends to `+Infinity`), and used to be rejected with a message ("narrow one or both windows") that didn't hint the actual fix is to add a `to` bound — `assertNoOverlappingEras` now special-cases this and names the fix directly.

**Explicitly out of scope, by the reviewer's own call:** `Manifest.version` stays a bare `1` — it costs nothing unused and will matter when the shape changes. No test was added for `status: "rejected"` — nothing sets it yet.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/manifest.ts`
- Create (round 4): `packages/cli/src/lib/bootstrap/profile-validate.ts` — profile.json's validation, extracted out of this file
- Create (round 4): `packages/cli/src/lib/bootstrap/era-window.ts` — half-open era date math, shared with `slice.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Test: `tests/cli/bootstrap-plan.test.js` (planning-only, after the round-2 split) and `tests/cli/bootstrap-corpus.test.js` (dispatch + `corpus`, extracted from it unchanged)
- Test (round 4, direct unit tests, no CLI build needed): `tests/cli/bootstrap-era-window.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the `try` block of `tests/cli/bootstrap-plan.test.js` — after the round-2 split, this file's `try` block no longer contains any `corpus` setup, so it opens its own fresh mkdtemp repo dir directly. The base plan/resume checks plus one regression test per finding above: stub-bundle mode, gating without eras, status invalidation on a changed slice, the title-rename and mode-flip refinements, unsafe/duplicate/uppercase/oversized ids, the unparseable/non-bundle-shaped bundle branches, the absolute-`--bundle` fix, the repo-root+gitignore guard, `area.paths` validation, `areas`/`eras` shape validation, and the wave-ordering pin:

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

A further inline block, right after the slice-change regression above, covers item 2's title refinement: plan an era, mark its `w3-<slug>` unit `done`, rename only the era's `title` in profile.json (slug/scope untouched), re-plan, and assert the unit stays `done` while its own `title` field updates to the new name — pinning that a cosmetic rename doesn't force a redo, while confirming the rename still lands.

Isolated mkdtemp blocks (following the `orderDir` / `gitDir` pattern from Task 2) additionally cover: probe 1 (`areas` with `eras: []` still plans `w3-decisions` / `w3-status-arcs`), probe 4 (a `{nodes: [], edges: []}` bundle reads `greenfield`; the same bundle with one node reads `brownfield`; a bundle file containing invalid JSON exits 1 naming the bundle path; valid JSON with no `nodes` array falls back to `greenfield` instead of crashing), item 6 (an absolute `--bundle` path pointing at a populated bundle reads `brownfield`, proving `path.resolve` — not `path.join` — is doing the resolving), and probe 5 (an area id of `"../evil"` and an era slug with a space both exit 1 and write no manifest; an era slug of `"decisions"` exits 1 naming the duplicate `w3-decisions` id). See `tests/cli/bootstrap-plan.test.js` for the full text — the CLI's baseline stood at 39 checks before Task 3; the first pass brought it to 71, and the spec-review follow-up (items 2's refinement, plus coverage for items 4 and 6) brought it to 81.

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
import path from "node:path";

import { at, ensureDir, FRAGMENTS_DIR, MANIFEST_FILE, PLAN_DIR, PROFILE_FILE } from "./paths";
import { assertValidProfile } from "./profile-validate";

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

/**
 * profile.json is agent-written, so a raw `JSON.parse` failure is the likely
 * failure mode — naming the file (not just "Unexpected end of JSON input")
 * matters when manifest.json and the bundle are also in play. Matches
 * `detectMode`'s error style below.
 */
export function readProfile(cwd: string): Profile | null {
  const file = at(cwd, PROFILE_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Profile;
  } catch (err) {
    throw new Error(`cannot read ${PROFILE_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readManifest(cwd: string): Manifest | null {
  const file = at(cwd, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch (err) {
    throw new Error(`cannot read ${MANIFEST_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
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
 *
 * `bundlePath` is resolved with `path.resolve`, not `at`/`path.join`: unlike
 * the fixed `.arkaik/...` constants in ./paths, this value comes straight
 * from `--bundle` and may already be absolute. `path.join(cwd, "/abs/x")`
 * mangles an absolute path into `<cwd>/abs/x`; `path.resolve` returns an
 * absolute second argument unchanged, so it's the correct join for both
 * relative and absolute input. `bootstrap merge` (Task 6) resolves the same
 * `manifest.bundle` field the same way — keep the two in agreement.
 */
export function detectMode(cwd: string, bundlePath: string): Manifest["mode"] {
  const file = path.resolve(cwd, bundlePath);
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

/**
 * Build the manifest for this repo. `previous` (when given) carries unit
 * statuses forward so re-planning after recon never loses completed work —
 * but only for a unit whose `slice` is unchanged from the last plan (see
 * `sameSlice` below for why `slice` alone is the right key).
 */
export function planUnits(options: {
  mode: Manifest["mode"];
  bundle: string;
  profile: Profile | null;
  previous: Manifest | null;
}): Manifest {
  const { mode, bundle, profile, previous } = options;

  // Everything below reaches either a filesystem path (id -> fragment file)
  // or a token-budget decision (paths/eras -> what an agent reads), and all
  // of it is agent-written, not code-written — fail loudly and specifically
  // rather than crash on a raw JS error or silently do the wrong thing. See
  // profile-validate.ts for the full checklist.
  assertValidProfile(profile);

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
  // doesn't match the unit that supposedly produced it. Ids are already
  // lowercase-only (assertSafeId), so this comparison needs no normalizing.
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
    if (before && sameSlice(before, u)) u.status = before.status;
  }

  return { version: 1, mode, bundle, units };
}

/**
 * Whether `next`'s slice is unchanged from `before`'s — the ONLY test for
 * carrying a unit's status forward on re-plan. `slice` is what determines
 * whether the fragment already on disk is still correct: it's the exact
 * corpus subset (`bootstrap slice`) the agent read to produce it. If a
 * profile edit changes an area's `paths` (or an era's slug), the old
 * fragment was written against different input, so this returns `false` and
 * the unit resets to `pending`.
 *
 * `scope` and `title` are deliberately NOT compared, even though an earlier
 * version of this function compared both. Both are presentation, generated
 * from templates, never hand-edited — they can change for reasons that have
 * nothing to do with the fragment's validity:
 *  - `scope`'s wave-1 text is mode-dependent ("map the anatomy" vs.
 *    "reconcile the existing map"). Comparing it meant a plain
 *    greenfield -> brownfield mode flip — which happens every time `merge`
 *    lands wave-1 nodes and `plan` runs again — resurrected every finished
 *    wave-1 unit back to `pending`, even though nothing the agent read
 *    changed and the fragment is still exactly right. Under `plan --issues`
 *    (Task 8) that means re-filing a GitHub issue for work already merged.
 *  - `title`'s wave-3 era text is a pure display string; renaming an era for
 *    cosmetic reasons forced a full redo of an otherwise-valid fragment.
 *
 * Compares via `JSON.stringify`, which is key-order sensitive: today every
 * slice literal in this file has exactly one key (`paths`, `eras`, or
 * `docs`), so order can never differ between two calls to `unit()`. If a
 * future slice ever grows a second key, an equivalent slice built with keys
 * in a different order would compare as "changed" even though nothing an
 * agent reads actually did — worth a real deep-equality check at that point,
 * not before.
 */
function sameSlice(before: WorkUnit, next: WorkUnit): boolean {
  return JSON.stringify(before.slice) === JSON.stringify(next.slice);
}
```

**(Round 4) The shipped `profile-validate.ts`** — everything `assertSafeId`, `assertArrayField`, the malformed-entry checks, `assertEraWindow`, and `assertNoOverlappingEras` used to do inline in `planUnits` above, now in one file with one public entry point:

```ts
import { eraEnd, eraStart } from "./era-window";
import type { Profile } from "./manifest";
import { FRAGMENTS_DIR } from "./paths";

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ID_LENGTH = 64;

function assertSafeId(kind: "area" | "era", id: unknown): void {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id) || id.length > MAX_ID_LENGTH) {
    throw new Error(
      `profile.json has an invalid ${kind} id: ${JSON.stringify(id)}. Work-unit ids become fragment filenames ` +
        `under ${FRAGMENTS_DIR}/, so they must be lowercase kebab-case (letters, digits and hyphens only, no ` +
        `uppercase, no "/", "..", or whitespace) and at most ${MAX_ID_LENGTH} characters. Fix profile.json and ` +
        "re-run `arkaik bootstrap plan`.",
    );
  }
}

function assertArrayField(field: "areas" | "eras", value: unknown): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(
      `profile.json "${field}" must be an array, got ${typeof value} (${JSON.stringify(value)}). Fix profile.json ` +
        "and re-run `arkaik bootstrap plan`.",
    );
  }
}

export function assertEraWindow(era: { slug?: unknown; from?: unknown; to?: unknown }): void {
  if (era.from === undefined && era.to === undefined) {
    throw new Error(
      `profile.json era "${String(era.slug)}" has neither "from" nor "to". An unbounded era would hand that ` +
        "era's wave-3 agent zero PRs (bootstrap slice's date-window filter can't constrain anything), silently " +
        "contributing nothing to the story. Add at least one date and re-run `arkaik bootstrap plan`.",
    );
  }
  for (const [key, value] of [
    ["from", era.from],
    ["to", era.to],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new Error(
        `profile.json era "${String(era.slug)}" has an unparseable "${key}": ${JSON.stringify(value)} (try an ISO ` +
          "date like 2026-01-31). Fix profile.json and re-run `arkaik bootstrap plan`.",
      );
    }
  }
}

// (Round 4) Half-open — see era-window.ts. Two eras sharing the same
// calendar date for one's `to` and the next's `from` genuinely overlap by a
// full day under this scheme (a date-only `to` expands to include its whole
// named day) and are correctly rejected; two eras where one's `to` is the
// day BEFORE the next's `from` touch with zero overlap and are accepted.
function assertNoOverlappingEras(eras: ReadonlyArray<{ slug: string; from?: string; to?: string }>): void {
  const windows = eras.map((e) => ({
    slug: e.slug,
    start: e.from !== undefined ? eraStart(e.from) : -Infinity,
    end: e.to !== undefined ? eraEnd(e.to) : Infinity,
  }));
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (a.start < b.end && b.start < a.end) {
        // Two from-only eras always overlap (each extends to +Infinity) —
        // name the actual fix instead of the generic "narrow the windows".
        const bothOpenEnded = a.end === Infinity && b.end === Infinity;
        throw new Error(
          bothOpenEnded
            ? `profile.json eras "${a.slug}" and "${b.slug}" both have only a "from" date, so both extend ` +
              'indefinitely and always overlap. Give the earlier era a "to" date (e.g. the later era\'s "from") ' +
              "and re-run `arkaik bootstrap plan`."
            : `profile.json eras "${a.slug}" and "${b.slug}" have overlapping date windows. Eras must partition ` +
              "the corpus without overlap — narrow one or both windows and re-run `arkaik bootstrap plan`.",
        );
      }
    }
  }
}

function assertAreas(profile: Profile): void {
  for (const rawArea of profile.areas ?? []) {
    if (rawArea === null || typeof rawArea !== "object") {
      throw new Error(
        `profile.json has a malformed area entry: ${JSON.stringify(rawArea)} (expected an object with id, title, paths).`,
      );
    }
    const area = rawArea as unknown as { id?: unknown; paths?: unknown };
    assertSafeId("area", area.id);
    if (!Array.isArray(area.paths) || area.paths.length === 0) {
      throw new Error(
        `profile.json area "${String(area.id)}" has no paths. An empty slice would hand that unit's agent the ` +
          "entire corpus with no filtering. Add at least one path and re-run `arkaik bootstrap plan`.",
      );
    }
  }
}

function assertEras(profile: Profile): void {
  for (const rawEra of profile.eras ?? []) {
    if (rawEra === null || typeof rawEra !== "object") {
      throw new Error(
        `profile.json has a malformed era entry: ${JSON.stringify(rawEra)} (expected an object with slug, title).`,
      );
    }
    const era = rawEra as unknown as { slug?: unknown; from?: unknown; to?: unknown };
    assertSafeId("era", era.slug);
    assertEraWindow(era);
  }
  assertNoOverlappingEras(profile.eras ?? []);
}

export function assertValidProfile(profile: Profile | null): void {
  if (!profile) return;
  assertArrayField("areas", (profile as unknown as Record<string, unknown>).areas);
  assertArrayField("eras", (profile as unknown as Record<string, unknown>).eras);
  assertAreas(profile);
  assertEras(profile);
}
```

**(Round 4) The shipped `era-window.ts`** — the half-open date math itself, the actual fix for the 51-of-195-PRs bug:

```ts
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function eraStart(value: string): number {
  return Date.parse(value);
}

export function eraEnd(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return parsed;
  return DATE_ONLY_RE.test(value) ? parsed + ONE_DAY_MS : parsed;
}
```

Membership (in `slice.ts`) is `start <= merged && merged < end` — half-open, not inclusive-inclusive. That's the whole fix: a date-only `to` used to parse to that day's `T00:00:00Z` and, under the old inclusive `merged <= to` check, excluded every PR merged LATER that same day. `eraEnd` expands a date-only value to the START of the NEXT day instead, so the half-open interval includes every moment of the named day. A value with an explicit time component (`"2026-01-31T15:30:00Z"`) is NOT expanded — that's an exact, deliberate cutoff, not a whole-day marker.

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

  // Same guard as `corpus`: manifest.json/profile.json/fragments all live
  // under .arkaik/, which is only meaningful relative to the repo root — run
  // from a subdirectory and `plan` would scatter .arkaik/bootstrap/
  // somewhere `corpus` (and a human) would never look for it.
  if (!existsSync(path.join(cwd, ".git"))) {
    fail("`arkaik bootstrap plan` must run from the repository root (no .git here).");
  }

  try {
    const mode = detectMode(cwd, bundle);
    const manifest = planUnits({ mode, bundle, profile: readProfile(cwd), previous: readManifest(cwd) });
    writeManifest(cwd, manifest);
    // paths.ts's own contract: .arkaik/ never lands in git. `corpus` usually
    // runs first and already does this, but `plan` can run first too (or
    // stand alone against an existing profile.json), so it can't assume
    // corpus already ignored the directory.
    const ignored = ensureGitignored(cwd);

    const pending = manifest.units.filter((u) => u.status === "pending").length;
    console.log(`Planned ${manifest.units.length} units (${pending} pending) in ${mode} mode.`);
    for (const u of manifest.units) console.log(`  [${u.status}] w${u.wave} ${u.id} — ${u.title}`);
    if (ignored) console.log(`  added ${BOOTSTRAP_ROOT}/ to .gitignore`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Add `case "plan": runPlan(rest); return;` to the switch. `BOOTSTRAP_ROOT` and `ensureGitignored` are already imported (Task 1's `paths` import, reused by `corpus`) — no new import needed. Note `mode` detection and `planUnits` both now throw on bad input (an unparseable bundle, an invalid or duplicate unit id, a malformed `areas`/`eras` shape) — all caught by the `try`/`catch` above rather than left to crash the process uncaught.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-plan.test.js && node tests/cli/bootstrap-corpus.test.js`
Expected (as of round 4): PASS on all 84 checks in `bootstrap-plan.test.js`, all 39 in `bootstrap-corpus.test.js`, and all 12 in the new, direct-require `bootstrap-era-window.test.js` (135 total across the three). The two CLI-spawning files started as one at 81 checks (39 from Tasks 1–2 + 42 from Task 3's first pass and its spec-review follow-up); round 2's quality review added 32 more checks to the planning half and the file was split along the Task-2/Task-3 boundary, landing at 39 + 73. **Round 3** (item 11, era window validation, added during Task 4's review) added 9 more regression checks — dateless-era rejection, unparseable-bound rejection, an open-ended single-bound era staying legal, and two overlap cases. **Round 4** (the half-open rewrite) replaced two of round 3's overlap tests with corrected ones (a same-calendar-date overlap and a clean-touch acceptance, replacing round 3's "exact-instant touch rejected" / "one-day gap accepted" pair, which were reasoning from the wrong — inclusive-bounds — model) and added a from-only-eras-always-overlap test with the improved error message, landing `bootstrap-plan.test.js` at 84. `bootstrap-era-window.test.js` is new: 12 checks pinning `eraStart`/`eraEnd` directly, including the exact boundary-day math the critical bug was about — see Task 4's own notes for the full story and the PR-membership proof (which lives in `bootstrap-slice.test.js`, since it needs a real corpus).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/bootstrap/manifest.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js tests/cli/bootstrap-corpus.test.js
git commit -m "feat(cli): bootstrap plan — resumable work-unit manifest"
```

(In practice this shipped as three commits — the initial implementation, the spec-review follow-up, and the quality-review follow-up above — each with its own message. A fresh implementer following this doc from scratch can do it in one.)

---

### Task 4: `bootstrap slice` and `bootstrap index` — shipped, findings below (three review rounds)

These two are the token levers: a slice is what one agent reads instead of the whole corpus; an index is what it reads instead of the whole bundle. **The reference code below is what actually shipped, not the original draft.** It went through three review rounds. **Round 1** (self-review, this task's required last step) found the draft failed open on its primary reason for existing (era filtering was declared but never wired up), plus five smaller findings — the six below. **Round 2** (coordinator review of round 1's own output) pulled real PR bodies from this repo rather than reasoning about the truncation cap in the abstract, found it silently destroyed Lab Notes on the majority of them; found the era-filter fix still failed open when BOTH bounds were garbage; and overturned round 1's "fails closed" call on a dateless era in favor of rejecting it at plan time. **Round 3** (coordinator review of round 2's own fixes — the reviewer left reproduction scripts, not just descriptions, in the scratchpad this time) found the round-2 era-window design was itself structurally broken (the coordinator's own instruction had asked for an incompatible combination — inclusive bounds plus a no-touching rule — and owned that mistake directly), found the round-2 Lab-Note truncation fix could still grow a body or silently no-op whenever content followed the note, found two more silent-failure paths (`plan` and `matchesEras` could disagree about a bad era bound; an unresolved era slug failed closed quietly instead of loudly), and asked for two pure-logic modules to be pulled out for direct testing — the exact way round 2's defects went untested in the first place. Read this before touching any of these files again.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/slice.ts`
- Create: `packages/cli/src/lib/bootstrap/index-view.ts`
- Create (round 3): `packages/cli/src/lib/bootstrap/body-budget.ts` — the Lab-Note-aware truncation, extracted out of `slice.ts` for direct testing
- Create (round 3, shared with Task 3): `packages/cli/src/lib/bootstrap/era-window.ts` — half-open era date math
- Modify: `packages/cli/src/commands/bootstrap.ts`
- Modify: `packages/cli/src/lib/bootstrap/manifest.ts` (round 2 — era window validation; see Task 3's item 11) / `profile-validate.ts` (round 3 extraction target — see Task 3's round-4 note)
- Test: `tests/cli/bootstrap-slice.test.js` (new file, not an extension of `bootstrap-plan.test.js` — see "Why a new test file" below)
- Test (round 3, direct unit tests, no CLI build needed): `tests/cli/bootstrap-body-budget.test.js`

**Six round-1 findings, round 2's three fixes and one overturned decision, and round 3's four fixes plus one critical correction:**

1. **`slice.eras` was declared on `WorkUnit` but never consumed.** Confirmed: `resolveSlice`'s only guard was `paths.length > 0`; a wave-3 era unit (`slice: { eras: [slug] }`) has no `paths`, so it fell straight through to "return every PR in the corpus" — on a 324-PR repo, the exact failure the task brief warned about. Fixed by adding a second branch: when `paths` is empty but `eras` is non-empty, look each slug up in `profile.json`'s `eras` list (via the already-exported `readProfile`) and filter PRs by `merged_at` falling inside that era's `[from, to]` window (`matchesEras` in `slice.ts`).
   - **Design call, not in the original draft:** the manifest itself only ever stores the era **slug**, never its `from`/`to` — `planUnits` (manifest.ts) doesn't read those fields today, and embedding them into `WorkUnit.slice` would mean changing the manifest schema and `sameSlice`'s re-plan invalidation logic too, a much bigger change than this bug needed. `resolveSlice` already takes `cwd`, so it looks the window up in `profile.json` directly at slice time instead. Trade-off, noted in code: if `profile.json`'s dates are edited without re-running `plan`, a `done` unit won't notice its window changed — narrower than the bug being fixed, and the same shape of gap `sameSlice` already accepts for `era.title` (a cosmetic rename).
   - **Round 1 chose "an era with no `from` and no `to` matches zero PRs"** (fails closed, not open) — matching everything would just move the fail-open bug one level down. **Round 2 overturned this call:** a dateless era is the same authoring mistake as an area with empty `paths` (which `planUnits` already rejects, item 8 in Task 3), just resolving to the opposite silent failure — an empty fragment and a story wave that quietly contributes nothing, with no error anywhere. There's no legitimate use for a fully unbounded era; "everything" is what the three whole-corpus units already serve. **Fixed at the source, in `manifest.ts`:** `assertEraWindow` now rejects an era with neither bound, and rejects any present bound that doesn't parse (mirroring `corpus.ts`'s `--since` validation) — before any agent is ever dispatched. An era with only one bound stays legal: a meaningful open-ended window, not a mistake. See Task 3's item 11 for the full writeup; this file's own `matchesEras` still defends against the case defensively (next point) rather than trusting that validation caught everything.
   - **Round 2, severe: `matchesEras` still failed open when BOTH bounds were garbage.** The per-side leniency (an unparseable bound treated as "no bound on that side") is fine with one bad bound and one good one, but when both `from` and `to` fail to parse, every guard fell through and the function returned `true` for every PR — matching the entire corpus, the exact fail-open this file exists to prevent. Reproduced before the fix: `eras: [{ slug: "garbage-era", from: "not-a-date", to: "also-not-a-date" }]` → `bootstrap slice` returned all 3 PRs in a 3-PR test corpus instead of 0. `assertEraWindow` (previous point) closes the path to this through `plan`, but `matchesEras` doesn't get to assume that: `eraWindows` can still hand it a window built from a stale `profile.json` edited after `plan` ran without a re-plan (the same gap already documented for the era-window lookup itself). **Fixed:** a bound that's missing OR doesn't parse is now discarded as "not usable" rather than "unbounded" — if only one side is discarded the other still constrains the match (the useful leniency is kept), but if *both* end up discarded there is nothing left to constrain on, and the window matches nothing. Tested directly by hand-writing a `manifest.json`/`profile.json` pair with a garbage-dated era (bypassing `plan`'s now-stricter validation on purpose, to simulate the stale-file gap) and confirming `bootstrap slice` returns zero PRs.
   - **A PR that falls in no era** is simply excluded from every era-unit's slice — no special handling needed, and not a defect: `w3-decisions` and `w3-status-arcs` (see finding 2) still see it via their whole-corpus access.
   - **Round 2: era windows are inclusive at both ends, and that means overlapping windows double-match.** Bounds are inclusive on purpose — a half-open window would silently drop the PR merged exactly at an era's `to`, and recon dates an era's end at its last deliverable's merge, so losing that PR is worse than double-counting one at a shared boundary. But inclusive bounds also mean two overlapping era windows would double-match every PR merged in the overlap, with nothing downstream deduping it. **Fixed in `manifest.ts`:** `assertNoOverlappingEras` rejects overlapping windows at plan time — including the edge case where two windows merely *touch* at one shared instant (both bounds parse to the identical timestamp): that single point is shared under inclusive-inclusive semantics, so it's rejected too, not waved through as "just adjacent." Recon needs a real gap (even one day) between eras to partition cleanly. **Round 3 found this whole design broken — see below, it wasn't just refined, it was replaced.**
   - **Round 3, critical: round 2's inclusive-bounds-plus-no-touching design was structurally incompatible with date-only dates, and the coordinator owned the mistake directly** (their own instruction had specified both rules together). `Date.parse("2026-01-31")` is that day's `T00:00:00Z`. With inclusive bounds, an era ending `to: "2026-01-31"` excluded every PR merged LATER that same day — reproduced on a real 4-era partition of this repo: **51 of 195 PRs** landed in NEITHER era. Zero of those 195 merged at exactly `T00:00:00Z`, so the double-count inclusive bounds were meant to prevent never actually happens in practice. **Fixed — the whole scheme replaced with half-open intervals plus end-of-day expansion**, now in its own shared module, `era-window.ts` (see Task 3's round-4 note: `profile-validate.ts`'s overlap check and this file's `matchesEras` both import the same `eraStart`/`eraEnd`, so the two can't independently drift the way inclusive-bounds reasoning once lived separately in each file):
     - A date-only `from` is that day's `T00:00:00Z` — no change from before.
     - A date-only `to` is the **NEXT** day's `T00:00:00Z` — the whole named day is included. A `to` (or `from`) with an explicit time component is that exact instant, unmodified either way.
     - Membership is half-open: `start <= merged && merged < end`.
     - The overlap check becomes `a.start < b.end && b.start < a.end`, which **permits** two eras whose windows touch exactly (one's `to` the day before the next's `from`) — under half-open semantics, touching is a clean partition, not a collision. Two eras that share the SAME calendar date for one's `to` and the next's `from` still genuinely overlap by a full day (a date-only `to` includes its whole named day) and are still correctly rejected.
     - **Verified directly against the critical bug:** `tests/cli/bootstrap-era-window.test.js` pins the boundary-day math itself (a PR merged mid-day on the `to` date is inside the window; the start of the next day is not); `tests/cli/bootstrap-slice.test.js`'s boundary-day test proves it end-to-end through a real corpus + `plan` + `slice` — two PRs merged on `2026-01-31` (one at noon, one at 18:30) both land in the era ending `to: "2026-01-31"`, and neither leaks into the era starting `from: "2026-02-01"`.
     - **Discrepancy found and flagged, not silently resolved:** the coordinator's own message gave two "natural ways to write successive eras, both correct and gapless" — `to: 2026-01-31` / `from: 2026-02-01`, or `to: 2026-02-01` / `from: 2026-02-01`. Under the coordinator's own stated formulas (date-only `to` expands to the NEXT day), the second pair is **not** gapless — it's a full calendar day of overlap (the first era's `to: "2026-02-01"` extends through all of Feb 1st; the second era's `from: "2026-02-01"` starts at the very beginning of Feb 1st). The implementation follows the precise, stated formulas (verified consistent with the first example and with `assertNoOverlappingEras`'s own logic) rather than the second illustrative pair, and correctly rejects that second pair as an overlap — see `tests/cli/bootstrap-plan.test.js`'s `arkaik-bootstrap-samedateera-` test. Flagging this rather than quietly picking a side: if the intent was actually for `to`/`from` sharing one calendar date to be accepted, that would require a different (and worse — see the critical bug above) semantics for `to`.
   - **Round 3, follow-on the reviewer caught:** two eras that both carry only a `from` (a natural way to write successive open-ended chapters) always overlap under half-open semantics, since each extends to `+Infinity` — and used to be rejected with a message ("narrow one or both windows") that didn't hint the fix is to add a `to` bound. `assertNoOverlappingEras` now special-cases this and names the fix directly.
   - **Round 3: an era slug the manifest references but profile.json no longer declares failed closed *quietly*.** `eraWindows` used to resolve a missing slug to `{}` (an unbounded window, which `matchesEras` matches to nothing) — so `bootstrap slice w3-<slug>` exited 0 with `"prs":[]` and no signal anything was wrong. That is exactly the silent-empty-story-fragment failure `assertEraWindow` (Task 3, item 11) exists to make loud — just happening one stage later, at slice time instead of plan time. **Fixed:** a slug with no matching profile entry now throws, naming the slug and `PROFILE_FILE`.
   - **Round 3, important: `plan` and `matchesEras` could disagree, and the divergence silently widened a window.** `plan` rejects an era with an unparseable bound; `matchesEras` discarded it and carried on (the per-side leniency described above). Reproduced: `from: "whenever", to: "2026-03-01"` on a manifest built before that bound went bad — the window widened to "everything before 2026-03-01," and the slice returned PRs belonging to a different era entirely. Not graceful degradation: one era's slice silently containing another's PRs. **Fixed:** `eraWindows` now re-validates the era it looks up with the exact same `assertEraWindow` check `plan` uses (imported from `profile-validate.ts`), throwing just as loudly — `resolveSlice` already reads `profile.json` fresh every time, so calling the same validator costs nothing extra. `matchesEras`'s own "both bounds unusable -> match nothing" defense (previous point) stays in place regardless, on principle: a function whose failure mode is "match everything" shouldn't rely on an upstream validator being correct, even after this fix makes that path unreachable through the ordinary CLI.

2. **"No paths → no filtering" fallback.** Task 3 closed this for areas (`area.paths` must be non-empty, or `plan` rejects `profile.json`). After the era fix above, the units that still reach `resolveSlice`'s final "no filter" branch are exactly `w0-recon`, `w3-decisions`, and `w3-status-arcs` — all three hardcoded in `manifest.ts`'s `planUnits`, never agent-influenced, and all three genuinely need whole-corpus access (recon needs the shape of everything to write `profile.json`; decisions and status-arcs both need visibility across the whole timeline, not one area or era). Verified this is provably closed by construction, not merely by convention: an area always has `paths`, an era unit always has a slug in `eras` and (after round 2) that era is guaranteed to have a validated, parseable window, so the only way to reach "no filter" is to be one of the three hardcoded kinds. Decision: leave "empty means everything" as-is, but only because it's now unreachable except by design — documented the invariant directly in `resolveSlice`'s comment so a future new wave-N kind that forgets to set `paths`/`eras` doesn't silently inherit whole-corpus access with nothing flagging it.

3. **`matchesPaths` prefix semantics.** Tested directly: `app/home` vs. `app/homepage/thing.ts` does **not** false-match — the existing `p.endsWith("/") ? p : \`${p}/\`` trick already turns the comparison into "starts with `app/home/`", which `app/homepage/...` does not. No bug here; verified with a dedicated test case (`tests/cli/bootstrap-slice.test.js`, PR 3) rather than taking the draft's word for it. What **was** missing: `profile.json`'s `paths` are agent-written free text, and nothing stopped one from being spelled `app\\home` (Windows-style). Corpus files are always POSIX (`corpus.ts` normalizes at mining time), so an unnormalized backslash path would silently match **nothing** — the opposite failure from the usual concern, equally silent. Added a `toPosix()` normalization in `matchesPaths` for both the corpus path and every path in `paths`, and a test proving a `paths: ["win\\dir"]` area still matches a POSIX-stored `win/dir/file.ts`. **Round 2, minor:** documented the normalization's own trade-off directly on `toPosix` — a repo-relative path that legitimately contains a literal backslash in a filename (valid on POSIX, just unusual) would be mangled by this too; judged vanishingly unlikely next to a Windows-style or copy-pasted path arriving in `profile.json`, but every other trade-off in this codebase carries an explicit comment and this one hadn't.

4. **`renderIndex`'s tab-separated format.** Confirmed the bug: an embedded tab in a node title shifts every column after it; an embedded newline splits one node into two lines, the second with no id at all. Either way, an agent parsing `line.split("\t")` silently mis-associates an id with the wrong title, with no error anywhere. Fixed with a `tsvField()` helper that collapses any run of `\t`/`\r`/`\n` into a single space, applied to all four columns (id, species, title, product) defensively — title is the realistic risk, but sanitizing the rest costs nothing. Tested with a title containing a tab, a CR, and a newline together, asserting the node still produces exactly one line with exactly four tab-separated columns.

5. **`index` reading the bundle.** Checked for Task 3's `path.join`-vs-`path.resolve` bug (an absolute path getting mangled into `<cwd>/abs/path`): **not present** — the draft's `runIndex` already used `path.resolve(process.cwd(), target)`, not `path.join`, so an absolute positional argument resolves to itself correctly. Verified with a dedicated test (an absolute `--bundle`-style path argument). `readBundle` (existing, in `bundle-io.ts`) already throws a clean, specific message on a missing file (`File not found: ...`) or unparseable JSON (`Cannot parse JSON — ...`), and `runIndex`'s existing `try`/`catch` turns either into a clean one-line stderr message and exit 1, not a raw stack trace — verified both with tests. No code change needed for this one; shipped as drafted.

6. **`slice` output size.** Several changes, all aimed squarely at the "primary token lever" framing:
   - **Round 2, severe: the naive per-PR body cap silently destroyed Lab Notes on real PRs.** Round 1's fix capped any body over 4000 chars with a plain head-truncate. The coordinator pulled real bodies from this repo rather than reasoning about it in the abstract: **5 of 8 sampled merged PRs have their `## Lab Note` positioned past the 4000-char mark** (offsets 4460–5464 in bodies 5205–6267 chars long) — the note lives near the *end* of a long body, exactly where a head-cut lands. This is the worst possible loss: `has_lab_note` is computed from the full body at mining time (`corpus.ts`) and stays `true` after truncation, so the agent is told a note exists and then can't find it. **Fixed (round 2):** `boundBody` locates a `## Lab Note` section (the heading through the next `## ` heading, or end of body) via `splitLabNoteSection` and keeps it — and, in round 2's version, anything after it — in full; only the prose *before* the note is head-truncated. **This round-2 fix itself had two more bugs, found in round 3** (see next point) — the reviewer's own verification against 12 real PR bodies from this repo confirmed the note now survives in every one, none grew, none silently no-opped, after round 3's fix below.
   - **Round 3, important: round 2's fix retained `after` in full, which meant the cap could GROW a body or silently do nothing whenever content followed the note.** Every fixture available in round 2 put the Lab Note LAST in the body — the exact "fixtures cover the shape I imagined" trap this whole task was written to avoid falling into a second time. Reproduced: a note early in the body with ~20KB of trailing content grew 20076 -> 20088 bytes (a "truncation" that adds bytes, marked "truncated 7 characters" for what was actually a net *increase*); a note at the very start of the body with the same large trailing content produced 20057 -> 20057 — no shrink, no marker, the function silently doing nothing while still being on the truncation path. **Fixed:** `after` is now truncated from its own tail too (kept from its own start, right after the note; cut at its own end), sharing whatever budget remains once the note is accounted for, symmetrically with `before`. A hard floor was added: if the result isn't strictly smaller than the input, the untouched original is returned instead of a same-size-or-bigger body wearing a "truncated" marker that would be a lie. **Round 3, minor (item 7 in review): the two truncation code paths used two different marker strings, only one of which reported how much was cut** — unified into one `truncationMarker(cutChars)` used everywhere text is actually cut, always reporting the count.
   - **Round 3: extracted into its own module, `body-budget.ts`, specifically because the round-2 defects above shipped with zero coverage.** `boundBody` was only reachable through a full corpus → plan → CLI round trip; as a standalone, dependency-free module (no imports at all — Node's native TypeScript support strips types at load time, so it can be `require()`d directly with no local module to resolve and no CLI build needed) it gets direct unit tests instead, in `tests/cli/bootstrap-body-budget.test.js`: no-note, note-early-with-large-trailing-content (the exact growth repro), note-only (the note alone exceeds the cap with nothing around it — the hard floor's own test), and note-larger-than-the-cap-with-real-content-around-it (confirms a real shrink still happens even then). 28 checks, all passing.
   - **Compact JSON, not pretty-printed.** The original draft's `runSlice` used `JSON.stringify(slice, null, 2)`. 2-space indentation meaningfully inflates an array of PR/surface objects for no reader who needs it — the consumer is an agent parsing JSON, not a human skimming a terminal. Changed to `JSON.stringify(slice)` (no indent). Verified with a test asserting the CLI's stdout is single-line.
   - **Round 3, minor (item 11 in review): era units were getting the full, unfiltered surfaces inventory.** Round 1 considered and declined filtering `surfaces` by era, reasoning the entries were small either way — the coordinator pushed back: a story unit has no path scope to filter surfaces BY, and no use for the code inventory at all (that's an anatomy-wave hint), so handing it the whole thing contradicts "exactly the subset one unit needs" regardless of size. **Fixed:** an era-scoped unit's slice now carries `surfaces: []`. `w0-recon`/`w3-decisions`/`w3-status-arcs` are unaffected — none of them have an era slug, so this doesn't touch their whole-corpus access.

**Round 3's remaining minors (index-view.ts and bootstrap.ts):**
- **`index-view.ts`:** `tsvField`'s `fallback` argument was being passed `"-"` in the one call site (`product`) where it can never be used — `product` is already truthy at that point, so the fallback never runs. Simplified: `fallback` now defaults to `""` and the dead argument was dropped from every call site.
- **`bootstrap index --bundle foo.json`** (or any option-looking argument) was silently treated as the bundle *path itself* — `runIndex` never checked for an unrecognized option the way `runCorpus`/`runPlan` do, so a `--bundle` typo (modeled on `plan`'s real flag) produced a confusing `File not found: <cwd>/--bundle` instead of a clear error. **Fixed:** `runIndex` now rejects anything starting with `-` that isn't `-h`/`--help` via the shared `fail()` helper, matching every other subcommand.
- **`bootstrap slice` with no unit id** printed its usage text to **stdout** and exited 1 — inconsistent with every other error path in `bootstrap.ts`, which uses `fail()` (stderr). **Fixed:** the missing-argument case now calls `fail()`; `-h`/`--help` still print to stdout with exit 0, unchanged.

**Explicitly not changed, by the reviewer's own call:** `matchesPaths`/`matchesEras`'s case-sensitivity and `splitLabNoteSection`'s fenced-heading matching intentionally mirror `corpus.ts`'s `has_lab_note` detection exactly (same regex, same anchoring) — they can't produce a mismatch with each other by construction, so this wasn't touched.

**Why a new test file:** `tests/cli/bootstrap-plan.test.js` was already 660 lines / 73 checks by the time this task started, and a realistic `slice` test needs a full corpus (`bootstrap corpus --from-json`) *and* a full manifest (`bootstrap plan` against a real `profile.json`) — a meaningfully different fixture shape than `bootstrap-plan.test.js`'s profile/manifest-only setup. Matches the precedent Task 3 already set (splitting `bootstrap-corpus.test.js` out for the same size reason). **Task 9 must list `tests/cli/bootstrap-slice.test.js` in the `test:bootstrap` script** (already updated in Task 9's section below — check it's still there if Task 9 is re-planned).

The shipped `body-budget.ts` (round 3, new — see Task 4's finding 6 for the full story of what was wrong before this extraction):

```ts
const LAB_NOTE_HEADING_RE = /^##\s+Lab Note.*$/m;
const NEXT_HEADING_RE = /^##\s+/m;

export const MAX_BODY_CHARS = 4000;

export interface LabNoteSection {
  before: string;
  note: string;
  after: string;
}

export function splitLabNoteSection(body: string): LabNoteSection | null {
  const heading = LAB_NOTE_HEADING_RE.exec(body);
  if (!heading) return null;
  const noteStart = heading.index;
  const restStart = noteStart + heading[0].length;
  const next = NEXT_HEADING_RE.exec(body.slice(restStart));
  const noteEnd = next ? restStart + next.index : body.length;
  return { before: body.slice(0, noteStart), note: body.slice(noteStart, noteEnd), after: body.slice(noteEnd) };
}

function truncationMarker(cutChars: number): string {
  return `\n\n[… truncated ${cutChars} characters …]\n\n`;
}

function headTruncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.length - budget;
  return `${text.slice(0, budget)}${truncationMarker(cut)}`;
}

function boundAroundNote(section: LabNoteSection): string {
  const remaining = Math.max(0, MAX_BODY_CHARS - section.note.length);
  const beforeBudget = Math.floor(remaining / 2);
  const afterBudget = remaining - beforeBudget;
  return `${headTruncate(section.before, beforeBudget)}${section.note}${headTruncate(section.after, afterBudget)}`;
}

export function boundBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;

  const section = splitLabNoteSection(body);
  const bounded = section ? boundAroundNote(section) : headTruncate(body, MAX_BODY_CHARS);

  // Hard floor: never return something the same size as, or bigger than,
  // what was received. Closes both round-2 defects at once — a body that
  // used to GROW (when `after` was retained in full and large) and a body
  // that used to no-op silently (when `before` was empty and `after` was
  // retained in full) both now fall through to this and get the untouched
  // original back instead of a "truncated" body that's a lie either way.
  return bounded.length < body.length ? bounded : body;
}
```

`before` and `after` are truncated symmetrically — each keeps its own head and has its own tail cut, sharing whatever budget is left once the Lab Note itself is accounted for. The Lab Note is the only thing ever guaranteed to survive whole; everything around it, on either side, is subject to the same budget.

The shipped `era-window.ts` (round 3, new, shared with `profile-validate.ts` — full listing and the half-open reasoning are in Task 3's section, since the module lives there in the file tree but is used by both).

The shipped `slice.ts`:

```ts
/**
 * Resolve exactly the corpus subset one work unit needs.
 *
 * This is the method's primary token lever: an agent reads ~30-60KB of its own
 * slice instead of the whole mined corpus. Path matching is prefix-based on
 * repo-relative POSIX paths — a unit that owns `app/home` gets every PR that
 * touched anything beneath it. Era matching is date-range based: a wave-3
 * story unit's `slice.eras` names a slug, and this file looks that slug's
 * `from`/`to` window up in profile.json — see `eraWindows` below for why the
 * window lives there and not in the manifest itself.
 */
import { existsSync, readFileSync } from "node:fs";

import { boundBody } from "./body-budget";
import type { CorpusDoc, CorpusPr, CorpusSurface } from "./corpus";
import { readCorpusPrs } from "./corpus";
import { eraEnd, eraStart } from "./era-window";
import type { WorkUnit } from "./manifest";
import { readProfile } from "./manifest";
import { at, DOCS_FILE, PROFILE_FILE, SURFACES_FILE } from "./paths";
import { assertEraWindow } from "./profile-validate";

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

// Trade-off, accepted: a repo-relative path that legitimately contains a
// literal backslash in a filename would be mangled by this too. Judged
// vanishingly unlikely next to a Windows-style or copy-pasted path arriving
// in profile.json.
function toPosix(value: string): string {
  return value.includes("\\") ? value.split("\\").join("/") : value;
}

export function matchesPaths(filePath: string, paths: readonly string[]): boolean {
  const file = toPosix(filePath);
  return paths.some((raw) => {
    const p = toPosix(raw);
    return file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`);
  });
}

interface EraWindow {
  from?: string;
  to?: string;
}

// Round 3: two things enforced eagerly, both because profile.json can drift
// out from under an already-planned manifest without a re-plan. A slug with
// NO matching profile entry now throws (naming the slug and PROFILE_FILE) —
// it used to resolve to `{}`, an unbounded window that `matchesEras` then
// matched to nothing, so `bootstrap slice w3-<slug>` exited 0 with an empty
// `prs: []` and no signal anything was wrong. A slug that IS found is
// re-validated with the SAME assertEraWindow check `plan` already ran on it
// — not just trusted — because plan only validated it at plan time; a bound
// gone bad afterward would otherwise silently widen the window (reproduced:
// `from: "whenever", to: "2026-03-01"` widened to "everything before
// 2026-03-01" and one era's slice returned another era's PRs).
function eraWindows(cwd: string, slugs: readonly string[]): EraWindow[] {
  if (slugs.length === 0) return [];
  const profile = readProfile(cwd);
  const bySlug = new Map((profile?.eras ?? []).map((e) => [e.slug, e]));
  return slugs.map((slug) => {
    const era = bySlug.get(slug);
    if (!era) {
      throw new Error(
        `era "${slug}" is not declared in ${PROFILE_FILE}'s "eras" list, but a work unit's slice references it. ` +
          "profile.json may have been edited (or the era removed) since `arkaik bootstrap plan` last ran. " +
          "Restore the era in profile.json and re-run `arkaik bootstrap plan`, or reconcile the manifest by hand.",
      );
    }
    assertEraWindow(era);
    return { from: era.from, to: era.to };
  });
}

// Half-open, via era-window.ts (round 3 — see that file and Task 3's item
// 12 for why: inclusive bounds silently dropped every PR merged on a
// boundary day). A bound that's missing OR doesn't parse is discarded ("not
// usable"), not treated as "unbounded" — if only one side is discarded the
// other still constrains the match, but if BOTH end up discarded there is
// nothing left to constrain on, and returning true would be exactly the
// fail-open this function exists to prevent (round 2: reproduced with both
// bounds garbage, which used to match the entire corpus). `eraWindows`
// above now validates eagerly, so this is defense in depth, not the primary
// gate — kept anyway, on principle.
export function matchesEras(mergedAt: string, windows: readonly EraWindow[]): boolean {
  const merged = Date.parse(mergedAt);
  if (Number.isNaN(merged)) return false;
  return windows.some((w) => {
    const start = w.from !== undefined ? eraStart(w.from) : undefined;
    const end = w.to !== undefined ? eraEnd(w.to) : undefined;
    const usableStart = start !== undefined && !Number.isNaN(start) ? start : undefined;
    const usableEnd = end !== undefined && !Number.isNaN(end) ? end : undefined;
    if (usableStart === undefined && usableEnd === undefined) return false;
    if (usableStart !== undefined && merged < usableStart) return false;
    if (usableEnd !== undefined && merged >= usableEnd) return false;
    return true;
  });
}

export function resolveSlice(cwd: string, unit: WorkUnit): Slice {
  const paths = unit.slice.paths ?? [];
  const eraSlugs = unit.slice.eras ?? [];
  const allPrs = readCorpusPrs(cwd);
  const surfaces = readJsonArray<CorpusSurface>(at(cwd, SURFACES_FILE));

  let prs: CorpusPr[];
  let surfacesOut: CorpusSurface[];
  if (paths.length > 0) {
    prs = allPrs.filter((pr) => pr.files.some((f) => matchesPaths(f, paths)));
    surfacesOut = surfaces.filter((s) => matchesPaths(s.path, paths));
  } else if (eraSlugs.length > 0) {
    const windows = eraWindows(cwd, eraSlugs);
    prs = allPrs.filter((pr) => matchesEras(pr.merged_at, windows));
    // Round 3: a story unit works from PRs and, when it asks, the docs
    // manifest — never the code-surface inventory (an anatomy-wave hint,
    // keyed by path, and an era has no path scope to key it by).
    surfacesOut = [];
  } else {
    prs = allPrs;
    surfacesOut = surfaces;
  }
  prs = prs.map((pr) => ({ ...pr, body: boundBody(pr.body) }));

  const slice: Slice = {
    unit: unit.id,
    wave: unit.wave,
    scope: unit.scope,
    fragment: unit.fragment,
    prs,
    surfaces: surfacesOut,
  };

  if (unit.slice.docs) slice.docs = readJsonArray<CorpusDoc>(at(cwd, DOCS_FILE));

  return slice;
}
```

The shipped `index-view.ts`:

```ts
interface IndexNode {
  id?: unknown;
  species?: unknown;
  title?: unknown;
  metadata?: { product?: unknown } | null;
}

function tsvField(value: unknown, fallback = ""): string {
  const str = value === undefined || value === null ? fallback : String(value);
  return str.replace(/[\t\r\n]+/g, " ");
}

export function renderIndex(bundle: { nodes?: unknown }): string {
  const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as IndexNode[]) : [];
  const lines = ["id\tspecies\ttitle\tproduct"];
  for (const node of nodes) {
    const product = node.metadata && typeof node.metadata === "object" ? node.metadata.product : undefined;
    lines.push([tsvField(node.id), tsvField(node.species), tsvField(node.title), product ? tsvField(product) : "-"].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}
```

`bootstrap.ts`'s `runSlice` calls `console.log(JSON.stringify(resolveSlice(cwd, unit)))` — no `null, 2` — and wraps the call in a `try`/`catch` (needed since `resolveSlice` can throw via `readProfile`, `eraWindows`, or `assertEraWindow` re-validation). `runIndex` (round 3) now rejects an unrecognized option (anything starting with `-` that isn't `-h`/`--help`) via `fail()` before treating `argv[0]` as a path. Both cases are wired into the `switch` in `runBootstrap`.

Verification (as of round 3): full suite re-run —

| File | Checks | Notes |
|---|---|---|
| `bootstrap-corpus.test.js` | 39 | unchanged |
| `bootstrap-plan.test.js` | 84 | up from 82 (round 3's overlap-test corrections + the from-only-eras message test) |
| `bootstrap-slice.test.js` | 55 | up from 46 (boundary-day membership, missing-era-slug throws, stale-profile garbage-bound throws, era-units-get-no-surfaces) |
| `bootstrap-body-budget.test.js` | 28 | new, direct-require, no CLI build needed |
| `bootstrap-era-window.test.js` | 12 | new, direct-require, no CLI build needed |

All passing, plus `npm run test:cli` (63 + 4 version checks, unaffected), `npx eslint` on every touched `.ts` file (clean), and `npx tsc --noEmit` (0 errors). Verified directly against the reviewer's own reproduction data: all 12 real PR bodies sampled from this repo's scratchpad retain their Lab Note after `boundBody`, none grew, none silently no-opped.

- [ ] **Commit**

```bash
git add packages/cli/src/lib/bootstrap/slice.ts packages/cli/src/lib/bootstrap/index-view.ts packages/cli/src/lib/bootstrap/manifest.ts packages/cli/src/lib/bootstrap/profile-validate.ts packages/cli/src/lib/bootstrap/era-window.ts packages/cli/src/lib/bootstrap/body-budget.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-slice.test.js tests/cli/bootstrap-plan.test.js tests/cli/bootstrap-body-budget.test.js tests/cli/bootstrap-era-window.test.js docs/superpowers/plans/2026-08-04-bootstrap-method.md
git commit -m "fix(cli): bootstrap slice — half-open era windows, Lab Note truncation fixes, extract profile-validate/era-window/body-budget"
```

---

### Task 5: Deterministic event ids

`makeEvent` mints a random ULID, which would make merge output differ run to run. Bootstrap constructs history, so its event ids must be a pure function of what the event *is*.

**Implementation note (post-review, six probes, all with real measurements — not accepted on the strength of reading):** the reference code below was written from memory and never run; per this plan's own running tally, that has meant roughly two real defects per task so far. All six were checked empirically, not just read:

1. **Entropy really was only 32 bits, not 80 — measured, not assumed.** The reference derived its whole 16-char tail from one 32-bit FNV-1a hash of `key`, then repeatedly perturbed that single value. Perturbing a value never adds information to it: the entire tail is a deterministic function of 32 bits, so the real collision space is 2^32, not 32^16. Measured directly: among 1,000,000 sequential synthetic keys sharing one `ts`, the reference design produced 8 real id collisions. Against the self-map seed's own real journal (791 events, max 15 sharing one `ts`), the risk at that scale is negligible either way — but the fix costs nothing, so it shipped rather than being left as "probably fine today." **Fixed:** each of the 16 output symbols is now its own independent hash of `key` (salted by position) instead of one value perturbed 16 times.
2. **The `|| 0x811c9dc5` zero-state guard was a real, reachable bug, not a theoretical one.** A 32-bit mixing step can legitimately land on exactly 0; when it did, the reference substituted the FNV offset basis, and two different keys hitting the zero state at the same loop iteration would converge to an identical tail from then on — the substitution erases whatever made them different. **Fixed by construction, not by a better guard:** the new design has no rolling accumulator at all, so there is no absorbing state to protect against. (A hash landing on a multiple of 32 now just selects symbol `'0'` — an ordinary output, not a special case.)
3. **A first "16 independent hashes" attempt was tried and measured, and it was also wrong.** `fnv1a(`${i}:${key}`) % 32` per symbol — independent per symbol, but still broken: at 1,000,000 sequential synthetic keys it produced **616,688 real collisions (only 383,312 distinct suffixes survived)** — collisions between near-identical keys (e.g. differing only in a trailing sequence number), because FNV-1a's low bits are known to mix poorly for short, similar inputs. **Fixed:** each per-symbol hash is run through Murmur3's `fmix32` finalizer before extracting bits. Zero collisions among the same 1,000,000 keys afterward.
4. **Coexistence with real ULIDs was verified by direct comparison, not by reading.** `tests/cli/bootstrap-event-id.test.js` loads the actual `ulid()` from `@arkaik/schema` (via `tests/schema/load-schema.js`, the same loader `tests/schema/emit.test.js` uses) and compares its time prefix against this module's `encodeTime` byte-for-byte across several timestamps. They match — same alphabet, same length, same mod/divide loop — so a brownfield journal's real ULIDs and this module's synthetic ids sort correctly together.
5. **Unparseable/missing `ts` now throws instead of silently encoding epoch 0.** The reference did `Number.isNaN(ms) ? 0 : ms` — an id that sorts before every real event, with no signal anything was wrong. Given how many of this run's real defects have been exactly this shape, `deterministicEventId` now throws, naming the offending `ts`, when `Date.parse` can't read it. **This changes a downstream assumption Task 6 needs to know about — see Task 6's own notes below.**
6. **The id does not need to be a valid ULID — `journal-events.ts`'s envelope is `id: z.string()`, no format check, and nothing checks id uniqueness either.** The properties that actually matter are determinism, sortability against real ULIDs, and collision resistance (points 1-4). The 26-char ULID shape ships anyway — it's free, it matches what a brownfield journal's real ids already look like, and `bootstrap merge`'s own determinism test asserts it — but it's a courtesy, not the contract.

A seventh finding is about the *caller*, not this file, and is carried to Task 6 rather than fixed here: **key uniqueness is out of scope for `deterministicEventId` and cannot be fixed by better hashing.** `deterministicEventId(ts, key)` guarantees identical output for identical input — including when a caller hands it two semantically different events that happen to share a key. Task 6's reference `merge.ts` below has real gaps of exactly this kind; see Task 6's updated notes.

**Files:**
- Create: `packages/cli/src/lib/bootstrap/event-id.ts`
- Test (this task, not Task 6 — see Task 6's own Step 1): `tests/cli/bootstrap-event-id.test.js`
- Test: `tests/cli/bootstrap-merge.test.js` (unaffected by this task; written by Task 6)

**Note:** unlike every other task so far, this task's failing test is NOT `arkaik bootstrap merge` against a built CLI — the `merge` subcommand doesn't exist until Task 6 wires it up, and `tests/cli/bootstrap-merge.test.js` (with its own determinism checks) is created there, not here. This task's test is a direct-require unit test against the pure function alone, which is exactly why it can run before `merge` exists at all.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/bootstrap-event-id.test.js` — a direct-require unit test following the pattern `tests/cli/bootstrap-era-window.test.js` and `tests/cli/bootstrap-body-budget.test.js` established (Node's native TypeScript support strips types at load time, so the `.ts` source loads with no CLI build). Cover: determinism (same `(ts, key)` always yields the same id); different keys at the same `ts` yield different ids while sharing the same time prefix; the same key at different timestamps yields a different id with an unchanged suffix; ULID shape; an unparseable/missing/undefined `ts` throws, naming the offending value; a direct byte-for-byte comparison of `encodeTime` against the REAL `ulid()` from `@arkaik/schema` (load it via `tests/schema/load-schema.js`, the loader `tests/schema/emit.test.js` already uses); lexicographic sortability across digit-rollover boundaries; a 20,000-key collision-resistance stress test at one shared `ts` (roughly 1,300x, more than three orders of magnitude, past the self-map seed's own real max fan-out of 15); a golden/pinned-value check on three hardcoded ids, guarding cross-version stability (not just within-process determinism — see the test file's own comment on why this is the right place for hardcoded expected values); and a real-data check against `seed/arkaik-self-map.json`'s own journal (791 events) — re-derive each event's key using the two shapes Task 6's `merge` actually uses (`node.created:<id>` and the wave-3 `${type}:${node_id|deliverable_id|version}:${ts}` form) and assert zero id collisions across the whole file.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/cli/bootstrap-event-id.test.js`
Expected: FAIL — `Cannot find module '.../event-id.ts'`.

- [ ] **Step 3: Write `event-id.ts`**

Create `packages/cli/src/lib/bootstrap/event-id.ts`. The shape, informed by the six probes above:

```ts
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // same alphabet as @arkaik/schema's ulid()
export const TIME_LEN = 10; // 48 bits of ms timestamp, same width as ulid()
export const RANDOM_LEN = 16; // same width as ulid()'s random component; here every bit comes from `key`

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

// Murmur3's fmix32 finalizer — fixes FNV-1a's weak low-bit avalanche (probe 3).
function fmix32(hIn: number): number {
  let h = hIn >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function encodeTime(ms: number): string {
  let remaining = Math.max(0, Math.floor(ms));
  let out = "";
  for (let i = 0; i < TIME_LEN; i += 1) {
    const digit = remaining % 32;
    out = ENCODING[digit] + out;
    remaining = (remaining - digit) / 32;
  }
  return out;
}

// Each symbol is its OWN independent hash of `key` (salted by position) —
// not one accumulator perturbed 16 times (probe 1) — with no rolling state
// left to get stuck in a zero absorbing state (probe 2).
function keySuffix(key: string): string {
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    const h = fmix32(fnv1a(`${i}:${key}`));
    out += ENCODING[h % 32];
  }
  return out;
}

/**
 * A stable id for the event identified by `key` at `ts`. `ts` must be a
 * parseable timestamp — an unparseable or missing one throws rather than
 * silently encoding epoch 0 (probe 4). `key` must uniquely identify the event
 * being minted; that is the CALLER's responsibility, not this function's
 * (probe 6 — see Task 6's notes).
 */
export function deterministicEventId(ts: string, key: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    throw new Error(`deterministicEventId: ts is not a parseable timestamp: ${JSON.stringify(ts)}`);
  }
  return encodeTime(ms) + keySuffix(key);
}
```

(The shipped file's own comments carry the full probe-by-probe rationale — read it directly rather than duplicating it here a third time.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/cli/bootstrap-event-id.test.js`
Expected: PASS on all checks, including the real-data check against the self-map seed.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/bootstrap/event-id.ts tests/cli/bootstrap-event-id.test.js
git commit -m "feat(cli): deterministic event ids for bootstrap merge"
```

---

### Task 6: `bootstrap merge` — shipped, findings below (this task is where everything lands)

**This is the biggest and most consequential task in the plan, and it shipped with more changes than the carry-forward block alone asked for — across TWO review passes.** The carry-forward block below (Task 5's review) is kept verbatim as the historical record — all three items are resolved, marked inline. This task's own probing (the seven the task brief specified, plus self-review) found **four more real defects**, one of them severe enough that it would have broken Task 7's and Task 9's own reference test fixtures the moment either task ran, without either task's own tests being wrong. A SECOND review pass, by the coordinator, after this task's own probing was believed complete, found **one more critical defect that this task's own probing had missed** — its own carry-forward-3 regression fixture merged "cleanly" while producing a bundle that failed `arkaik validate`, because that fixture never actually called validate — plus a real ergonomic gap in the journal-merge precedence. Both rounds are recorded below, in order; read the whole thing before touching `merge.ts`, `fragments.ts`, or `bootstrap.ts`'s `runMerge` again.

**Carried forward from Task 5's review — three things to fix or explicitly accept before shipping this, don't silently inherit them (all three fixed, see below):**

1. **`merge` never dedups the journal by event id — which makes the deterministic id's whole purpose unreachable as this file is written.** The reference `mergeFragments` below ends with `sortEvents([...input.baseJournal, ...newEvents])` — a sort, with no dedup. `loadFragments` iterates every `manifest.units` entry with no `done`/`rejected` filter, and `baseJournal` is read straight back from the existing `journal.jsonl` on disk. So on a **second** `merge` over the same, unchanged fragments: every wave-3 story event is re-pushed alongside its own run-1 copy, and **the journal doubles in size** — silently, since both copies have the same `id` (that's the point of a deterministic id) but nothing collapses them. Pass 1's `node.created` synthesis is idempotent only *incidentally* (the `nodes.has(id)` guard); the `events` path has no equivalent guard. **Fixed:** a `mergeJournal(base, fresh)` helper merges by `id` — base's copy wins on a collision — and `counts.eventsAdded` reports only genuinely-new ids. Regression test: `tests/cli/bootstrap-merge.test.js`'s "carry-forward 1" block scaffolds an `events`-carrying fragment, merges three times, and asserts the journal's line count AND byte length never grow past the first run.
2. **`deterministicEventId` now throws on an unparseable/missing `ts`** instead of silently encoding epoch 0 (Task 5, probe 4). The reference `mergeFragments` calls it unguarded in multiple places — a single malformed fragment (a bad `created_ts`, or a story event's `ts`) would crash the whole merge with an uncaught exception instead of surfacing as a `MergeProblem` naming the offending unit. **Fixed:** every call site is wrapped via a shared `mintEvent` helper that catches the throw and pushes `{ unit: unit.id, message: ... }` naming the unit and the bad `ts`, matching the existing error-collection style. Regression tests: "carry-forward 2" block covers both the `node.created` path (bad `created_ts`) and the wave-3 `events` path (bad event `ts`), asserting a clean exit-1 with the unit name and the bad value in stderr — explicitly NOT a raw stack trace.
3. **The wave-3 event key (`${type}:${node_id ?? deliverable_id ?? version ?? ""}:${ts}`) is not actually unique per event — confirmed, not just suspected.** Real gaps: `idea.proposed`/`request.filed` with no `node_id` collapse to `type::ts` (every such event on a day collides, by construction); `release.tagged` omits `platform` (two same-day per-platform releases collide); `node.status_changed`/`decision.status_changed` key on `node_id` + `ts` alone (a node crossing two statuses on one day collides — exactly what the wave-3 "status arcs" unit plans to emit, 1-3 events per node). **Fixed:** a new `eventKey(raw, ts)` folds in every identifying field a known event carries when present — `node`, `deliverable`, `version`, `edge`, `ref`, `source`/`target`, `platform`, `from`/`to`, `title`, `url` — so two events differing in any of them get different keys and thus different ids. Regression tests: "carry-forward 3" block covers same-day/same-node status transitions with different `from`/`to`, same-day/same-version different-platform releases, and same-day node-id-less ideas — all three now get distinct ids, verified against the built CLI, not by reading the key-building code.

**This task's own probing found four more defects, beyond the carry-forward block:**

4. **Probe 1 (status changes without journal events) was real, and severe: retire/update mutated `status` with zero journal event.** Verified against the real validator, not by reading: `crossCheckJournal`'s `journal-status-mismatch` only compares the journal's LAST recorded `node.status_changed.to` against the snapshot — a node with **no** status-changed history has nothing to disagree with, so this bug was silent for a node's first-ever status change but **loud for every subsequent one**. That's exactly the brownfield reconcile shape: an existing map's nodes typically already carry real status history from before bootstrap ever ran. Reproduced directly (not just reasoned about): a node created `"development"`, given one prior `node.status_changed` event to `"development"`, then reconciled to `"live"` via `update` with no fix — `arkaik validate` fails with `ERROR [journal-status-mismatch] journal: Node "V-home": journal's last node.status_changed.to "development" disagrees with snapshot status "live".` **Fixed:** both `update` (when the patch touches `status`) and `retire` now record the node's status before mutating it and, when it actually changed, emit a `node.status_changed` (`actor: "bootstrap"`, real `from`/`to`) at the fragment's own optional `changed_ts` (new field on `FragmentUpdate`/`FragmentRetire`) or the merge's fallback ts. Verified fixed the same way it was verified broken: the reproduction above now passes `arkaik validate` cleanly; a parallel retire-with-prior-history fixture confirms the same for `retire`.
5. **Probe 2 (node.created for brownfield nodes) — confirmed correct, no fix needed.** A brownfield node re-declared with the same id AND title is silently skipped (idempotent, no duplicate `node.created`); a node with the same id but a DIFFERENT title collides loudly (see finding 7 below — this got STRICTER, not looser); a genuinely new node alongside an existing one gets exactly one `node.created`, the existing one gets none. All three verified against a built CLI with a real `journal.jsonl` and `arkaik validate`, not by reading `nodes.has(id)`.
6. **Probe 4 (`serializeBundle` → `parseBundle` → `validateBundle` round trip) surfaced a real zod/validateBundle parity gap: `platforms` is required by the zod schema even on `decision` nodes, which `validateBundle` itself exempts from the non-empty check.** A decision fragment that omits `platforms` (a very plausible thing for an agent to do — decisions are platform-agnostic by spec, so `platforms` feels irrelevant) would pass `arkaik validate` cleanly but fail `parseBundle`'s stricter shape check. **Fixed:** every added node with a missing/non-array `platforms` gets it defaulted to `[]` — safe for every species, since `[]` triggers the exact same `validateBundle` error path `undefined` did for every non-decision species (this changes nothing there), while being the semantically-correct value for a platform-agnostic decision. `delete bundle.journal` (the repo's own bundle is sidecar-only per docs/spec/journal.md — "never inside it") was also confirmed to do the right thing: a merged bundle now round-trips through `parseBundle` and comes back byte-identical through `serializeBundle` again (a genuine fixed point), verified directly against the real zod schema via `tests/schema/load-schema.js`'s transpile-to-CommonJS loader, not assumed.
7. **Self-review, not from a numbered probe: node id collisions were only ever caught WITHIN one merge invocation, never across separate invocations — the reference's own collision-detection mechanism was silently inert for anything already persisted.** `nodeOrigin` was only populated for nodes added THIS run; a base node (from a prior merge, or pre-existing brownfield content) had no recorded origin, so the reference's `if (owner && existingTitle !== incomingTitle)` guard was unreachable for it (`owner` always `undefined`). Reproduced: run 1 adds `V-shared` titled "First Meaning" and persists it; a LATER, unrelated fragment (as if from a different area's agent, re-run weeks later) declares the same id with a totally different title, "Different Meaning" — the reference discarded it with **zero error**, silently keeping "First Meaning" and dropping the second agent's entire node. **Fixed:** base nodes are now seeded into `nodeOrigin` too (with a sentinel label), so the same "same id, different title" check runs whether the pre-existing node came from this run's earlier fragments or from before this run started. The ordinary idempotent-rerun case (same id, same title) is unaffected — still silently accepted, not an error.

**A fourth, unrelated defect, found the same way (probe 4's round trip, not by reading):**

8. **`FragmentEdge.kind` never translated to the bundle's `edge_type` field — every edge fixture in this entire plan (Task 7's AND Task 9's) would have produced an invalid bundle.** Every edge fixture anywhere in this plan — Task 6's own Step 1 test didn't have edges, but Task 7's collision/reconcile tests and Task 9's golden e2e test all write `edges: [{ source_id, target_id, kind: "composes" }]` (`kind` is `FragmentEdge`'s own declared field name in the reference). The bundle schema's field is `edge_type` (`EdgeSchema`, `validate.ts`'s `valid-edge-type` check). The reference `mergeFragments` spread the raw fragment edge straight onto the merged edge with no translation at all — every merged edge would have silently carried `kind` and no `edge_type`, which `validateBundle` rejects outright (`invalid edge_type "undefined"`) and `parseBundle` rejects too (`edge_type` is a required enum). **This was invisible to every test written so far**, including this task's own Step 1 (no edges in that fixture) — it would have surfaced the moment Task 9's e2e test (which DOES call `arkaik validate` on a bundle with edges) actually ran. Caught here via probe 4's round trip against a fixture with a real `kind: "composes"` edge. **Fixed:** pass 2 now resolves `edge_type` from either `edge_type` (if a fragment supplies it directly) or `kind` (the documented field), and drops the bare `kind` key from what lands on the bundle; an edge with neither fails the merge loudly, naming both endpoints. **Task 7 and Task 9: your existing planned fixtures (`kind: "composes"`, `kind: "calls"`) now work correctly — no fixture change needed on your end, but if either task's own review re-derives `merge.ts` from an older read of this plan, make sure this translation is still there.**

**Coordinator review, round 2 (after this task believed it was done) — one critical defect this task's own probing missed, one real ergonomic gap, and a systemic lesson about how the critical one slipped through:**

9. **CRITICAL: this task's own fixes for items 3 and 4 combine to reintroduce `journal-status-mismatch` — verified, not theoretical.** `sortEvents` (`merge.ts`) ties-breaks two events sharing a `ts` by their `id` — a hash-derived string with no relationship to which transition actually happened first. That would be harmless if write order were all that mattered, but it isn't: `crossCheckJournal` re-derives read-back order independently, via `@arkaik/schema`'s `orderEvents`, using the IDENTICAL `(ts, id)` rule — so whether the snapshot ends up agreeing with the journal's "last" status for a node came down to whether a hash happened to agree with causality, a coin flip per colliding pair. And item 4's `update`/`retire` emission shares ONE `fallbackTs` across a whole run when a fragment omits `changed_ts` — so two status changes to one node in a single run get IDENTICAL `ts` by construction. Reproduced: a fragment with `update: [{status: backlog}, {status: development}]` on a node starting at `idea`, no `changed_ts` — merge succeeds, then `arkaik validate` reports `journal-status-mismatch`. **Worse: this task's own carry-forward-3 regression fixture (item 3 above) reproduced this exactly** — two `node.status_changed` events for one node, same `ts`, different `from`/`to` — and that fixture asserted `ids.size === 2` and exit 0, then stopped; it never called `arkaik validate`, so it passed while proving nothing about safety. This is the shape the task brief specifically flagged as expected input, not an edge case: wave-3 status arcs reconstruct 1-3 transitions per node at day granularity, so same-`ts` multi-transition is what real story fragments will look like. **Fixed by refusing, not guessing:** `isOrderSensitive` identifies the two event types `crossCheckJournal` actually orders by "last one wins" per node — `node.status_changed` when not platform-scoped (a platform-scoped one moves a per-platform view status, which nothing cross-checks against the snapshot), and `decision.status_changed` always. `pushEvent`, the single path every new event now reaches `newEvents` through, tracks the one already seen for each `(type, node_id, ts)` — seeded from `baseJournal` too, so a fresh event colliding with committed history is caught, not just fresh-vs-fresh within one run — and on a SECOND, genuinely different one (a different id, meaning a different transition) at the exact same instant, raises a `MergeProblem` naming the node, both transitions, and both units, instead of writing an order nobody chose. A resort inside `merge.ts` could not fix this even if it wanted to, since `orderEvents` re-derives order on every future read regardless of what order this file wrote — the real fix is distinct timestamps, which the corpus already carries (full ISO instants, not just dates) for a story agent to supply via `changed_ts`/`ts`. **The carry-forward-3 fixture was corrected**, not just left broken-but-passing: the two transitions now carry distinct instants (`00:00:00` and `12:00:00` on the same day — the realistic shape a story agent produces), and the test asserts `arkaik validate` passes on the result, not just that ids differ. Three more regression tests were added: the identical scenario spread across TWO fragments/units instead of one (proving the guard tracks the whole run, not one fragment's array); confirmation that DIFFERENT nodes sharing a `ts`, and platform-scoped transitions for the SAME node at the SAME `ts`, are NOT falsely rejected.
10. **Important: `mergeJournal`'s "base wins" precedence (item 1) is the right call, but was silently wrong-ergonomic on genuine divergence.** Base winning on an id collision is correct — the append-only-journal invariant, and "fresh wins" would let a re-run silently clobber a deliberate, out-of-band edit to committed history, which is worse — and that precedence is unchanged. But it was entirely silent even when the fresh event's PAYLOAD actually differs from what's committed. Reproduced: merge a story event, edit only its `summary` (not part of `eventKey`, so the id is unchanged) in the same fragment, re-run — `+0 events`, journal unchanged, the correction discarded with output indistinguishable from "nothing changed." **Fixed:** `mergeJournal` now compares a colliding fresh event against its committed counterpart via `canonicalJson` (key-order-independent, so a re-read-from-disk event and a freshly-constructed one with the same content in different key order don't false-positive) and returns any genuine divergence as a `conflict`; `mergeFragments` turns each one into a `MergeProblem`, attributed to whichever unit produced the fresh event (tracked via an `eventUnit` map populated alongside `pushEvent`) — the same treatment already given to a node-id collision with differing titles. Base still wins (nothing is silently overwritten); the run refuses instead of hiding the divergence. Identical payloads (the ordinary idempotent re-run — already exercised three times over by the carry-forward-1 dedup test) stay a silent no-op, unaffected.
11. **The systemic lesson, applied across the whole file, not just the one fixture that revealed it:** the critical defect (finding 9) slipped through this task's own extensive probing because ONE test — the one built specifically to prove the fix for finding 3 — stopped one line short of running `arkaik validate`, the exact check that would have caught it. This is the same class of gap as nearly every other defect in this entire plan: the check that would have caught the bug wasn't run against the real thing. **Every block in `tests/cli/bootstrap-merge.test.js` that produces a bundle now runs `arkaik validate` on it and asserts clean** — audited block by block, not just the ones already believed interesting (those are precisely the ones already reasoned about correctly; the blind spots are always the "obviously fine" ones). The file's own header comment now states this as a standing rule for anyone adding to it. Checks that expect an outright merge FAILURE (a malformed `ts`, an orphan edge, an unsafe id, `--dry-run` which writes nothing) are the only exemptions, each one noted at its own call site so the exemption is a deliberate call, not an oversight.

**Coordinator review, round 3 — the reviewer read `crossCheckJournal` side-by-side with this file and found the guards still didn't match its contract. The pattern across all five items: each fix round wrote its guard against the case that motivated it, not against what the validator actually checks.**

12. **CRITICAL: `decision.status_changed` is never synthesized — the exact symmetric hole of the node-status fix (finding 4), one screen away in `isOrderSensitive`, which already named the type.** `journal-decision-status-mismatch` compares the journal's last `decision.status_changed.to` against `metadata.decision_status` the same way `journal-status-mismatch` compares `node.status_changed` against `status` — nothing minted this event for a decision. Reproduced: `merge` exits 0, `arkaik validate` exits 1 with `ERROR [journal-decision-status-mismatch] Node "DEC-x": journal's last decision.status_changed.to "proposed" disagrees with snapshot decision_status "accepted".` Reachability was worse than it looked because of finding 14 below: before that fix, ANY `update` touching `metadata` for an unrelated reason wiped `decision_status` entirely (wholesale replace), flipping the snapshot to the `"proposed"` default and firing this same error even when an agent never intended to touch decision status. **Fixed:** mirrors the node fix exactly — `metadata.decision_status` is captured before the metadata merge (defaulted to `"proposed"` when absent, matching `crossCheckJournal`'s own `snapshotDecisionStatus.set(id, decisionStatus ?? "proposed")`), and a `decision.status_changed` is minted when it actually moved and the patch actually touched `decision_status`.
13. **Important: the order-sensitivity refusal (finding 9) was refusing on `id` inequality when `crossCheckJournal` reads exactly one field off these events — `to`.** Two demonstrated false refusals: a real ULID already in the base journal (written by `arkaik log`, before bootstrap ever ran) and a wave-3 fragment mining the same PR into the IDENTICAL transition at the IDENTICAL `ts` get DIFFERENT ids (one's a real ULID, one's deterministic) but the SAME `to` — the validator cannot disagree with itself, so refusing this pair was a false positive; same `to`, different `from` is equally benign and was equally refused. Worse, the refusal's own remedy message ("give one a distinct timestamp") was **actively wrong** for the brownfield case: appending a "distinct" timestamp would fabricate a duplicate transition in an append-only journal — the correct fix there is "this transition is already recorded, drop it from the fragment," which the message never said. **Fixed:** the criterion is now `String(existing.to) !== String(ev.to)`. When `to` matches, accept quietly (whatever `id`/`from` say) — the payloads are interchangeable for every check that reads them, which also removes the ULID-vs-deterministic special case entirely rather than trying to detect and exempt it. When `to` genuinely differs, the refusal (and its message, unchanged for this narrower, now-correct case) still applies — that's the one shape where read-back order actually decides which status the snapshot must agree with. Verified both directions: the brownfield-re-derivation and same-to-different-from cases are now accepted (and both events land in the journal — accepting isn't the same as deduping by content, only `mergeJournal`'s id-based dedup does that); the genuine-conflict case (different `to`) is still refused, confirmed by the pre-existing regression test for it.
14. **Important: `update`'s `metadata` patch replaced wholesale (shallow `Object.assign`), silently erasing every other metadata field.** Reproduced exactly as reported: base `{"refs":[...],"stage":"beta"}` + patch `{"metadata":{"product":"studio"}}` → result `{"product":"studio"}` — refs, stage, decision context, playlist, anything else on the node's metadata, gone, with exit 0 and no signal. This directly contradicts the file's own opening rule ("Bootstrap never deletes — removal stays a human act") and was inconsistent with `retire` five lines away, which already merges metadata correctly (`{ ...metadata, retired_reason }`). **Fixed:** `update` now deep-merges `metadata` the same way `retire` does — `{ ...existingMetadata, ...patchMetadata }` — rather than letting `Object.assign` overwrite the whole `metadata` key. Verified: a patch touching one metadata field now leaves every other pre-existing field (`refs`, `stage`, `context`) intact.
15. **Important: `canonicalJson` rendered the literal token `undefined` for an explicitly-undefined property, so a freshly-minted event could never compare equal to its own `JSON.stringify` round-trip (which drops the key entirely) — every "divergence" this produced (finding 10, round 2) was two byte-identical payloads presented as a conflict, unactionable.** Reproduced directly at the function level. **Fixed:** `canonicalJson` now skips `undefined`-valued object keys (matching `JSON.stringify`'s own behavior) and renders an `undefined` ARRAY element as `null` (also matching `JSON.stringify`'s array-hole behavior) — closing the whole class, not just the reported instance.
16. **Important: make `merge` actually validate, since two places in the file already claimed it does.** `bootstrap.ts`'s own file doc says this command group owns "validation gating," and `MERGE_USAGE` said "then validate" — neither was true; `runMerge` wrote unconditionally and left `arkaik validate` as a suggestion for afterward. Finding 12 above is precisely what that missing gate would have caught before it ever reached disk. **Fixed:** `runMerge` now calls `validateBundle` over `{ ...result.bundle, journal: result.journal }` (a throwaway copy for validation only — `result.bundle` itself, what's actually serialized, stays journal-free per the sidecar-only design; `validateBundle` already runs `crossCheckJournal` internally when a `journal` is present, so no separate call is needed) before writing anything. **Errors block the write and exit 1** (with each finding printed via `formatFinding`, the same formatting `arkaik validate`'s own CLI uses); **warnings are reported but never fail the run** — a partial, in-progress bootstrap (wave 1 of 3) legitimately has warnings, and warning-clean is the OPERATOR's own gate at the end (running `arkaik validate` once every wave is done), not a gate `merge` should impose on every single invocation. Verified against the real self-map proof: the full 220-node/411-edge merge now prints `Validated clean — written.` before writing, and the CLI's final "Next: arkaik validate ..." suggestion (now redundant, since validation already ran) was replaced with a summary of what validation actually found.
17. **Important: the journal algebra — `sortEvents`, `canonicalJson`, `eventKey`, `isOrderSensitive`, `mergeJournal`, `JournalConflict` — extracted to a new zero-import module, `journal-merge.ts`, with its own direct-require tests.** Same reasoning as Task 4's extraction of `era-window.ts`/`body-budget.ts` from `slice.ts`: this ~130-line layer is where three of round 3's four fixes landed, it's the newest code in the whole bootstrap surface, and until this extraction it had zero direct tests — every behavior was reachable only through a full CLI-spawn-plus-fixture round trip (`canonicalJson({a: undefined}) !== canonicalJson({})` is a two-line direct test; through the CLI it took a four-step fixture with a hand-edited bundle). **`merge.ts`'s two-pass-plus-a-pass structure (nodes, then edges, then story events) was deliberately NOT split further** — passes 1/2/3 share mutable state (`nodes`, `edges`, `nodeOrigin`, `edgeOrigin`, `orderSensitiveSeen`, `eventUnit`) and the ordering between them (all nodes before any edge, so pass 2 can see nodes from every fragment) IS the design; one function that reads top-to-bottom beats threading a context object through three modules for the sake of file-size alone. Direct tests: `tests/cli/bootstrap-journal-merge.test.js` (27 checks) — key-order independence, the exact `undefined`-vs-absent-key bug and its fix, order-sensitivity per event type, `eventKey` distinguishing on every identifying field including key-order-independent object-valued `from`/`to`, and `mergeJournal`'s dedup/base-wins/conflict-detection behavior directly, with no fixture or CLI build involved.
18. **Also from round 3, folded into the extraction: `stringify` (the helper `eventKey` used to turn a non-string field value into a key segment) now routes its non-string branch through `canonicalJson` instead of raw `JSON.stringify`.** `NodeUpdatedEvent.from`/`.to` are typed `unknown` in the schema and can legally be objects; raw `JSON.stringify` is key-order DEPENDENT, so two equivalent objects differing only in property order would have produced different keys — and thus different ids — for "the same" event. This changes every id `deterministicEventId` derives from a key touching a non-string field, for any event that reaches this path — done now, deliberately, before any real journal exists from this code, specifically so it never has to be done later against committed history.
19. **Minor: dead fallbacks removed.** `nodeOrigin.get(id) ?? "(already in the bundle)"` and `eventUnit.get(conflict.id) ?? "(unknown unit)"` could never actually take their fallback branch — every id that reaches either call site is guaranteed to have an entry (seeded from base, or recorded when added/pushed earlier in the same run) — so both fallbacks silently asserted "this can happen" when it structurally cannot. Replaced with a type assertion and a comment explaining why, rather than a misleading default.
20. **Minor: documented, not changed — a fragment-supplied event `id` (pass 3, wave-3 `events`) is honored as-is and NOT validated against `eventKey`/`deterministicEventId`.** An agent that hand-mints an id (e.g. reusing a real ULID already in the corpus) is trusted to have done so correctly; `mergeJournal`'s de-dup/conflict logic treats it like any other id either way. Documented inline rather than silently relied upon.
21. **Minor: documented, not changed — omitting `changed_ts` on `update`/`retire` is a ONE-SHOT budget per node, not a free pass, because the merge's `fallbackTs` is a single constant value for the entire invocation.** A single status-changing op for a node can omit `changed_ts` safely; a SECOND one for the SAME node in the SAME run that also omits it collides at the identical `ts` and hits finding 13's refusal (when the two disagree on `to`) or lands as a redundant-but-harmless second entry (when they agree). Documented on `FragmentUpdate`/`FragmentRetire` in `fragments.ts`.
22. **Minor: edge-type disagreement between two fragments is now a loud error, matching the node-title-collision treatment.** An edge id encodes only its endpoints (`e-{source}-{target}`), so it can hold exactly one type — two fragments declaring the SAME `(source, target)` pair with DIFFERENT `kind`/`edge_type` values used to silently keep whichever was processed first (flagged as unresolved for Task 7 in finding 8's writeup above; closed here instead, since it's the same shape as the node-collision check already in this file). Agreement (same type from both fragments) stays a silent, correct no-op.
23. **Minor: the 143-line historical preamble that used to open `merge.ts` — narrating what the plan's original reference code got wrong, round by round — has been relocated here, onto the findings it documents, rather than living at the top of the file it governs.** This section (items 1-23) IS that preamble now; `merge.ts`'s own header comment is a short, current-state description plus a pointer to this section, matching the precedent this file itself set for `body-budget.ts`/`era-window.ts`'s relationship to Task 4's writeup.

**Explicitly out of scope, flagged for Task 9's non-atomic-write concern:** `runMerge` writes `bundle.json` and `journal.jsonl` as two separate `writeFileSync` calls — a process killed between the two leaves the bundle and journal out of sync (a real risk, not a hypothetical one, for a long-running multi-wave bootstrap). This is real but out of scope for Task 6 — Task 9's own file doc should note it (a temp-file-plus-rename pattern for both writes, or a single combined write, are the two obvious fixes) so it isn't rediscovered independently.

**Probes 3, 5, and 6 — verified clean, no code changes required beyond what's already described above:**

- **Probe 3 (determinism end to end).** Running `merge` twice over identical fragments (including an `events`-array fragment) produces byte-identical `bundle.json` and `journal.jsonl` both times — verified via the built CLI, both on synthetic fixtures and on the full real self-map dataset (below). `updated_at` falls back to the base project's own `updated_at` when the resulting journal is empty (no crash, no `undefined`). The one non-determinism that DOES exist — a freshly-scaffolded bundle's `project.created_at`/`updated_at` are stamped with `new Date().toISOString()` on the very first merge ever run against an empty repo — is inherent (there is no historical timestamp to derive a project's own creation moment from) and does not affect re-run determinism, because every subsequent run reads that timestamp back from the now-persisted bundle rather than re-minting it.
- **Probe 5 (empty and degenerate inputs).** No fragments at all (a freshly-planned manifest, nothing written yet): merge succeeds, reports the missing units by name, and writes the scaffold bundle plus an empty `journal.jsonl` — verified this validates cleanly too. A fragment with every array present but empty: a clean no-op, `+0` everywhere. A manifest whose units all lack fragments: same as "no fragments," not fatal — this is a legitimate mid-run state (an agent hasn't produced its wave yet), not a degenerate one.
- **Probe 6 (real-data proof) — the strongest evidence in this task.** `tests/cli/bootstrap-merge-selfmap.test.js` splits the real self-map seed's 220 nodes and 411 edges round-robin across 5 fragment files (node split and edge split offset from each other, so most edges reference a node created by a DIFFERENT fragment — the real shape a multi-agent bootstrap run produces), merges them into an empty base (carrying over the seed's own `project.metadata.products`/`maps` so this isn't penalized with warnings that have nothing to do with merge's own correctness), and runs `arkaik validate` on the result: **220/220 nodes, 411/411 edges, 220/220 `node.created` events, 0 errors, 0 warnings.** Re-running merge a second time over the same fragments produces byte-identical bundle and journal files. This is what actually proves the `kind`→`edge_type` fix (finding 8) and the cross-run collision fix (finding 7) hold at real scale, not just on a hand-built fixture.

**Probe 7 (`loadFragments` path trust) — closed as flagged.** `unit.fragment` is no longer read at all; `loadFragments` re-derives the path as `${FRAGMENTS_DIR}/${unit.id}.json`, re-validating `unit.id` against the same lowercase-kebab-case shape `plan` enforces (manifest.json is edited between `plan` and `merge` — units get marked `done`/`rejected` between waves — and nothing stops that edit from also rewriting `fragment` to point elsewhere). Verified two ways: a manifest with `fragment` pointed at a decoy file (with different, detectable content) still resolves and reads the REAL id-derived fragment, ignoring the tampered field entirely; a manifest with an unsafe `id` (a `../` traversal attempt) fails the merge loudly, naming the unsafe id, rather than silently resolving somewhere unexpected.

**One more finding, made while implementing the fix above, not from reading:** `runMerge`'s reference code read `baseJournal` via a direct sidecar-only read (`readJournalEvents(journalPath)`), which would silently DISCARD an entire embedded `journal[]` array if the base bundle happened to carry one (the interchange projection shape, docs/spec/journal.md — e.g. a bundle dropped in from `arkaik pack` or a hosted export). The repo's own canonical bundle is sidecar-only by convention, so this is a narrow edge case in the ordinary path, but it's exactly the kind of silent, unrecoverable data loss this whole review process exists to catch, and the fix is one line: `runMerge` now calls `loadJournalEvents(base, bundlePath)` (embedded-or-sidecar, already existing in `journal-io.ts`) instead of the sidecar-only read.

**Explicitly NOT fixed here, flagged for Task 7:** two fragments declaring an edge between the SAME `(source, target)` pair with two DIFFERENT `kind`/`edge_type` values silently keep whichever fragment's edge was processed first — no error, no warning. The edge id (`e-{source}-{target}`) doesn't encode type, so this is a real modeling conflict, not a false alarm, but it is squarely a "collision" in the sense Task 7's own brief already names as its job — see Task 7's section below for the note.

**Files (as shipped):**
- Created: `packages/cli/src/lib/bootstrap/fragments.ts`
- Created: `packages/cli/src/lib/bootstrap/merge.ts`
- Created (round 3 — the journal algebra, extracted for direct testability, see item 17): `packages/cli/src/lib/bootstrap/journal-merge.ts`
- Modified: `packages/cli/src/commands/bootstrap.ts` (`runMerge`, wired into the dispatch switch; now also runs `validateBundle` before writing — item 16)
- Modified (round 3, item 21): `packages/cli/src/lib/bootstrap/fragments.ts` (documents `changed_ts`'s one-shot-per-node budget)
- Test: `tests/cli/bootstrap-merge.test.js` (determinism, all three carry-forward regressions, probes 1/2/4/5/7, the `kind`→`edge_type` fix, the cross-run collision fix, decision-status synthesis, the `to`-based order-sensitivity criterion, metadata deep-merge, edge-type disagreement, and `arkaik validate` on every bundle-producing block — 118 checks)
- Test: `tests/cli/bootstrap-merge-selfmap.test.js` (real-data proof, probe 6, kept separate for the same "meaningfully different fixture shape" reason `bootstrap-slice.test.js`/`bootstrap-e2e.test.js` were split out — 8 checks)
- Test (round 3, direct unit tests, no CLI build needed — item 17): `tests/cli/bootstrap-journal-merge.test.js` (27 checks)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/bootstrap-merge.test.js` with the determinism block below (unchanged from the original plan — this is what fails first, before `merge` is wired up at all):

```js
// (see the shipped file for the full test — reproduced here only to anchor
// the TDD step; the file itself carries ~15 more blocks added past this one)
const first = runCli(["bootstrap", "merge"], dir);
check("merge exits 0", first.status === 0, first.stderr);
// ...byte-identical bundle/journal across two runs, node.created synthesis,
// ULID shape, created_ts not persisted onto the node.
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-merge.test.js`
Expected: FAIL — `Unknown bootstrap subcommand: merge`.

- [ ] **Step 3: Write `fragments.ts`**

The fragment contract, as shipped — `FragmentNode`/`FragmentEdge`/`Fragment` (now also `FragmentUpdate`/`FragmentRetire` with an optional `changed_ts`, finding 4), and `loadFragments`, which re-derives each unit's fragment path from its `id` rather than trusting the manifest's stored `fragment` string (probe 7):

```ts
const SAFE_UNIT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function fragmentPathFor(cwd: string, unitId: string): string {
  if (typeof unitId !== "string" || !SAFE_UNIT_ID_RE.test(unitId)) {
    throw new Error(`manifest.json has an unsafe work-unit id: ${JSON.stringify(unitId)}. ...`);
  }
  return path.join(cwd, FRAGMENTS_DIR, `${unitId}.json`);
}

export function loadFragments(cwd: string, manifest: Manifest): FragmentLoad {
  const loaded: LoadedFragment[] = [];
  const problems: FragmentProblem[] = [];
  const missing: string[] = [];
  for (const unit of manifest.units) {
    let file: string;
    try {
      file = fragmentPathFor(cwd, unit.id);
    } catch (err) {
      problems.push({ unit: unit.id, message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!existsSync(file)) { missing.push(unit.id); continue; }
    // ...parse, shape-check nodes/edges/add/update/retire/events are each an
    // array of objects (arrays are `typeof === "object"` in JS too — a
    // top-level JSON array fragment is now explicitly rejected, not silently
    // treated as an all-empty valid one), push to loaded.
  }
  return { loaded, problems, missing };
}
```

(Full file: `packages/cli/src/lib/bootstrap/fragments.ts` — every design decision above has its rationale inline as a comment at its own call site; read it directly rather than a fourth retelling here.)

- [ ] **Step 4: Write `merge.ts`**

The shape, informed by every finding above — see the shipped file's own header comment for the complete, numbered rationale (it's long on purpose: this is the highest-consequence file in the whole method):

`packages/cli/src/lib/bootstrap/journal-merge.ts` (round 3, item 17 — zero imports, direct-tested):

```ts
export function isOrderSensitive(ev: AnyRecord): boolean {
  // node.status_changed (non-platform-scoped) and decision.status_changed —
  // the two types crossCheckJournal orders by "last one wins" per node.
}

export function eventKey(raw: AnyRecord, ts: string): string {
  // folds in node/deliverable/version/edge/ref/source/target/platform/from/to/title/url
  // whenever present on raw — see finding 3. Non-string values route through
  // canonicalJson (item 18), not raw JSON.stringify, so key-order never
  // changes a derived id.
}

export function canonicalJson(value: unknown): string {
  // key-order-independent JSON, so mergeJournal's divergence check compares
  // by VALUE, not by accidental property order. Skips undefined-valued
  // object keys and renders an undefined array element as null — matching
  // JSON.stringify exactly (item 15; the earlier version emitted the
  // literal token "undefined" for a missing key instead).
}

export function mergeJournal(
  base: readonly AnyRecord[],
  fresh: readonly AnyRecord[],
): { journal: AnyRecord[]; added: number; conflicts: JournalConflict[] } {
  // merges by id; base's copy wins on a collision — finding 1. `conflicts`
  // names every id where the fresh payload actually differs from what's
  // committed (compared via canonicalJson); the caller turns each one into a
  // MergeProblem rather than a silent no-op.
}
```

`packages/cli/src/lib/bootstrap/merge.ts` — imports the above, owns the mutable per-run state and the three passes:

```ts
export function mergeFragments(input: MergeInput): MergeResult {
  // orderSensitiveSeen: Map<"type:node_id:ts", {unit, from, to}>, seeded from
  //   input.baseJournal too. pushEvent(unitId, ev): the ONE path every new
  //   event reaches newEvents through. For an order-sensitive ev, refuses
  //   only on a `to` DISAGREEMENT against what's already seen (item 13 —
  //   NOT an id/from disagreement; crossCheckJournal reads only `to`),
  //   naming both transitions and both units. Also records eventUnit, so a
  //   later journal-divergence conflict can be attributed.
  // pass 1: nodes (nodeOrigin seeded from BASE nodes too — finding 7 — then
  //   every fragment's nodes/add, each mintEvent-wrapped node.created, now
  //   routed through pushEvent; platforms defaulted to [] — finding 6;
  //   update/retire now emit node.status_changed AND decision.status_changed
  //   when status/decision_status actually change — finding 4 and item 12 —
  //   also routed through pushEvent; update's metadata patch deep-merges,
  //   not replaces wholesale — item 14)
  // pass 2: edges (kind -> edge_type translation — finding 8; orphan-edge,
  //   missing-type, and now type-DISAGREEMENT errors named by unit — item 22)
  // pass 3: story events (eventKey + pushEvent, same try/catch discipline)
  // { journal, added, conflicts } = mergeJournal(input.baseJournal, newEvents)
  // conflicts.forEach(c => errors.push({ unit: eventUnit.get(c.id), ... }))
  // delete bundle.journal — the repo's own bundle is sidecar-only
}
```

(Full file: `packages/cli/src/lib/bootstrap/merge.ts`.)

- [ ] **Step 5: Wire the subcommand**

In `packages/cli/src/commands/bootstrap.ts`: import `loadFragments` (`../lib/bootstrap/fragments`), `mergeFragments` (`../lib/bootstrap/merge`), `serializeBundle`/`validateBundle` (`@arkaik/schema`), `journalPathFor`/`loadJournalEvents` (`../lib/journal-io`), and `formatFinding` (`./validate` — the same finding-formatting `arkaik validate`'s own CLI uses, reused rather than re-implemented) — **`loadJournalEvents`, not a direct sidecar-only read**, so a base bundle carrying an embedded `journal[]` (the interchange shape) isn't silently discarded (see the standalone finding above). `runMerge` resolves `bundlePath` via `path.resolve(cwd, manifest.bundle)` (matching `detectMode`'s own resolution, per Task 3's item 6), reads the base bundle via `readBundle` (applies the same legacy-status migration every other CLI read path gets), loads fragments, fails loudly on any `FragmentProblem` or `MergeProblem` before writing anything. **Before writing (round 3, item 16):** runs `validateBundle({ ...result.bundle, journal: result.journal })` — errors print via `formatFinding` and exit 1 with nothing written; warnings print but never block. Only then does it write the canonical `serializeBundle` output plus the merged `journal.jsonl` — the whole body wrapped in one `try`/`catch` so a thrown error (a malformed base bundle, an unreadable file) becomes a clean one-line message instead of a raw stack trace, matching every other subcommand in this file.

Add `case "merge": runMerge(rest); return;` to the switch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-journal-merge.test.js && node tests/cli/bootstrap-merge.test.js && node tests/cli/bootstrap-merge-selfmap.test.js`
Expected: PASS on all 27 checks in `bootstrap-journal-merge.test.js`, all 118 in `bootstrap-merge.test.js`, and all 8 in `bootstrap-merge-selfmap.test.js`, including the real self-map round trip through `arkaik validate` with 0 errors and 0 warnings (now printed by `merge` itself — "Validated clean — written." — not just by a separate `arkaik validate` call).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/bootstrap/fragments.ts packages/cli/src/lib/bootstrap/merge.ts packages/cli/src/lib/bootstrap/journal-merge.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-merge.test.js tests/cli/bootstrap-merge-selfmap.test.js tests/cli/bootstrap-journal-merge.test.js
git commit -m "feat(cli): bootstrap merge — deterministic fragment assembly"
```

---

### Task 7: Merge semantics — collisions, orphan edges, reconcile

**Read Task 6's section before starting — it went through THREE review rounds, and several things carry forward directly:**

1. **RESOLVED, but read why: the reconcile fixture below (`update`/`retire`) must assert `arkaik validate` passes, not just check snapshot fields — this is no longer a suggestion, it's the file's own standing rule.** Task 6's own first pass found and fixed a real bug where `update`/`retire` mutated `status` with no `node.status_changed` event. A SECOND review round then found that Task 6's OWN fix for a different item (the wave-3 event key) combined with this one to reintroduce the exact same class of bug — and it slipped past Task 6's own extensive probing because ONE fixture stopped one line short of calling `arkaik validate`. A THIRD round found the exact same gap again, symmetrically, for decisions (`decision.status_changed` was never synthesized at all — see item 5 below). All of it is now fixed at the source AND enforced structurally: `tests/cli/bootstrap-merge.test.js`'s header comment states that every block producing a bundle must validate it, every block was audited to comply, and — as of round 3 — `merge` itself now validates before writing (item 6 below), so a bundle that fails its own journal cross-check never even reaches disk. **The reconcile test below (and any new fixture this task adds) should follow the file's own rule** — seed the existing `journal.jsonl` with real prior status history first (a node with NO prior status-changed history won't exercise the mismatch check at all), give any multiple status changes to the SAME node DISTINCT timestamps (same-`ts` multi-transition to a DIFFERENT outcome is a hard refusal — see item 4 below), and always call `arkaik validate` on the result (in addition to, not instead of, `merge`'s own internal gate — `arkaik validate`'s CLI report is more detailed than what `merge` prints). `tests/cli/bootstrap-merge.test.js` has fixtures doing exactly this if a reference is useful — search for "status-changing update" or "decision_status-changing update".
2. **The id-collision test below is already covered, but only for the within-one-run case.** Task 6 found the reference's collision detection was silently inert across separate merge invocations (a node persisted by run 1, then collided with by a different fragment in run 2, produced zero error) and fixed it by seeding `nodeOrigin` from base nodes too. `tests/cli/bootstrap-merge.test.js` already has a minimal cross-run regression (search "already-persisted node id"); this task can still add a more exhaustive matrix (three-way collisions, collision on a `retire`d node's id, etc.) if useful, but the basic cross-run case doesn't need re-discovering.
3. **RESOLVED in round 3, no longer open: two fragments declaring an edge between the SAME `(source, target)` pair with two DIFFERENT `kind` values now fails the merge loudly, naming both types and both units — mirroring the node-title-collision treatment.** Originally flagged here as unresolved; closed instead of waiting for this task, since it's the identical shape as the node-id-collision check already in the file. Agreement (same type from both fragments) stays a silent, correct no-op. A regression test for both directions already exists (search "disagreeing on an edge's type").
4. **`merge` refuses two order-sensitive events (`node.status_changed` when non-platform-scoped, or `decision.status_changed`) for the SAME node at the IDENTICAL `ts` — but ONLY when they disagree on `to`.** (Refined in round 3: the original round-2 criterion refused on `id` inequality, which produced real false positives — a brownfield node's REAL journal history re-derived by a wave-3 fragment mints a different id than the original ULID but the same `to`, and that pair is fine. `crossCheckJournal` reads only `to`.) If a fixture needs a node to cross two GENUINELY DIFFERENT statuses within one merge run, give each transition its own `changed_ts` (`update`/`retire`) or its own `ts` (wave-3 `events`) — even a few hours apart on the same calendar day is enough. Also: a fresh event sharing an id with an already-committed one but carrying DIFFERENT content (e.g. a corrected `summary`) is refused too, not silently discarded — if a fixture wants to test "correcting a mistake," expect and assert on that refusal rather than a silent `+0 events`.
5. **New from round 3: `update` now also synthesizes `decision.status_changed` when a patch touches `metadata.decision_status` and it actually moved, and `update`'s `metadata` patch deep-merges rather than replacing wholesale.** If this task writes a reconcile fixture touching a `decision` node's `metadata.decision_status`, expect (and can assert on) the corresponding journal event; if a fixture patches ONE metadata field, expect every other pre-existing metadata field to survive untouched (it used to be silently wiped).
6. **New from round 3: `merge` now validates before writing, not just after.** `runMerge` calls `validateBundle` over the merged bundle+journal; an ERROR blocks the write and exits 1 (printed via the same `formatFinding` `arkaik validate`'s own CLI uses), a WARNING is reported but never blocks. Any fixture in this task expecting a merge FAILURE from a semantically-broken result (not just a `MergeProblem` from `merge.ts`'s own checks) can now rely on this gate too — it's a second, independent backstop, not a replacement for calling `arkaik validate` explicitly in a test (see item 1).

Also note: the `kind: "composes"` / `kind: "calls"` field name in every edge fixture below is correct and unchanged — Task 6 found and fixed the translation from `kind` to the bundle's `edge_type` field, which the reference `merge.ts` never did. No fixture changes needed here.

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

### Task 8: `plan --issues` — shipped, findings below

**The reference code above this line was never executed and had two real defects, both closed before merge:**

1. **No de-duplication guard, and re-running `plan --issues` is the routine case, not the exception.** `renderIssues` filtering on `status === "pending"` alone means every re-plan — after recon, after any profile edit, or just because someone reran the command — re-files a fresh issue for every unit still in flight, since nothing tracks "already filed." **Fixed:** `WorkUnit` gained an optional `issueUrl?: string`, set the moment `gh issue create` succeeds for that unit. `renderIssues` now filters on `status === "pending" && !u.issueUrl`. `planUnits` carries `issueUrl` forward under the exact same `sameSlice` condition that already carries `status` forward — a slice change resets `status` to `pending` AND clears the stale `issueUrl`, so a genuinely-changed unit gets a fresh issue rather than being silently skipped forever. This is local bookkeeping only — nothing here queries `gh` to check whether the filed issue is still open, was closed, or was deleted; that reconciliation is out of scope (see "Explicitly not built" below).
2. **`gh issue create` failure handling exits 1 mid-loop, and without fix 1 above, a re-run would only make things worse (refiling everything, including what already succeeded).** With the `issueUrl` guard in place, the remaining question was just: does a re-run resume correctly? **Fixed alongside fix 1:** `manifest.json` is written back (via `writeManifest`) after **every** successful `gh issue create`, not batched until the end — so a failure on unit N leaves units `1..N-1`'s `issueUrl`s durably recorded, and a re-run (after fixing whatever `gh` problem caused the failure) skips them and resumes at N. Verified end-to-end with a fake `gh` script that fails deterministically for one named unit and succeeds for the rest: first run stops with exit 1, the units filed before the failure are already in `manifest.json`; a second run (with `gh` "fixed") re-files only what's left, and the originally-filed unit keeps its original `issueUrl`, untouched by the retry. A third finding surfaced while building this test: the reference's failure branch called `res.stderr.trim()` unconditionally, but `spawnSync` leaves `stderr` `undefined` (not `""`) when the command itself can't be found (`res.error` set, e.g. `gh` not installed) rather than merely exiting non-zero — that path would have crashed with the CLI's own `TypeError` instead of reporting the real problem. Fixed the same way `corpus.ts`'s `fetchPrsViaGh` already does: check `res.error` before `res.status`.

**One judgment call, not a defect: `--print` without `--issues` is now a usage error.** The reference silently ignored a bare `--print` (it only means something inside the `if (issues)` branch). Given this repo's convention of failing loudly on a confusing flag combination rather than silently doing nothing (see `profile-validate.ts`'s whole approach), `runPlan` now rejects `--print` without `--issues` before the repo-root check, alongside the other usage errors.

**Explicitly not built, flagged as a recommendation instead:** live reconciliation against GitHub's actual issue state (checking whether a tracked `issueUrl` is still open, auto-closing an issue once its unit reaches `done`, or label management). The `issueUrl` field is enough to stop the routine case (re-filing on every re-plan) from being the default outcome; anything beyond that is real scope, not a one-line addition, and wasn't needed to make `--issues` safe to use.

**Files:**
- Modify: `packages/cli/src/lib/bootstrap/manifest.ts` — `WorkUnit.issueUrl`, its carry-forward in `planUnits`, `RenderedIssue`/`renderIssues`
- Modify: `packages/cli/src/commands/bootstrap.ts` — `--issues`/`--print` flags, `runPlanIssues`
- Test: `tests/cli/bootstrap-plan.test.js`

- [x] **Step 1: Write the failing test**

The base acceptance test (one issue per pending unit, `--print` renders JSON, the body names the slice command and fragment path) is exactly what the reference proposed — see the `arkaik-bootstrap-issues-` fixture in `tests/cli/bootstrap-plan.test.js`. It runs in its own repo, isolated from the shared `dir` used by the rest of the file, because this task's tests hand-edit `manifest.json`'s `issueUrl` bookkeeping and run under deliberately broken/fake `gh` environments.

Additional tests, one per finding above:
- `--print` genuinely never shells out to `gh`, proven (not assumed) by overriding `PATH` to a directory with no `gh` in it and confirming a clean exit 0.
- `--print` without `--issues` exits 1 and names both flags.
- A unit hand-given an `issueUrl` is excluded from the next `renderIssues` output, while every other pending unit still appears; re-planning preserves that `issueUrl`.
- Changing that unit's slice (an area's `paths`) resets it to `pending` **and** clears the stale `issueUrl`.
- A fake `gh` binary (a tiny `#!/bin/sh` script, keyed off the `--title` argument, no shared state needed) that fails for one specific unit and succeeds for the rest: the first run exits 1, names the failing unit and gh's own stderr, and the manifest shows exactly the units filed before the failure carrying an `issueUrl` (the rest do not). A second run with a fixed `gh` script exits 0, does not re-file the already-issued unit, and files everything else; the original unit's `issueUrl` is unchanged. A third run (everything issued) exits 0 and files nothing.
- `PATH` pointing at a directory with no `gh` binary at all, during an actual (non-`--print`) `--issues` run: exits 1 cleanly, no raw `TypeError` from the `res.stderr.trim()` bug.

- [x] **Step 2: Run it to verify it fails**

Confirmed by temporarily reverting the implementation (`git stash` on the two source files) and re-running: the base test fails at "plan --issues --print exits 0" with "Unknown option: --issues" (the reference's expected failure mode), and the script then throws on `JSON.parse(issues.stdout)` since the CLI never printed JSON — a clean failure, not a false pass.

- [x] **Step 3/4: Implement**

`renderIssues` (manifest.ts) is what the reference proposed, plus the `!u.issueUrl` filter from finding 1. `planUnits` carries `issueUrl` forward next to `status`, under the same `sameSlice` gate. `runPlan` (bootstrap.ts) gained the `--issues`/`--print` flags and the `--print`-requires-`--issues` check; the filing loop lives in its own `runPlanIssues`, which checks `res.error` before `res.status`, writes the manifest after every successful filing (not once at the end), and reports how many of the run's own issues were filed before a failure.

- [x] **Step 5: Run the test to verify it passes**

`node tests/cli/bootstrap-plan.test.js` — 117 checks, all passing (up from 84; the file's total check count in the header above reflects this).

- [x] **Step 6: Commit**

```bash
git add packages/cli/src/lib/bootstrap/manifest.ts packages/cli/src/commands/bootstrap.ts tests/cli/bootstrap-plan.test.js
git commit -m "feat(cli): bootstrap plan --issues, the alternate driver"
```

---

### Task 9: Golden end-to-end + CI wiring + PR 1 — shipped, findings below

**The e2e run found one real defect in the composed pipeline, not just in the fixture: `runMerge` crashed with a raw ENOENT on the truest greenfield case.** The design spec's own mode table (§ "Greenfield | no bundle, or a stub") says a repo with NO bundle at all is a valid starting state, and `runMerge`'s reference code already branches on that (`existsSync(bundlePath) ? readBundle(...) : { ...a fresh stub }`) — but the write path underneath never created `docs/arkaik/`'s parent directory before `writeFileSync(bundlePath, ...)`. Every existing merge test (`bootstrap-merge.test.js`, `bootstrap-merge-selfmap.test.js`) manually `mkdirSync`s `docs/arkaik/` in its own setup before invoking merge, so this gap had zero coverage until this task's fixture — deliberately built with no pre-existing `docs/arkaik/` directory, exactly the way a real first-ever bootstrap run starts — hit it immediately. **Fixed** in `packages/cli/src/commands/bootstrap.ts`'s `runMerge`: `mkdirSync(path.dirname(bundlePath), { recursive: true })` before the writes. While in there, also closed the write-half of the non-atomic-write note two paragraphs below: both `bundle.json` and `journal.jsonl` now go through a new `writeFileAtomic` helper (same-directory temp file + `renameSync`), so a process killed mid-write can no longer leave either file truncated. This does **not** make the bundle/journal *pair* atomic (a kill between the two renames still leaves them out of sync) — that half of the gap is unchanged, see the next paragraph.

**The plan's draft test was stale in several places — corrected, not transcribed:** (1) it never created a `.git` directory, and both `corpus` and `plan` refuse to run outside a repo root; (2) its era (`{ slug: "first-light", title: "First light" }`) carried neither `from` nor `to`, which `assertEraWindow` now rejects outright — fixed by adding both; (3) its flow's `metadata.playlist` was a bare array of id strings (`["V-home"]`); the real shape is `{ entries: [{ type: "view", view_id: "..." }] }` (`FlowPlaylistSchema`) — fixed; (4) its api-endpoint node was `A-get-notes`, but `SPECIES_PREFIXES` requires `API-`, so `arkaik validate`'s `species-prefix` check would have failed — fixed to `API-get-notes` (and the edge id assertion updated to match: `e-V-home-API-get-notes`); (5) it never created `docs/arkaik/` before merge, which is exactly the defect above, so fixing the code (not papering over it in the fixture) was the right call, not the wrong one. The shipped test also goes further than the draft: it exercises `bootstrap slice` on a real unit (asserting the returned PR/surface subset is exactly what that unit's `paths` should match) and asserts on both plan manifests' unit counts (1 after recon-only, 10 after the profile expands waves 1-3), neither of which the draft covered — the task brief's pipeline (`corpus → plan → profile.json → plan → slice → fragments → merge → validate`) names `slice` as a real step, not a skippable one.

**Note from Task 6:** `tests/cli/bootstrap-merge-selfmap.test.js` (Task 6's real-data proof, splitting the actual self-map seed into fragments and merging into an empty base) and `tests/cli/bootstrap-journal-merge.test.js` (round 3's direct-require test for the extracted journal algebra) are both new files, already listed in the `test:bootstrap` line below — confirm both are still there if this task is re-planned. They exist for the same "meaningfully different fixture shape"/"direct-testable pure module" reasons `bootstrap-slice.test.js`, this task's own `bootstrap-e2e.test.js`, and Task 4's `bootstrap-era-window.test.js`/`bootstrap-body-budget.test.js` are separate files. Also worth knowing before writing the e2e fixture below: every edge in it should use `kind` (e.g. `kind: "composes"`) — Task 6 confirmed `merge.ts` translates that to the bundle's own `edge_type` field; it found and fixed a bug where this translation was missing entirely, which would have broken this exact fixture's `arkaik validate` call.

**Also from Task 6, round 3 — real but explicitly out of scope for Task 6, worth a look here:** `runMerge` writes `bundle.json` and `journal.jsonl` as two separate `writeFileSync` calls. A process killed between the two leaves the bundle and journal out of sync — a real risk for a long-running, multi-wave bootstrap, not a hypothetical one. Neither fixed nor tested by Task 6; if this task's own CI/golden-path hardening has room for it, a temp-file-plus-rename pattern for both writes (or a single combined write) closes it. Not blocking either way — just don't let it get silently forgotten now that it's written down twice.

**Files:**
- Create: `tests/cli/bootstrap-e2e.test.js`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Write the end-to-end test**

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

- [x] **Step 2: Run it**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-e2e.test.js`
Shipped result: PASS on all **eighteen** checks (the shipped test has more assertions than the draft's eight — see the staleness note above). If `validate` fails, read its findings — the fixture must satisfy playlist↔`composes` coherence, which is why `F-notes` carries `metadata.playlist`.

- [x] **Step 3: Wire the test script**

In `package.json`, add after the `test:cli` entry:

```json
    "test:bootstrap": "node tests/cli/bootstrap-era-window.test.js && node tests/cli/bootstrap-body-budget.test.js && node tests/cli/bootstrap-event-id.test.js && node tests/cli/bootstrap-journal-merge.test.js && npm run build -w arkaik && node tests/cli/bootstrap-corpus.test.js && node tests/cli/bootstrap-plan.test.js && node tests/cli/bootstrap-slice.test.js && node tests/cli/bootstrap-merge.test.js && node tests/cli/bootstrap-merge-selfmap.test.js && node tests/cli/bootstrap-e2e.test.js",
```

(`bootstrap-era-window.test.js`, `bootstrap-body-budget.test.js`, `bootstrap-event-id.test.js`, and — added in round 3 — `bootstrap-journal-merge.test.js` all load their `.ts` source directly, so none of the four need the CLI built first; listed before the `npm run build` step for that reason, though order doesn't otherwise matter.)

(Task 4 added `tests/cli/bootstrap-slice.test.js` as its own file rather than extending `bootstrap-plan.test.js` — see Task 4's own notes for why. Task 5 added `tests/cli/bootstrap-event-id.test.js` the same way, for the same reason: a direct-require test needs no fixture round trip at all. Make sure both are in this list.)

**Post-shipment fix (PR review on #342): "direct-require the `.ts` source" only worked on a dev machine.** All four direct-require suites above originally did `require(path.join(..., "some-module.ts"))` straight, reasoning that "Node's native TypeScript support strips types at load time" — true on a recent Node (>= 22.6, and the 26.x these tasks were built and tested on), but `.github/workflows/ci.yml` pins `node-version: 20`, which has no native TS stripping at all. Every one of these suites was green locally and red in CI with `SyntaxError: Unexpected token ':'` on the first type annotation the plain `.ts` file hit — the local pass proved nothing. **Fixed** by extracting the load-schema.js technique (`tests/schema/load-schema.js`: transpile every module to CommonJS with the `typescript` compiler, already a devDependency, into a build dir *inside* the package so bare-specifier `require()`s resolve against the workspace's `node_modules`) into a bootstrap-lib-specific twin, `tests/cli/load-bootstrap-lib.js`, building into `packages/cli/.test-build-bootstrap/` (a name distinct from `packages/cli/.test-build/`, which pack-open/push/sync.test.js already use for unrelated esbuild-bundled ESM mocks — reusing that dir would mean this loader's rebuild-on-every-call could clobber those suites' output). All four suites now call `loadBootstrapModule("era-window")` etc. instead of requiring the `.ts` path directly. Verified against a real Node 20.20.2 binary (no version manager was available in the fix environment, so the binary was downloaded directly from nodejs.org and invoked by absolute path), not just Node 26: `npm run test:bootstrap` — 482/482 checks, exit 0.

**If a later task (10+) adds another direct-require unit test against a `packages/cli/src/lib/bootstrap/*.ts` module, use `tests/cli/load-bootstrap-lib.js`'s `loadBootstrapModule(name)` — do not reintroduce a raw `require(".../foo.ts")`.** It silently passes on a dev machine and fails only in CI, which is exactly the bug this note exists to prevent repeating. (Direct-require tests against a *different* directory, e.g. Task 10's `lib/services/graph/restore.ts`, are a separate tree with their own loader convention — check `tests/services/*.test.js` for that one; it is not automatically the same problem, but the same "does this actually run under CI's pinned Node 20, verified rather than assumed" question applies there too.)

- [x] **Step 4: Wire CI**

In `.github/workflows/ci.yml`, add a step immediately after the `test:cli` step, matching the surrounding style:

```yaml
      - name: Bootstrap method tests
        run: npm run test:bootstrap
```

- [x] **Step 5: Verify the whole gate**

Run: `npm run test:bootstrap && npm run lint && npm run validate:seeds`
Shipped result: all three exit 0 (plus `npm run test:cli` and `npx tsc --noEmit`, both also clean — a wider check than this step originally asked for). `test:bootstrap`: 482 checks, 0 failures (464 pre-existing + 18 new in `bootstrap-e2e.test.js`). `lint`: 0 errors, 4 pre-existing warnings, none in a file this branch touched.

- [x] **Step 6: Commit locally**

Committed locally on `feature/bootstrap-method`. Pushing the branch and opening PR 1 is explicitly **out of scope for this task** — left to the operator's own judgment on timing. The draft PR body (including the Lab Note below, refined from this section's original) lives at `docs/superpowers/pr1-body.md`, ready to paste when the PR is opened.

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

### Task 10: The pure decision rules — shipped, findings below

Every rule that decides *whether* a restore may proceed lives in pure functions, because this machine has no Postgres and untested SQL-adjacent logic is where the risk actually sits. **The draft reference code below (kept verbatim as the historical record) shipped with real changes on all five probes the task brief specified, plus two defects found in the plan's own draft — not in a first implementation attempt, in the plan text itself.**

**Probe 1 — `versionMatches` fails closed: the draft was correct on the cases it covered, incomplete on the ones it didn't.** The shipped function keeps the draft's missing/empty/whitespace/wildcard/quoted-value handling, unchanged, and adds three cases the draft never considered: a **weak ETag** (`W/"v7"`) is refused outright — RFC 7232 requires *strong* comparison for `If-Match`, and a weak validator is excluded from that by definition even when the underlying value matches; a **multi-value list** (`"a", "b"`, valid HTTP grammar for `If-Match` in general) is refused rather than parsed — this endpoint's only client always states the ONE version it read, so a caller offering several candidates is hedging across guesses, the opposite of that, and a stored version (lowercase hex, no comma) can never collide with this refusal; **case differences** are refused via byte-exact comparison, never case-folded. All three, plus the draft's original six, are asserted directly in `tests/services/graph-restore.test.js`.

**Probe 2 — `computeBundleDelta` counts by id: the draft silently dropped anything it couldn't identify, which is worse than counting it wrong.** A node/edge/event with no `id`, a non-string `id`, or an `id` reused within the same array was, in the draft's `byId`, simply invisible — contributing to neither "added" nor "removed" nor any other count. Verified concretely: a bundle padded with id-less garbage nodes would have shown `nodesAdded: 0` for all of them, reading as an empty, harmless restore on a `--dry-run` screen. **Fixed** by giving every one of `BundleDelta`'s three entity categories a `Malformed` counter (`nodesMalformed`, `edgesMalformed`, `eventsMalformed`) — a node/edge/event that cannot be matched by id now shows up as a nonzero number instead of nothing. `nodes`/`edges`/`journal` absent, `null`, or non-array still degrade to "treat as empty" (a legitimate default, not a hostile shape) with no exception thrown, on either side, in any combination — verified directly, including `computeBundleDelta(null, undefined)`.

**Probe 3 — `nodesChanged`'s `JSON.stringify` equality: confirmed exactly the failure the probe predicted, and it would have made the number meaningless in production.** Postgres jsonb does **not** preserve object key order — it reorders pairs by key length, then lexicographically (Postgres docs, "JSON Types": jsonb "does not preserve … the order of object keys"; confirmed by web search, not assumed). A node round-tripped through storage and the "same" node freshly assembled by the CLI can hold byte-identical field values in different key orders, and the draft's `JSON.stringify(before) !== JSON.stringify(node)` would call that "changed" — meaning `nodesChanged` would read as "all of them" on every single restore that touches a previously-stored node, which is every restore after the first. **Fixed** by replacing the stringify comparison with `deepEqualIgnoringKeyOrder`: object keys are compared as sets (order-independent, recursive), array elements are compared by **index** (order-sensitive, unchanged) — a flow's `metadata.playlist` reorder is real signal and must still count as changed, only object key order is noise. Verified with three fixtures: flat key-order difference (no change reported), nested key-order difference inside `metadata.playlist.entries[i]` (no change reported), and an actual array-element reorder of the same playlist (changed, correctly, `nodesChanged === 1`).

**Probe 4 — `eventsDropped`'s id-based counting: sufficient for "dropped," but the draft exposed nothing for the adjacent case that matters just as much.** Counting by id presence IS sufficient to answer "is this event gone" — an id missing is missing, full stop, regardless of what else in the bundle changed. But the draft's `BundleDelta` had no field at all for "this id is present on both sides but its payload differs" — and `merge` can legitimately rewrite an event's payload while keeping its id (e.g. reconcile canonicalizing a timestamp). With only `eventsAdded`/`eventsDropped` exposed, that rewrite contributes **zero** to both — it vanishes completely from the one number a human is supposed to read before authorizing a destructive write. **Fixed** by adding `eventsChanged` (and, for the same reason and at no extra cost, `edgesChanged`, paralleling the `nodesChanged` the draft already had) using the same key-order-insensitive comparison from probe 3. Verified: an event with the same `id` and a changed `to` field now reports `eventsAdded: 0, eventsDropped: 0, eventsChanged: 1` — visible, not silent.

**Probe 5 — owner-only and tier-limited: one is genuinely SQL-coupled, one splits in two, and the split half is now built and tested here.** Owner-only stays entirely out of this module — "does this caller own this stored project row" cannot be answered without reading the row, so it belongs in `replaceProjectBundle` (Task 11), scoped by `owner_id = any($1)` exactly like every other store function. Tier-limited splits: the limits-table lookup (`getHostedLimitsForTier`) was already pure before this task, in `lib/services/limits.ts`. The remaining half — does this bundle's entity count fit the tier's cap — needs only array lengths and that already-pure lookup, no database row, so it is drawn on this side of the line: **`checkHostedEntityLimit(bundle, tier)`** ships here, tested directly (a 6000-entity bundle against the synk tier's 5000 cap, `klub`'s uncapped tier, an unrecognized tier falling back to the safest floor), and Task 11's note below asks that task to call it instead of re-deriving the same `count > limits.entities` comparison a third time.

**A defect in the plan itself, not in a first implementation attempt: the draft test's `require("../../lib/services/graph/restore.ts")` is the exact anti-pattern Task 9's own postscript warns against.** A bare `require()` of a `.ts` path only works because Node's native TypeScript stripping (>= 22.6) is present on this dev machine (Node 26) — CI pins Node 20, which has none, and would have failed with `SyntaxError: Unexpected token ':'` on the first type annotation, exactly as it did for the four suites Task 9 had to fix after the fact. Task 9's own note anticipated this exact task by name: *"Direct-require tests against a different directory, e.g. Task 10's `lib/services/graph/restore.ts`, are a separate tree with their own loader convention — check `tests/services/*.test.js` for that one."* **Fixed** before it ever shipped broken: `tests/services/load-graph-restore.js`, mirroring `tests/services/load-pr-plan.js`'s approach exactly — transpiles `restore.ts` (and the real `limits.ts`, needed for `checkHostedEntityLimit`) to CommonJS via the `typescript` compiler into `tests/services/.test-build-graph-restore/`, stubs `server-only`, and — matching `load-pr-plan.js`'s "forbidden stub" pattern — makes `@/lib/services/db` and `@/lib/services/graph/store` throw loudly if reached at all, so a future change that makes `restore.ts` less pure fails here immediately instead of silently requiring a live Postgres to notice. **Verified against a real Node 20.20.2 binary** (downloaded directly, same as Task 9's fix, no version manager on this machine): `node tests/services/graph-restore.test.js` — 47/47 checks, exit 0, identical output to Node 26.

**A second defect in the plan itself: Step 5's own CI wiring instruction contradicts the design principle stated three sections earlier.** The draft said to add the `test:graph-restore` step "after the `test:graph` step" in `.github/workflows/ci.yml` — but `test:graph` lives in the Postgres-backed `services` job, and spec §10 states plainly: *"this machine has no local Postgres, so the `If-Match` comparison, delta computation and validation wiring are extracted as pure functions with real tests in CI's fast build job."* Placing a DB-free suite in the slow, Postgres-gated job doesn't break anything, but it defeats the entire point of extracting these rules as pure functions — the fast job is what makes them catch a laptop-detectable regression before a push, and `test:pr-plan`/`test:github-app` (this repo's own prior examples of the same pattern) are both deliberately in `build`, each with a comment saying so explicitly. **Fixed** by adding the step to the `build` job instead, immediately after `test:github-app`, with the same kind of explanatory comment.

**Coordinator review, round 1 — independently confirmed probe 3 against Postgres' own docs and source, confirmed all three `If-Match` refusals against RFC 9110, and found five more real defects, all of the same shape: a comment claiming more than the code delivered.** Verdict was "strong work, merge after fixes." All five fixed below, plus the minors.

1. **Important — unbounded recursion, contradicting the module's own stated contract.** `deepEqualIgnoringKeyOrder` had no depth cap and threw a `RangeError` at roughly 5,000 nested objects — reachable, not hypothetical: `metadata` is `z.record(z.string(), z.unknown())` in `@arkaik/schema`, which zod does not recurse into at all, so arbitrarily deep nesting survives `validateInboundBundle` and reaches the comparator, turning the one destructive-verb endpoint's request into an unhandled 500. `indexById`'s comment claimed tolerance of "every shape a hostile or merely buggy bundle can offer," and the suite asserted "a fully hostile shape on both sides never throws" — depth broke both claims, since every existing malformed-shape fixture was shallow. **Fixed:** a `MAX_COMPARE_DEPTH` of 64 (bundle metadata nests ~4 levels deep in practice; 64 is a wide margin, not a realistic ceiling) — past the cap, two values are reported UNEQUAL rather than compared further, the conservative default. Cycle detection was deliberately NOT added: both sides always arrive via `JSON.parse`, which cannot produce a cyclic structure, so there is nothing for a cycle guard to catch — documented inline rather than guarded against. Verified with two SEPARATE (not reference-identical — see the test's own comment on why that distinction matters, a first attempt at this test passed for the wrong reason via the `a === b` fast path) 10,000-level-deep structures: no throw, and `nodesChanged === 1` past the cap.
2. **Important — the "lowercase hex" version justification was factually wrong, twice.** The comment asserted stored versions are `randomBytes(...).toString("hex")`. They are not: the column is `version bigint not null default 1` (`db/migrations/008_graph_projects.sql:44`), surfaced as `String(row.version)` and bumped via `(BigInt(version) + BigInt(1)).toString()` — versions are plain decimal integer strings (`"1"`, `"2"`, `"103"`). `randomBytes` mints PROJECT IDS (`generateProjectId`), not versions, and uses `base64url` (mixed-case), not hex. Every conclusion drawn from the false premise happened to survive (decimal digits have no case and no comma either), but the comment would have misled anyone generalizing from it — and `base64url` IS mixed-case, so the false premise was actively dangerous to reason from, not just imprecise. **Fixed:** the comment now cites the migration line and `store.ts`'s own read/write path; every test fixture changed from `"v7"`/`"V7"` (a shape this server never produces) to realistic decimal versions (`"7"`, `"103"`) — including a new "no numeric coercion" case (`"07"` vs `"7"` → `stale`, not `match`) that a hex-shaped fixture would never have surfaced and that is exactly the kind of case that would have caught the wrong premise while writing it.
3. **Important — `checkHostedEntityLimit` returned `Infinity` on the SUCCESS path.** `limits.ts` states its own invariant explicitly: "Infinity never reaches a JSON response body — the only place a limit is serialized is the 403 rejection, which klub can never trigger." That held for `createProject`/`applyMutation` because they only put `limit` in FAILURE payloads; `checkHostedEntityLimit` returns it unconditionally, including on `ok: true` — exactly what `--dry-run` prints. **Fixed:** `EntityLimitCheck.limit` is `number | null`; the comparison (`actual <= rawLimit`) still runs against the real, possibly-infinite limit so `ok` stays correct, and only the RETURNED value is normalized (`Infinity → null`). Verified: `checkHostedEntityLimit({...50000 entities}, "klub").limit === null`, checked directly against the raw return value, not after an incidental `JSON.stringify` round-trip (which would mask the bug either way, since `JSON.stringify(Infinity)` already silently produces `null` — the point is the TYPE should say so, not rely on a serialization step to sanitize it after the fact).
4. **Coordinator's decision — a classifier, not just a stricter boolean, plus 412 for the genuine conflict.** `versionMatches`'s boolean returned bare `false` for three different client errors: no precondition sent, an unsupported shape (wildcard/weak-ETag/multi-value), and a genuinely stale version — and only the third is actually a conflict where "re-pull and retry" is the right advice. A caller tripping the weak-ETag or multi-value refusal would have been told its version was stale when it wasn't. **Added `classifyIfMatch(ifMatch, current): "match" | "absent" | "unsupported" | "stale"`**, alongside `versionMatches` (kept as a thin wrapper, `classifyIfMatch(...) === "match"` — still a fine predicate for a caller that only needs the boolean). Task 11's note below maps `absent` → 428, `unsupported` → 400, `stale` → 412. **All three refusals were kept** — independently confirmed against RFC 9110 §13.1.1 (If-Match requires strong comparison) and §8.8.3.2 (a weak validator is excluded from strong comparison by definition) for the weak-ETag case; `*` refusal is a defensible deliberate deviation from RFC 9110 §13.1.2's default ("any representation is fine") for a destructive verb specifically; multi-value refusal is safe because a real version can never contain a comma. **On the status code:** the spec says 412, RFC 9110 says 412 for a failed precondition, and restore uses 412 — the existing `mutations` route's `409 version_conflict` is a pre-existing inconsistency, NOT changed here (out of scope for this task), but flagged in Task 11's note below as a deliberate decision rather than an accident, for a possible follow-up.
5. **Make `nodesMalformed`/`edgesMalformed`/`eventsMalformed` incoming-only.** The shipped-then-reviewed version summed both sides (`prevNodes.malformed + nextNodes.malformed`), so 3 malformed already-stored entries plus 2 malformed incoming ones read as `5` — and every other counter in `BundleDelta` is directional, so the summed version was the odd one out AND hid the one question that actually matters before a destructive write: is the garbage in what's about to be destroyed, or in what's about to be written? Only the second one should ever change a caller's decision. **Fixed:** dropped stored-side counting entirely — the server wrote that data and it already passed `validateBundle` — so the field now unambiguously means "in the bundle you are about to apply." Verified with a dedicated pair of fixtures: malformed-only-in-`prev` now reports `nodesMalformed: 0` (previously would have reported `1`); malformed-only-in-`next` still correctly reports `1`.
6. **Added totals — the line that actually reassures.** Two identical bundles previously returned all-zero deltas, indistinguishable from empty-to-empty — no way to answer "how big is this restore, really" from the delta alone. **Added `nodesBefore`/`nodesAfter` (and the edge/event equivalents)** — raw array lengths, not id-filtered, since "how many nodes are in this array" is the plainest reading of "you are replacing N nodes with M," the single most reassuring line to print before a wholesale replace. Verified on an identical-bundle fixture (`nodesBefore === nodesAfter === 3`, all deltas zero) and a shrinking one (`nodesBefore: 2, nodesAfter: 1, nodesRemoved: 1`).
7. **Coordinator's decision on the CLI-import problem this task flagged in Task 12's section — resolved server-side, written into Tasks 11/12 below as a decision, not an option.** Reimplementing `computeBundleDelta` CLI-side (the only way around the `server-only`/`@/` alias problem this task originally just flagged) would risk two implementations of the exact number that gates a destructive write drifting apart — the worst possible place for that. Resolved: Task 11's `PUT .../bundle` gains a dry-run mode that computes and returns the delta WITHOUT writing, using the same code path that performs the real write; `arkaik restore --dry-run` calls that and prints the server's own number. One implementation, no drift. See both tasks' sections below.

**Minors also taken:** `indexById`'s `seen` Set (identical membership to `byId`) removed as dead weight — `byId.has(id)` doubles as the "already seen" check. `countChanged` now uses `prev.has(id)` rather than `before !== undefined`, so it no longer quietly depends on an invariant enforced 150 lines away (that `indexById` never stores `undefined`). The comparator's doc comment now says "correct only for JSON-shaped values, not a general deep-equal" rather than implying generality — two key-less non-plain objects (`new Date(0)` vs `new Date(999)`) would compare equal, unreachable via `JSON.parse` but worth stating so nobody lifts this into a shared utility without noticing. The jsonb-ordering parenthetical was corrected to what Postgres actually documents (shorter keys sort before longer ones, with a non-lexicographic byte-comparison tie-break) rather than overstating precision. Added untested cases: an empty-string `id` (malformed, not a valid empty key), `klub.limit === null`, and realistic multi-digit decimal versions.

**Files (as shipped):**
- Create: `lib/services/graph/restore.ts`
- Create: `tests/services/graph-restore.test.js` (74 checks)
- Create: `tests/services/load-graph-restore.js` (the loader — not in the plan's original file list; see the finding above for why it exists)
- Modify: `package.json` (`test:graph-restore`)
- Modify: `.github/workflows/ci.yml` (`build` job, not `services` — see the finding above)
- Modify: `.gitignore` (`/tests/services/.test-build-graph-restore/`, matching the sibling `.test-build-*` entries already there)

- [x] **Step 1: Write the failing test**

The draft test above (kept verbatim as the historical record — its baseline assertions all survive unchanged in the shipped file) `require("../../lib/services/graph/restore.ts")`ed the `.ts` source directly. **As shipped, this is `tests/services/graph-restore.test.js` requiring `./load-graph-restore` instead** — see the loader finding above. The shipped file keeps every one of the draft's original assertions and adds the probe 1/2/3/4/5 coverage described above, PLUS the coordinator's round-1 findings: `classifyIfMatch`'s four outcomes tested directly; every version fixture using realistic decimals (`"7"`, not `"v7"`) including a "no numeric coercion" case; a 10,000-level-deep-metadata case for the recursion-depth cap (built from two DISTINCT object references, not a shared one — see the test's own comment on why that distinction is what makes the test real); a dedicated malformed-in-`prev`-only-vs-malformed-in-`next`-only pair proving the directional fix; before/after totals on an identical-bundle and a shrinking-bundle fixture; and `klub.limit === null` checked directly against the raw return value. 74 checks total. Full file: `tests/services/graph-restore.test.js`.

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/services/graph-restore.test.js`
Actual: FAIL — `Error: ENOENT: no such file or directory, open '.../lib/services/graph/restore.ts'` (the loader's `transpile()` step reads the source file directly and there was none yet — a clean, legible failure, not a `require` resolution error).

- [x] **Step 3: Write `restore.ts`**

The draft above is the starting shape; every one of the five probe findings changed it, and the coordinator's round-1 review changed it again. As shipped: `versionMatches` gains the weak-ETag/multi-value/wildcard-after-unquoting checks (probe 1) and is now a thin wrapper over `classifyIfMatch` (coordinator finding 4); `BundleDelta` gains `nodesMalformed`/`edgesMalformed`/`eventsMalformed` (INCOMING-bundle-only, coordinator finding 5) and `edgesChanged`/`eventsChanged` (probes 2 and 4), plus `nodesBefore`/`nodesAfter`/`edgesBefore`/`edgesAfter`/`eventsBefore`/`eventsAfter` (coordinator finding 6); the node-comparison helper is `deepEqualIgnoringKeyOrder`, not `JSON.stringify` (probe 3), now with a `MAX_COMPARE_DEPTH` cap (coordinator finding 1); and a new `checkHostedEntityLimit` export, backed by a real `import { getHostedLimitsForTier } from "@/lib/services/limits"` (probe 5), returning `limit: number | null` rather than a raw `Infinity` (coordinator finding 3). The full, commented file (every decision has its rationale inline, at its own call site) is `lib/services/graph/restore.ts`. Shape, abbreviated:

```ts
import "server-only";
import { getHostedLimitsForTier } from "@/lib/services/limits";

export type IfMatchClassification = "match" | "absent" | "unsupported" | "stale";

export function classifyIfMatch(ifMatch: string | undefined | null, current: string): IfMatchClassification {
  if (typeof ifMatch !== "string") return "absent";
  const trimmed = ifMatch.trim();
  if (trimmed.length === 0) return "absent";
  if (trimmed === "*" || trimmed.includes(",") || /^w\//i.test(trimmed)) return "unsupported";
  const normalized = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (normalized.length === 0 || normalized === "*") return "unsupported";
  return normalized === current ? "match" : "stale";
}

export function versionMatches(ifMatch: string | undefined | null, current: string): boolean {
  return classifyIfMatch(ifMatch, current) === "match";
}

export interface BundleDelta {
  nodesBefore: number; nodesAfter: number;
  nodesAdded: number; nodesRemoved: number; nodesChanged: number; nodesMalformed: number; // malformed: INCOMING (next) only
  edgesBefore: number; edgesAfter: number;
  edgesAdded: number; edgesRemoved: number; edgesChanged: number; edgesMalformed: number;
  eventsBefore: number; eventsAfter: number;
  eventsAdded: number; eventsDropped: number; eventsChanged: number; eventsMalformed: number;
}

// indexById: byId map + malformed count (no/non-string/duplicate id) per list.
// arrayLength: raw element count, 0 for non-arrays — feeds the *Before/*After totals.
// deepEqualIgnoringKeyOrder(a, b, depth = 0): object keys compared as sets, array
//   elements by index, capped at MAX_COMPARE_DEPTH (64) — past it, reports UNEQUAL
//   rather than recursing further (a caller-supplied `metadata` can nest arbitrarily
//   deep and zod will not have rejected it). No cycle detection: unreachable, both
//   sides always arrive via JSON.parse.
// countMissing / countChanged: the id-diff and id-matched-but-unequal counts
//   (countChanged uses `prev.has(id)`, not an `!== undefined` invariant).

export function computeBundleDelta(prev: {...}, next: {...}): BundleDelta { /* six indexById calls, six arrayLength calls, eighteen fields */ }

export interface EntityLimitCheck { ok: boolean; limit: number | null; actual: number; }
export function checkHostedEntityLimit(bundle: { nodes?: unknown; edges?: unknown }, tier: string): EntityLimitCheck {
  const actual = (Array.isArray(bundle?.nodes) ? bundle.nodes.length : 0) + (Array.isArray(bundle?.edges) ? bundle.edges.length : 0);
  const rawLimit = getHostedLimitsForTier(tier).entities; // compare against the RAW (possibly Infinite) limit...
  const limit = Number.isFinite(rawLimit) ? rawLimit : null; // ...but only normalize the RETURNED value
  return { ok: actual <= rawLimit, limit, actual };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node tests/services/graph-restore.test.js`
Actual: PASS on all **74** checks (47 from the first pass, plus 27 more from the coordinator's round-1 review — `classifyIfMatch`'s four outcomes, decimal-version fixtures, the depth-cap regression, the malformed-directionality pair, before/after totals, and `klub.limit === null`). Also verified against a real Node 20.20.2 binary (CI's pinned version): identical 74/74 pass, exit 0, byte-identical output to Node 26 — see the loader finding above for why this check matters here specifically.

- [x] **Step 5: Wire the script and CI**

In `package.json`, as drafted:

```json
    "test:graph-restore": "node tests/services/graph-restore.test.js",
```

**In `.github/workflows/ci.yml`, NOT after `test:graph`** (that step is in the Postgres-backed `services` job) — as shipped, added to the `build` job immediately after `test:github-app`, matching that step's own "deliberately in build, not services" comment:

```yaml
      # Hosted restore's decision rules (If-Match matching, bundle delta,
      # tier-limit check) are pure by design — this machine has no local
      # Postgres, so they are extracted from the SQL-coupled store code and
      # tested here, in the fast job, rather than only in `services` below.
      - name: Graph restore rules (If-Match matching, bundle delta, tier limit)
        run: npm run test:graph-restore
```

Also added to `.gitignore`: `/tests/services/.test-build-graph-restore/`, alongside its sibling `.test-build-*` entries.

- [x] **Step 6: Commit**

```bash
git add lib/services/graph/restore.ts tests/services/graph-restore.test.js tests/services/load-graph-restore.js package.json .github/workflows/ci.yml .gitignore
git commit -m "feat(graph): pure rules for hosted bundle restore"
```

(`tests/services/load-graph-restore.js` added to the commit — not in the plan's original file list; see the loader finding above.)

---

### Task 11: `replaceProjectBundle` + the PUT route

**Notes carried forward from Task 10 (first pass, three notes) and its coordinator review (round 1, four more) — read all seven before touching `store.ts`:**

1. **`BundleDelta` has more fields than this section's reference code implies — eighteen, not seven.** Task 10 shipped `nodesMalformed`/`edgesMalformed`/`eventsMalformed` (INCOMING-bundle-only — see note 4 below) and `edgesChanged`/`eventsChanged` alongside the original `nodesAdded`/`nodesRemoved`/`nodesChanged`/`edgesAdded`/`edgesRemoved`/`eventsAdded`/`eventsDropped`, and its coordinator review added `nodesBefore`/`nodesAfter`/`edgesBefore`/`edgesAfter`/`eventsBefore`/`eventsAfter` (raw before/after totals — "you are replacing N nodes with M"). Nothing here needs to change to accommodate that — `result.delta` is forwarded to the client as a whole object below, not destructured field-by-field — but the PUT response body carries eighteen numbers, and the CLI's dry-run output (Task 12, and see note 6 below) should print at least the totals, not just the deltas.
2. **Use `checkHostedEntityLimit` from `@/lib/services/graph/restore` instead of re-deriving the `count > limits.entities` comparison inline.** This section's own reference code calls `entityCount(bundle.nodes, bundle.edges)` (a private helper in `store.ts`) and compares it against `getHostedLimitsForTier(input.tier).entities` directly — that is now a third copy of a comparison that already exists twice (`createProject`, `applyMutation`) and a fourth pure, tested function for exactly this (`checkHostedEntityLimit`, Task 10 probe 5). Prefer `const check = checkHostedEntityLimit(bundle, input.tier); if (!check.ok) return { ok: false, reason: "limit", limit: check.limit, actual: check.actual, tier: input.tier };` over hand-rolling the comparison a third time in this file. **Note the return type: `check.limit` is `number | null`** (coordinator review, round 1, finding 3 — `Infinity` must never reach a response body, and `checkHostedEntityLimit` now normalizes it itself), so `ReplaceResult`'s `{ reason: "limit"; limit: number; ... }` branch needs widening to `limit: number | null` to match, and the route's 413 body can serialize `null` directly (a `klub` caller can never hit this branch in the first place, since `ok` is always `true` for an uncapped tier — the type just needs to not lie about it).
3. **`tests/services/load-graph-api.js` (the loader `graph-api.test.js` uses, in the Postgres-backed `services` job) will need a new entry once `store.ts` imports from `restore.ts`.** That loader's `COMMON` rewrite table currently has no mapping for `@/lib/services/graph/restore`, so a transpiled `store.js` containing `require("@/lib/services/graph/restore")` (unrewritten) will fail at `require()` time with `Cannot find module`. Add `write("restore.js", transpile(src("lib", "services", "graph", "restore.ts"), "restore.ts", COMMON));` alongside the existing `write("store.js", ...)` line, and add `["@/lib/services/graph/restore", "./restore.js"]` to `COMMON` — the real module, transpiled, not a stub, mirroring how `limits.ts`/`owners.ts` are already treated there (both are pure and cheap enough that stubbing them would only hide bugs, not save anything real).
4. **Use `classifyIfMatch`, not `versionMatches`, to pick the status code — this is a coordinator DECISION, not a suggestion.** `versionMatches` collapses three different client errors into one boolean; the route needs to tell them apart to answer correctly. Map `classifyIfMatch(ifMatch, current.version)`: `"absent"` → **428** Precondition Required (no version stated at all — this is also what the route's OWN pre-check for a missing header should fall through to, since a present-but-blank header reaches `classifyIfMatch` too and must get the same treatment, not slip past a naive `if (!ifMatch)` guard into a `"stale"`/412 branch it doesn't deserve); `"unsupported"` → **400** Bad Request (a wildcard, weak ETag, or multi-value list — malformed FOR THIS ENDPOINT, not stale); `"stale"` → **412** Precondition Failed (the one genuine conflict — someone else changed the project since this caller read it). Do this INSIDE `replaceProjectBundle`'s transaction (after the `for update` read, comparing against the freshly-read `current.version`), not in the route, since only the store function has the current version at the right moment — the route just maps whichever of the three failure reasons comes back to its status code.
5. **Known, deliberate inconsistency — flagged, not fixed, out of scope for this task.** The existing `POST .../mutations` route replies `409 version_conflict` on a version mismatch; this route replies **412** for the equivalent case (`"stale"` from `classifyIfMatch`) — matching both the spec's own text and RFC 9110's `412 Precondition Failed` for a failed `If-Match`. Independently confirmed against RFC 9110 during coordinator review: 412 is the RFC-correct code for this exact case, and the mutations route's 409 is the pre-existing outlier, not this one. **Do not change the mutations route to "fix" this as part of Task 11** — that route's `If-Match` is optional/best-effort (see `store.ts`'s own comment: "Correctness does not depend on it"), a materially different contract from restore's mandatory, fail-closed one, and changing it is a separate decision with its own blast radius. Leave a similar note in `app/api/graph/projects/[projectId]/mutations/route.ts` (or wherever this task's own PR description lives) so the 409-vs-412 split reads as a recorded decision if anyone notices it later, not as an accident.
6. **Coordinator DECISION: `PUT .../bundle` gains a dry-run mode — Task 12's CLI calls it rather than reimplementing the delta.** Task 10 originally just flagged that the CLI cannot import `computeBundleDelta` (it lives behind the `server-only`/`@/` alias the Next.js app resolves and the CLI package does not) and left the resolution open. The coordinator's decision: reimplementing the delta CLI-side would risk two implementations of the exact number that gates a destructive write drifting apart, the worst possible place for that to happen. **This task's own scope grows by one flag:** accept a dry-run indicator (a query param, e.g. `?dryRun=1`, or a body field — this task's call on which) on the PUT route; when set, `replaceProjectBundle` runs the SAME validation/version-check/delta-computation path but returns before the `update`/journal-replace queries execute — no write, same transaction-scoped read, same `computeBundleDelta` call, same `ReplaceResult`-shaped success response (just never committed to a mutation). Task 12's `arkaik restore --dry-run` calls this instead of computing its own (coarser) local counts. One implementation, no drift — see Task 12's own note.
7. **`versionMatches` is still exported and still useful as a plain boolean** for anywhere this route (or a future one) only needs "does it match, yes or no" without caring why not. Prefer `classifyIfMatch` specifically where the response needs to differ by failure reason, as in note 4.

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

**Update the route's single `"conflict"` branch above to the three-way split from note 4:** `StoreFailure`/`ReplaceResult` should carry `classifyIfMatch`'s outcome (or the store function itself resolves it and returns one of three distinct reasons, e.g. `"precondition_required"` / `"precondition_unsupported"` / `"conflict"`), and the route maps each to 428 / 400 / 412 respectively rather than treating every non-match as the same `"conflict"` → 412. The 412 branch's body (`current: result.current`) still only applies to the genuine "stale" case — a 428/400 caller has nothing to compare against, so `current` doesn't belong in those two responses.

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

**Coordinator DECISION carried forward from Task 10's review, superseding this section's original `--dry-run` reference code: `--dry-run` calls the SERVER's dry-run mode, not a local count.** Task 10 originally just flagged the constraint (`computeBundleDelta` lives under `lib/services`, behind the `server-only`/`@/` alias the Next.js app resolves and the CLI package does not, so the CLI cannot import it without duplicating the module) and left the resolution open. The coordinator's decision: reimplementing the delta CLI-side risks two implementations of the exact number that gates a destructive write drifting apart — the worst possible place for that to happen — so it is resolved SERVER-SIDE instead. Task 11 adds a dry-run mode to `PUT .../bundle` (see that task's note 6): the same request, with a dry-run indicator, runs the identical validation/version-check/delta-computation path and returns the `ReplaceResult`-shaped response WITHOUT writing.

**What this means for this task's implementation, concretely:** `runRestore`'s `dryRun` branch should no longer compute its own `nodes.length`/`edges.length`/`journal.length` diff inline (this section's original reference code did, before this decision). Instead, send the same `PUT .../bundle` request `arkaik restore` would send for real — including `If-Match` with the version read in step 2 — but with the dry-run indicator set; print the returned `delta` (all eighteen `BundleDelta` fields are available: lead with the `*Before`/`*After` totals — "replacing N nodes with M" — before the added/removed/changed/malformed breakdown); and stop, exactly as the original reference code did, without calling the real (non-dry-run) endpoint. This also means `--dry-run` now requires a version read (step 2) and a network round-trip it didn't strictly need before — acceptable, since dry-run's whole purpose is showing what the REAL call would do, and the real call's own gate (validation, tier limit, version match) is exactly what a dry-run should preview, not approximate locally.

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
    "test:bootstrap": "node tests/cli/bootstrap-era-window.test.js && node tests/cli/bootstrap-body-budget.test.js && node tests/cli/bootstrap-event-id.test.js && node tests/cli/bootstrap-journal-merge.test.js && npm run build -w arkaik && node tests/cli/bootstrap-corpus.test.js && node tests/cli/bootstrap-plan.test.js && node tests/cli/bootstrap-slice.test.js && node tests/cli/bootstrap-merge.test.js && node tests/cli/bootstrap-merge-selfmap.test.js && node tests/cli/bootstrap-e2e.test.js && node tests/cli/bootstrap-restore.test.js",
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
- **`created_ts` is stripped before the node is stored** — it is fragment-only metadata that becomes the `node.created` timestamp. Asserted in Task 6's test (`tests/cli/bootstrap-merge.test.js`) so it cannot regress.

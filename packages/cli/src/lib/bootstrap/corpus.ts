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
    const at = Date.parse(a.merged_at);
    const bt = Date.parse(b.merged_at);
    const av = Number.isNaN(at) ? Infinity : at;
    const bv = Number.isNaN(bt) ? Infinity : bt;
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
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const [date, subject] = line.split("\x1f");
      const matched = /#(\d+)/.exec(subject ?? "");
      return {
        number: matched ? Number(matched[1]) : i + 1,
        title: subject ?? "",
        body: "",
        mergedAt: date ?? "",
        labels: [],
        files: [],
      };
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
    // nor followed, so a symlink cycle cannot inflate the inventory.
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
  if (options.since) {
    const floor = Date.parse(options.since);
    if (Number.isNaN(floor)) {
      throw new Error(`--since is not a parseable date: ${options.since} (try an ISO date like 2026-01-31)`);
    }
    // A PR whose own merged_at doesn't parse can't be shown to fall after the
    // cutoff either, so it is dropped here too (NaN >= floor is false).
    prs = prs.filter((pr) => Date.parse(pr.merged_at) >= floor);
  }

  const files = listFiles(cwd);
  const docs = buildDocsManifest(cwd, files);
  const surfaces = buildSurfaceInventory(files);

  ensureDir(at(cwd, CORPUS_DIR));
  writeFileSync(at(cwd, PRS_FILE), prs.map((pr) => JSON.stringify(pr)).join("\n") + (prs.length ? "\n" : ""));
  writeFileSync(at(cwd, DOCS_FILE), `${JSON.stringify(docs, null, 2)}\n`);
  writeFileSync(at(cwd, SURFACES_FILE), `${JSON.stringify(surfaces, null, 2)}\n`);

  return { prs: prs.length, docs: docs.length, surfaces: surfaces.length };
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

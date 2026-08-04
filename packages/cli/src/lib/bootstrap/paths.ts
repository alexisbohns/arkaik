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

export const BOOTSTRAP_ROOT = ".arkaik";
export const CORPUS_DIR = path.join(BOOTSTRAP_ROOT, "corpus");
export const PLAN_DIR = path.join(BOOTSTRAP_ROOT, "bootstrap");
export const FRAGMENTS_DIR = path.join(PLAN_DIR, "fragments");
export const MANIFEST_FILE = path.join(PLAN_DIR, "manifest.json");
export const PROFILE_FILE = path.join(PLAN_DIR, "profile.json");
export const PRS_FILE = path.join(CORPUS_DIR, "prs.jsonl");
export const DOCS_FILE = path.join(CORPUS_DIR, "docs.json");
export const SURFACES_FILE = path.join(CORPUS_DIR, "surfaces.json");

/** Absolute path for one of the constants above, under `cwd`. */
export function at(cwd: string, relative: string): string {
  return path.join(cwd, relative);
}

/** Create a directory (and parents) if it is missing. */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

/**
 * Add `.arkaik/` to the repo's .gitignore unless it is already ignored.
 * Returns true when the file was written. Idempotent: a second run is a no-op.
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

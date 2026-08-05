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

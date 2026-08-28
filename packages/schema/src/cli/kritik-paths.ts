/**
 * Shared file layout for the three standalone Kritik scripts
 * (`compute-matrix.js`, `scaffold-criterion.js`, `init-profile.js`).
 *
 * Those scripts run in a consuming repo with no `node_modules`, so everything
 * they need is either bundled into them by esbuild or read from a path relative
 * to where the plugin put them. This module owns the second half: where the
 * pack is, where the project's own files are, and how the two combine into the
 * effective library.
 *
 * The sidecar files under `docs/quality/` are **canonical in a repository** —
 * the same doctrine as the journal's JSONL sidecar (docs/spec/journal.md
 * § Storage Shapes), where a bundle's embedded copy is only the interchange
 * projection. Nothing here writes to a bundle; that is `arkaik kritik`'s job.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mergeKritikLibrary, type KritikLibrary, type KritikOverlay, type QualityProfile } from "../quality";

/** Where a project's own Kritik files live, relative to the repo root. */
export const QUALITY_DIR = "docs/quality";
export const PROFILE_FILE = "profile.json";
export const OVERLAY_FILE = "criteria.custom.json";
export const AUDITS_DIR = "audits";

/**
 * The pack shipped beside the script. The plugin lays out
 * `scripts/<name>.js` and `skills/kritik/references/library.json`, so the pack
 * sits two levels up and across; a checkout of the arkaik repo running these
 * from source finds it in the workspace instead. Both are tried before giving
 * up, because "which of my two install shapes is this" is not a question the
 * user should have to answer.
 */
export function packCandidates(scriptDir: string): string[] {
  return [
    join(scriptDir, "..", "skills", "kritik", "references", "library.json"),
    join(scriptDir, "references", "library.json"),
    join(scriptDir, "..", "..", "packages", "kritik-library", "framework.json"),
  ];
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write JSON with a trailing newline, creating parent directories as needed. */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** The criteria pack, from the first candidate path that exists. */
export function loadPack(scriptDir: string): KritikLibrary {
  for (const candidate of packCandidates(scriptDir)) {
    if (existsSync(candidate)) return readJson<KritikLibrary>(candidate);
  }
  throw new Error(
    `Kritik: no criteria pack found. Looked in:\n  ${packCandidates(scriptDir).map((p) => resolve(p)).join("\n  ")}`,
  );
}

export const profilePath = (root: string): string => join(root, QUALITY_DIR, PROFILE_FILE);
export const overlayPath = (root: string): string => join(root, QUALITY_DIR, OVERLAY_FILE);
export const auditDir = (root: string, auditId: string): string => join(root, QUALITY_DIR, AUDITS_DIR, auditId);

/** The project's profile, or null when Kritik has not been installed here yet. */
export function loadProfile(root: string): QualityProfile | null {
  const path = profilePath(root);
  return existsSync(path) ? readJson<QualityProfile>(path) : null;
}

/** The project's overlay, or null when it has not added a criterion of its own. */
export function loadOverlay(root: string): KritikOverlay | null {
  const path = overlayPath(root);
  return existsSync(path) ? readJson<KritikOverlay>(path) : null;
}

/** Pack + overlay, the library every script actually scores against. */
export function loadEffectiveLibrary(scriptDir: string, root: string): KritikLibrary {
  return mergeKritikLibrary(loadPack(scriptDir), loadOverlay(root));
}

/**
 * Fail with a message rather than a stack trace. These scripts are run by
 * agents and by people in a terminal; neither is helped by seeing our frames.
 */
export function die(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

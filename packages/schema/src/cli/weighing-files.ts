/**
 * The weighing sidecar files under `docs/weighing/` — reading them, writing
 * them, and folding them into a `WeighingSection`.
 *
 * `weighing.ts` answers "what is an assessment"; this answers "where does a
 * repository keep them". The files are **canonical in a repository** — the same
 * doctrine as the journal's JSONL sidecar and Kritik's `docs/quality/`
 * (docs/spec/journal.md § Storage Shapes) — with the bundle's `weighing` key as
 * the interchange projection `arkaik pack` builds. Nothing here writes to a
 * bundle.
 *
 *   docs/weighing/
 *     sets/<set-id>.json            a project-authored criteria set — the positioning
 *     assessments/<matrix-id>.json  { matrix, assessments[] }, latest per scorer kind
 *
 * Like `kritik-audit.ts`, everything here **throws** rather than exits: the
 * `arkaik` CLI turns a throw into a usage-shaped failure and the MCP tools turn
 * it into a `ToolError` an agent can read.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sortWeighingAssessments, type WeighingAssessment, type WeighingCriteriaSet, type WeighingSection } from "../weighing";
import { readJson, writeJson } from "./kritik-paths";

/** Where a project's own weighing files live, relative to the repo root. */
export const WEIGHING_DIR = "docs/weighing";
export const WEIGHING_SETS_DIR = "sets";
export const WEIGHING_ASSESSMENTS_DIR = "assessments";

/** `assessments/<matrix>.json`: one matrix's stored cells. */
export interface AssessmentsFile {
  matrix: string;
  assessments: WeighingAssessment[];
}

/**
 * An id is a file name, so it is held to kebab-case here as well as upstream:
 * `../` in a matrix id must never be able to reach outside `docs/weighing/`.
 */
function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not a valid weighing id (kebab-case, no path separators)`);
  return id;
}

export const weighingDir = (root: string): string => join(root, WEIGHING_DIR);
export const weighingSetPath = (root: string, setId: string): string => join(weighingDir(root), WEIGHING_SETS_DIR, `${safeId(setId)}.json`);
export const weighingAssessmentsPath = (root: string, matrixId: string): string =>
  join(weighingDir(root), WEIGHING_ASSESSMENTS_DIR, `${safeId(matrixId)}.json`);

/** The `.json` files of a directory, by name; none when it does not exist. */
function jsonFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * The assessments of one `assessments/<matrix>.json`, or a throw that names the
 * file. JSON `null`, a bare array, a string and `{}` all parse — so the shape is
 * checked BEFORE a property is read, and none of them is a TypeError.
 */
function assessmentsOfFile(file: string): WeighingAssessment[] {
  const parsed: unknown = readJson<unknown>(file);
  const assessments = typeof parsed === "object" && parsed !== null ? (parsed as Partial<AssessmentsFile>).assessments : undefined;
  if (!Array.isArray(assessments)) throw new Error(`${file}: expected { "matrix": …, "assessments": [] }`);
  return assessments;
}

/** Every project-authored set on disk, by file name. */
export function loadWeighingSets(root: string): WeighingCriteriaSet[] {
  return jsonFilesIn(join(weighingDir(root), WEIGHING_SETS_DIR)).map((file) => readJson<WeighingCriteriaSet>(file));
}

/** Every stored assessment on disk, matrix by matrix. A file that is not `{ assessments: [] }` throws, naming the file. */
export function loadWeighingAssessments(root: string): WeighingAssessment[] {
  return jsonFilesIn(join(weighingDir(root), WEIGHING_ASSESSMENTS_DIR)).flatMap(assessmentsOfFile);
}

/**
 * The section the files hold, or `undefined` when there is nothing to fold —
 * no `docs/weighing/`, or one with no sets and no assessments in it. Assessments
 * come back in the stable order a save writes, so a packed bundle is
 * byte-for-byte the same however the files were edited. `matrices`
 * stays empty: the built-in `value` matrix is library content, and a
 * project-defined matrix is not a slice-1 feature.
 */
export function loadWeighingSection(root: string): WeighingSection | undefined {
  const sets = loadWeighingSets(root);
  const assessments = loadWeighingAssessments(root);
  if (sets.length === 0 && assessments.length === 0) return undefined;
  return { sets, matrices: [], assessments: sortWeighingAssessments(assessments) };
}

/** Write one matrix's cells, in the stable order that keeps two writers' diffs small. */
export function saveWeighingAssessments(root: string, matrixId: string, assessments: readonly WeighingAssessment[]): void {
  const file: AssessmentsFile = { matrix: matrixId, assessments: sortWeighingAssessments(assessments) };
  writeJson(weighingAssessmentsPath(root, matrixId), file);
}

/** Write one set — the positioning. */
export function saveWeighingSet(root: string, set: WeighingCriteriaSet): void {
  writeJson(weighingSetPath(root, set.id), set);
}

/** The stored cells of one matrix, `[]` when its file does not exist. */
export function loadMatrixAssessments(root: string, matrixId: string): WeighingAssessment[] {
  const file = weighingAssessmentsPath(root, matrixId);
  if (!existsSync(file)) return [];
  return assessmentsOfFile(file);
}

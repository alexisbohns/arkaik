/**
 * The audit files under `docs/quality/audits/<id>/` — reading them, writing
 * them, and rolling one audit up into its matrix.
 *
 * `kritik-paths.ts` answers "where does Kritik keep things"; this answers "what
 * is in those files and how does a run become a matrix". Both are the sidecar
 * half of the layer, canonical in a repository the way `journal.jsonl` is, with
 * the bundle's `quality` section as the interchange projection.
 *
 * Everything here **throws** rather than exiting. It is imported by the
 * standalone plugin scripts (which turn a throw into `die`), by the `arkaik
 * kritik` verbs (which turn it into a usage-shaped failure), and by the
 * `kritik_*` MCP tools (which turn it into a `ToolError` an agent can read).
 * A `process.exit` in a library would take the MCP server's whole session down
 * because one tool call named a missing audit.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  deriveQualityMatrix,
  gradeOf,
  type KritikLibrary,
  type QualityAssessment,
  type QualityFinding,
  type QualityMatrix,
  type QualityMatrixCell,
  type QualityProfile,
  type QualitySection,
} from "../quality";
import { QUALITY_DIR, auditDir, auditsDir, loadProfile, readJson, writeJson } from "./kritik-paths";

/** `scores.json`: one audit run's assessments, plus what they were scored against. */
export interface ScoresFile {
  audit_id?: string;
  commit?: string;
  framework_version?: string;
  assessments: QualityAssessment[];
}

/**
 * `findings.json`: one audit run's findings.
 *
 * The `findings` key is not dressing — the roll-up reads it by name, so a bare
 * array in that file rolls up as zero findings and every anti-averaging cap
 * silently fails to fire. A run that produced none writes the wrapper with an
 * empty array rather than skipping the file.
 */
export interface FindingsFile {
  audit_id?: string;
  commit?: string;
  framework_version?: string;
  findings: QualityFinding[];
}

/** `matrix.json`: GENERATED. The only writer is {@link computeAuditMatrix}. */
export interface MatrixFile {
  audit_id: string;
  commit?: string;
  framework_version: string;
  matrix: QualityMatrix["matrix"];
  overall: QualityMatrix["overall"];
  finding_counts: QualityMatrix["finding_counts"];
}

export const SCORES_FILE = "scores.json";
export const FINDINGS_FILE = "findings.json";
export const MATRIX_FILE = "matrix.json";

export const scoresPath = (root: string, auditId: string): string => join(auditDir(root, auditId), SCORES_FILE);
export const findingsPath = (root: string, auditId: string): string => join(auditDir(root, auditId), FINDINGS_FILE);
export const matrixPath = (root: string, auditId: string): string => join(auditDir(root, auditId), MATRIX_FILE);

/** Every audit id present, oldest first. Audit ids sort chronologically by convention (`YYYY-MM`). */
export function listAuditIds(root: string): string[] {
  const dir = auditsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

/**
 * The newest audit id, so the common case ("roll up what I just did") needs no
 * argument. Throws when there is nothing to roll up, naming the directory it
 * looked in — the two ways to get here are "no audit yet" and "wrong `--root`",
 * and the path tells them apart at a glance.
 */
export function newestAuditId(root: string): string {
  const dir = auditsDir(root);
  if (!existsSync(dir)) throw new Error(`no audits directory at ${dir}`);
  const ids = listAuditIds(root);
  if (ids.length === 0) throw new Error(`no audits found under ${dir}`);
  return ids[ids.length - 1];
}

/** `auditId` if given, otherwise the newest one on disk. */
export function resolveAuditId(root: string, auditId?: string): string {
  return auditId ?? newestAuditId(root);
}

export function loadScores(root: string, auditId: string): ScoresFile {
  const path = scoresPath(root, auditId);
  if (!existsSync(path)) throw new Error(`no ${SCORES_FILE} at ${path}`);
  const file = readJson<ScoresFile>(path);
  return { ...file, assessments: Array.isArray(file.assessments) ? file.assessments : [] };
}

/** Like {@link loadScores}, but an audit that has not been scored yet is empty, not an error. */
export function loadScoresOrEmpty(root: string, auditId: string): ScoresFile {
  return existsSync(scoresPath(root, auditId)) ? loadScores(root, auditId) : { audit_id: auditId, assessments: [] };
}

/** A run that produced no findings is a real (if rare) outcome, not a setup error. */
export function loadFindings(root: string, auditId: string): FindingsFile {
  const path = findingsPath(root, auditId);
  if (!existsSync(path)) return { audit_id: auditId, findings: [] };
  const file = readJson<FindingsFile>(path);
  return { ...file, findings: Array.isArray(file.findings) ? file.findings : [] };
}

export function saveScores(root: string, auditId: string, file: ScoresFile): void {
  writeJson(scoresPath(root, auditId), file);
}

export function saveFindings(root: string, auditId: string, file: FindingsFile): void {
  writeJson(findingsPath(root, auditId), file);
}

/**
 * The project's profile, or a refusal that says what to do about it. Without a
 * surface list there are no columns to roll up into, so every verb that touches
 * a cell needs this and none of them can guess it.
 */
export function requireProfile(root: string): QualityProfile {
  const profile = loadProfile(root);
  if (!profile) {
    throw new Error(
      `no profile at ${join(root, QUALITY_DIR, "profile.json")} — pick this project's surfaces first ` +
        `(\`arkaik kritik profile\`, or the plugin's init-profile.js).`,
    );
  }
  return profile;
}

/**
 * One audit assembled into the shape the projections read — the same
 * {@link QualitySection} the bundle carries, built from the sidecars instead.
 * This is the seam that makes "sidecar canonical, bundle section interchange"
 * true rather than aspirational: `deriveQualityMatrix` cannot tell which side
 * it was handed.
 */
export function loadQualitySection(
  root: string,
  auditId: string,
  library: KritikLibrary,
  scores: ScoresFile = loadScores(root, auditId),
): QualitySection {
  const findings = loadFindings(root, auditId);
  return {
    framework_version: scores.framework_version ?? library.version,
    profile: requireProfile(root),
    assessments: scores.assessments,
    findings: findings.findings,
  };
}

/**
 * A finding as the interchange projection carries it: without `severity` and
 * without `priority`.
 *
 * Both are derived from `impact × likelihood` (and, for priority, `cost`) by
 * `severityOf`/`priorityOf`, which never read a stored value — so dropping
 * them loses nothing a reader can observe. `validateBundle` warns
 * `quality-derived-field-stored` on either, and a projection that emits a
 * bundle its own validator objects to is a broken projection. The sidecar
 * keeps whatever it keeps; this is a read.
 *
 * Module-internal: the two projections below are the only callers, and both
 * are exported. Nothing outside should be stripping findings by hand — that
 * would be a second answer to "what does the interchange carry".
 */
function stripDerived(finding: QualityFinding): QualityFinding {
  const { severity: _severity, priority: _priority, ...rest } = finding as QualityFinding &
    Record<"severity" | "priority", unknown>;
  void _severity;
  void _priority;
  return rest as QualityFinding;
}

/**
 * Refuse a named audit that is not on disk.
 *
 * Shared by the projection and by the CLI seam that calls it, so "you named an
 * audit that isn't there" is one error with one wording, raised before either
 * layer's it-is-fine-to-have-nothing short-circuits can swallow it.
 */
export function requireAudit(root: string, auditId: string): void {
  if (!listAuditIds(root).includes(auditId)) {
    throw new Error(`no audit "${auditId}" under ${auditsDir(root)}`);
  }
}

/**
 * The project's **current** quality state, merged across every audit on disk
 * — the interchange projection `bundle.quality` carries.
 *
 * This is not {@link loadQualitySection} over the newest audit, and the
 * difference is the point. `arkaik kritik score` writes into the newest audit
 * directory, so a partial re-audit leaves a sparse newest `scores.json`;
 * taking it whole would render a mostly-empty matrix and drop every
 * still-open finding from earlier runs. So assessments are **latest-wins per
 * (criterion × surface)** across every audit — which is what
 * `QualitySection.assessments` is documented as, and what `validateBundle`'s
 * `quality-duplicate-assessment` insists on — and findings are pooled, the
 * way `locateFinding` and `allFindings` already read the tree.
 *
 * The consequence is deliberate: this answers "where does the product stand".
 * {@link loadAuditQualitySection}, `matrix.json` and `arkaik kritik matrix`
 * answer "how did this audit go". They are different questions, and a cap can
 * fire here that did not fire in a single audit's roll-up — an open Critical
 * from two audits ago still caps its cell, which is true.
 *
 * `undefined`, rather than a throw, when there is nothing to merge: no
 * audits, or no profile. Both are ordinary states in a repo that has not
 * finished installing Kritik, and neither is a reason to fail a bundle
 * assembly. A *malformed* sidecar is not one of them and does throw — a
 * broken file is a broken file, not an unfinished install.
 */
export function loadCurrentQualitySection(root: string, library: KritikLibrary): QualitySection | undefined {
  const auditIds = listAuditIds(root);
  if (auditIds.length === 0) return undefined;

  const profile = loadProfile(root);
  if (!profile) return undefined;

  // Insertion-ordered: re-setting a key keeps the cell's original position and
  // replaces its value, so the output is stable for a given tree.
  const cells = new Map<string, QualityAssessment>();
  const findings: QualityFinding[] = [];
  let frameworkVersion: string | undefined;

  for (const id of auditIds) {
    const scores = loadScoresOrEmpty(root, id);
    if (typeof scores.framework_version === "string") frameworkVersion = scores.framework_version;
    for (const assessment of scores.assessments) {
      cells.set(`${assessment.criterion_id}\u0000${assessment.surface}`, assessment);
    }
    for (const finding of loadFindings(root, id).findings) findings.push(stripDerived(finding));
  }

  return {
    framework_version: frameworkVersion ?? library.version,
    library,
    profile,
    assessments: [...cells.values()],
    findings,
  };
}

/**
 * ONE audit's state, as the interchange projection would carry it — the
 * snapshot, not the merge.
 *
 * {@link loadQualitySection} already assembles an audit; this is that, plus
 * the two things a *projection* owes a reader the merge also gives it: the
 * effective library embedded, so the section can be graded without the
 * sidecars, and `severity`/`priority` stripped, so the bundle does not store
 * what {@link stripDerived} explains nobody may store.
 *
 * Throws, where {@link loadCurrentQualitySection} returns `undefined`, and the
 * asymmetry is the argument: naming an audit is a claim that it exists.
 *
 * It reads scores through {@link loadScoresOrEmpty}, though — the seam
 * `loadQualitySection`'s fourth argument exists for. An audit directory
 * holding `findings.json` and no `scores.json` is a real state (a finding
 * opened before anything on that surface was scored), and the merge already
 * tolerates it. Letting the pinned path throw on it would mean `pack`
 * succeeding and `pack --audit <that one>` failing on the same tree, which
 * tells the user nothing true about their repo.
 */
export function loadAuditQualitySection(
  root: string,
  auditId: string,
  library: KritikLibrary,
): QualitySection {
  requireAudit(root, auditId);
  const section = loadQualitySection(root, auditId, library, loadScoresOrEmpty(root, auditId));
  return { ...section, library, findings: section.findings.map(stripDerived) };
}

/**
 * Roll an audit up and write its `matrix.json`.
 *
 * This is the **only** thing that may write that file. Everything it returns is
 * derived from `scores.json` + `findings.json` + the effective library, so a
 * hand-edited matrix is not a shortcut — it is a claim the next run contradicts.
 */
export function computeAuditMatrix(
  root: string,
  auditId: string,
  library: KritikLibrary,
): { section: QualitySection; matrix: QualityMatrix; file: MatrixFile } {
  const scores = loadScores(root, auditId);
  const section = loadQualitySection(root, auditId, library, scores);
  const matrix = deriveQualityMatrix({ quality: section }, library);
  const file: MatrixFile = {
    audit_id: auditId,
    commit: scores.commit,
    framework_version: section.framework_version,
    matrix: matrix.matrix,
    overall: matrix.overall,
    finding_counts: matrix.finding_counts,
  };
  writeJson(matrixPath(root, auditId), file);
  return { section, matrix, file };
}

/**
 * The comparative matrix as a markdown table: domains down, surfaces across,
 * `score (grade)` per cell with an asterisk where a cap fired. An unscored cell
 * is an em dash, never a zero — "not assessed" and "assessed at nothing" are
 * different claims.
 */
export function renderMatrixMarkdown(matrix: QualityMatrix, domainNames: Map<string, string>): string {
  const cell = (value: QualityMatrixCell | null | undefined) =>
    value ? `${value.score} (${value.grade}${value.capped ? "*" : ""})` : "—";
  const lines: string[] = [];
  lines.push(`| Domain | ${matrix.surfaces.join(" | ")} |`);
  lines.push(`| --- | ${matrix.surfaces.map(() => "---").join(" | ")} |`);
  for (const domain of matrix.domains) {
    const label = domainNames.get(domain) ?? domain;
    lines.push(
      `| **${domain}** ${label} | ${matrix.surfaces.map((s) => cell(matrix.matrix[domain]?.[s])).join(" | ")} |`,
    );
  }
  lines.push(
    `| **Overall (weighted)** | ${matrix.surfaces
      .map((s) => {
        const score = matrix.overall[s];
        return score === null || score === undefined ? "—" : `**${score} (${gradeOf(score)})**`;
      })
      .join(" | ")} |`,
  );
  return lines.join("\n");
}

/** A finding located by id, wherever in the audit history it was opened. */
export interface LocatedFinding {
  auditId: string;
  file: FindingsFile;
  finding: QualityFinding;
}

/**
 * Find one finding by id across every audit, newest first.
 *
 * Resolving and accepting are not audit-scoped operations: a finding opened in
 * `2026-08` is fixed whenever the PR merges, which is routinely during
 * `2026-09`. Scoping the lookup to one audit would make `finding resolve` fail
 * on exactly the findings that took long enough to matter. Newest-first so that
 * if an id was somehow reused across runs, the live one wins.
 */
export function locateFinding(root: string, id: string): LocatedFinding | undefined {
  for (const auditId of [...listAuditIds(root)].reverse()) {
    const file = loadFindings(root, auditId);
    const finding = file.findings.find((candidate) => candidate.id === id);
    if (finding) return { auditId, file, finding };
  }
  return undefined;
}

/** Every finding across every audit, oldest audit first — the findings board's input. */
export function allFindings(root: string): { auditId: string; finding: QualityFinding }[] {
  const rows: { auditId: string; finding: QualityFinding }[] = [];
  for (const auditId of listAuditIds(root)) {
    for (const finding of loadFindings(root, auditId).findings) rows.push({ auditId, finding });
  }
  return rows;
}

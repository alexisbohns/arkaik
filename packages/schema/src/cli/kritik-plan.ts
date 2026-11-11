/**
 * The plan file under `docs/quality/plans/<planId>.json` — making a plan from
 * the repo's files, writing it, reading it back, and reading each part's
 * progress from its audit directory (docs/superpowers/specs/2026-11-11-kritik-planner-design.md).
 *
 * The assembly is pure (`buildKritikPlan` in `quality-plan.ts`); this module is
 * the half that touches the disk and git. Like `kritik-audit.ts` beside it,
 * everything here **throws** rather than exiting: `arkaik kritik plan` turns a
 * throw into a usage-shaped failure and `kritik_plan` into a `ToolError`.
 *
 * A plan file is written once and never updated. Part status is derived from
 * the parts' audit directories on every read, so parallel sessions scoring
 * different parts never contend for the file.
 *
 * zod is allowed here (the stack contract): the plugin scripts never import
 * this module, and `kritik-audit.ts` must never import it — the dependency
 * runs one way, from here to there.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EventInput } from "../derive";
import type { JournalEvent } from "../journal";
import { deriveQualityMatrix, type KritikLibrary, type QualityAssessment, type QualityMatrix, type QualitySection } from "../quality";
import { auditCompletedInput } from "../quality-ops";
import {
  PLAN_PLANS_DIR,
  buildKritikPlan,
  coverageOf,
  isPlanId,
  outsortedBy,
  parseRun,
  planCellKey,
  planCells,
  planIdOfPartId,
  planPartStatuses,
  type KritikPlan,
  type KritikPlanCell,
  type PlanAuditScope,
  type PlanPartStatus,
} from "../quality-plan";
import { parseKritikPlan } from "../quality-schemas";
import { recordedAuditIds, recordedPlans, scopeAnchorId } from "../quality-scope";
import { listAuditIds, loadQualitySectionThrough, loadScoresOrEmpty, requireProfile } from "./kritik-audit";
import { QUALITY_DIR, readJson, writeJson } from "./kritik-paths";

/** Where plan files live: `docs/quality/plans/`. */
export const plansDir = (root: string): string => join(root, QUALITY_DIR, PLAN_PLANS_DIR);

/** The one path `--status`, `matrix --plan` and `kritik_plan` read a plan from. */
export const planPath = (root: string, planId: string): string => join(plansDir(root), `${planId}.json`);

/**
 * Every plan file's id (its basename without `.json`), sorted; `[]` when there
 * is no plans directory. A JSON file whose name is not a plan id is not a plan:
 * left in, a stray `notes.json` would sort after every counter and block every
 * later plan.
 */
export function listPlanIds(root: string): string[] {
  const dir = plansDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && statSync(join(dir, name)).isFile())
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => isPlanId(id))
    .sort();
}

/** A plan file, parsed and checked against the schema. Throws `no plan at <path>` or `<path>: <issue>`. */
export function readPlanFile(path: string): KritikPlan {
  if (!existsSync(path)) throw new Error(`no plan at ${path}`);
  const parsed = parseKritikPlan(readJson<unknown>(path));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.issue}`);
  return parsed.plan;
}

/**
 * The plan `planId`, from `docs/quality/plans/<planId>.json`. Refuses an id
 * that is not a plan id before touching the disk (it becomes a path), and a
 * file whose own `planId` is another plan's.
 */
export function loadPlan(root: string, planId: string): KritikPlan {
  if (!isPlanId(planId)) {
    throw new Error(`"${planId}" is not a plan id — a plan id reads YYYY-MM-zplan-DDNN, as \`arkaik kritik plan\` prints it.`);
  }
  const path = planPath(root, planId);
  const plan = readPlanFile(path);
  if (plan.planId !== planId) {
    throw new Error(`${path} holds the plan "${plan.planId}", not "${planId}" — a plan file is named for its plan id.`);
  }
  return plan;
}

export function savePlan(path: string, plan: KritikPlan): void {
  writeJson(path, plan);
}

/** HEAD's full sha, or null outside a git checkout, without git, or on any other failure. */
export function gitHead(root: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    if (result.error !== undefined || result.status !== 0) return null;
    const sha = result.stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * A new plan from the repo as it stands: the profile's surfaces, the library's
 * domain codes, and every id the plan must sort after — audit directories, plan
 * files, and the recorded audit ids the caller read from its journal. Writes
 * nothing; the caller decides where (and whether) the plan goes.
 */
export function createPlan(
  root: string,
  library: KritikLibrary,
  runTokens: readonly string[],
  options: { recorded?: readonly string[]; now?: Date } = {},
): { plan: KritikPlan; warnings: string[] } {
  const profile = requireProfile(root);
  const surfaces = (profile.surfaces ?? []).map((surface) => surface.id);
  const { runs, warnings } = parseRun(runTokens, {
    domains: (library.domains ?? []).map((domain) => domain.code),
    surfaces,
  });
  const known = [...new Set([...listAuditIds(root), ...listPlanIds(root), ...(options.recorded ?? [])])];
  const plan = buildKritikPlan({
    library,
    surfaces,
    runs,
    known,
    now: options.now ?? new Date(),
    commit: gitHead(root),
  });
  return { plan, warnings };
}

/** Each part's progress, from the scores under its audit id in this checkout. */
export function planStatus(root: string, plan: KritikPlan): PlanPartStatus[] {
  const scoresByPart = Object.fromEntries(
    plan.parts.map((part) => [part.auditId, loadScoresOrEmpty(root, part.auditId).assessments]),
  );
  return planPartStatuses(plan, scoresByPart);
}

// --- P4: recording a plan ------------------------------------------------------------------

/** Everything a plan's record needs, and nothing written: the caller appends `input` through its own path. */
export interface PlanRecord {
  plan: KritikPlan;
  section: QualitySection;
  matrix: QualityMatrix;
  scope: PlanAuditScope;
  input: EventInput;
}

const cellLabel = (cell: KritikPlanCell): string => `${cell.criterion_id} on ${cell.surface}`;
const runFlags = (parts: readonly Pick<KritikPlan["parts"][number], "domain" | "surface">[]): string =>
  parts.map((part) => `--run ${part.domain}:${part.surface}`).join(" ");

/**
 * The one record function (spec "`matrix --record --plan`"), behind both
 * `arkaik kritik matrix <planId> --record --plan` and `kritik_matrix plan=true`.
 *
 * It reads the plan file, the profile, the audit directories and the given journal events,
 * and throws `Error` at the first refusal, in this order: the plan file is missing or invalid
 * (`loadPlan`, which also refuses an id that is not a plan id); the plan is already recorded;
 * its cells or framework version moved since it was made; an audit now sorts after one of its
 * parts (`outsortedBy` — a scoped re-audit or another plan made meanwhile would win the
 * latest-wins merge on every cell both hold, so the recorded matrix would not be the plan's);
 * an audit directory sorting before the plan's last part, not one of its parts, never recorded
 * and holding scores (the merge would carry those scores into the record unannounced);
 * a part holds a score outside its cells (refused, not ignored — the merge reads every audit
 * directory, so a stray score would enter the matrix anyway); a plan cell has no score. Then it
 * builds the merged reading through the plan's last part (`loadQualitySectionThrough`,
 * latest-wins), the `PlanAuditScope` marker — `since` from the newest non-plan record, omitted
 * on a first audit — and the `quality.audit.completed` input under the plan id.
 *
 * Recording never resolves, reopens or opens a finding; nothing here touches one.
 */
export function preparePlanRecord(root: string, planId: string, library: KritikLibrary, events: readonly JournalEvent[]): PlanRecord {
  // 1. The plan file: throws "<id> is not a plan id", "no plan at <path>" or "<path>: <issue>".
  const plan = loadPlan(root, planId);

  // 2. Once per plan. The journal is append-only; a correction is a new plan.
  if (recordedPlans(events).some((recorded) => recorded.plan === planId) || recordedAuditIds(events).includes(planId)) {
    throw new Error(
      `plan "${planId}" is already recorded — its reading is history, and the journal is append-only. ` +
        `To correct it, make a new plan for the same parts (\`arkaik kritik plan ${runFlags(plan.parts)}\`) and record that one.`,
    );
  }

  const included = plan.parts.filter((part) => part.status === "included");
  if (included.length === 0) {
    throw new Error(`plan "${planId}" includes no part — every part was deferred, so there is nothing to record.`);
  }

  // 3. The cells as the library and the profile make them now, against the plan's, as sets.
  const surfaces = (requireProfile(root).surfaces ?? []).map((surface) => surface.id);
  const moved: string[] = [];
  if (plan.frameworkVersion !== library.version) {
    moved.push(`the framework is ${library.version} now, and the plan was made against ${plan.frameworkVersion}`);
  }
  for (const part of included) {
    const current = planCells(library, surfaces, { domain: part.domain, surface: part.surface }).cells;
    const was = new Set(part.cells.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
    const is = new Set(current.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
    const added = current.filter((cell) => !was.has(planCellKey(cell.criterion_id, cell.surface)));
    const removed = part.cells.filter((cell) => !is.has(planCellKey(cell.criterion_id, cell.surface)));
    const changes: string[] = [];
    if (added.length > 0) changes.push(`gained ${added.map((cell) => cell.criterion_id).join(", ")}`);
    if (removed.length > 0) changes.push(`lost ${removed.map((cell) => cell.criterion_id).join(", ")}`);
    if (changes.length > 0) moved.push(`${part.domain}:${part.surface} ${changes.join(" and ")}`);
  }
  if (moved.length > 0) {
    throw new Error(
      `the cells have moved since plan "${planId}" was made — ${moved.join("; ")}. ` +
        `Make a new plan: \`arkaik kritik plan ${runFlags(included)}\`.`,
    );
  }

  // 4. Every part still sorts last among the audits on disk. The writers refuse
  // to score into an outsorted part, but a part scored BEFORE the other audit
  // appeared would otherwise lose the merge silently, here.
  const onDiskIds = listAuditIds(root);
  const outsorted = included
    .map((part) => ({ part, later: outsortedBy(part.auditId, onDiskIds) }))
    .filter((entry) => entry.later.length > 0);
  if (outsorted.length > 0) {
    throw new Error(
      `plan "${planId}" cannot be recorded — audits merge latest-wins in id order, and on any cell an audit sorting after ` +
        `a part also holds, that part's scores would lose the merge:\n` +
        outsorted.map(({ part, later }) => `  ${part.auditId}: ${later.map((id) => `"${id}"`).join(", ")} now sort${later.length === 1 ? "s" : ""} after it`).join("\n") +
        `\nMake a new plan for the affected parts and score them again: \`arkaik kritik plan ${runFlags(outsorted.map(({ part }) => part))}\` ` +
        `names parts that sort last again.`,
    );
  }

  // 5. Nothing unrecorded rides in. The record merges every audit directory through the
  // plan's last part, but names only the plan's own cells as re-scored: an earlier directory
  // that was never recorded and holds scores — another plan's unfinished part, a hand-named
  // audit — would enter the recorded matrix unannounced, and the trend would never show it.
  const last = included.map((part) => part.auditId).sort()[included.length - 1];
  const ownParts = new Set(included.map((part) => part.auditId));
  const recordedIds = new Set(recordedAuditIds(events));
  const unannounced = onDiskIds
    .filter((id) => id < last && !ownParts.has(id) && !recordedIds.has(id))
    .map((id) => ({ id, scores: loadScoresOrEmpty(root, id).assessments.length }))
    .filter((entry) => entry.scores > 0);
  if (unannounced.length > 0) {
    throw new Error(
      `plan "${planId}" cannot be recorded — ${unannounced.length === 1 ? "an audit directory sorts" : "audit directories sort"} before its last part, ` +
        `${unannounced.length === 1 ? "holds scores and was" : "hold scores and were"} never recorded. The record merges every audit through ` +
        `the plan's last part but names only the plan's own cells as re-scored, so ${unannounced.length === 1 ? "its scores" : "their scores"} ` +
        `would enter this plan's record unannounced:\n` +
        unannounced
          .map(({ id, scores }) => {
            const owner = planIdOfPartId(id);
            return `  ${id}: ${scores} score${scores === 1 ? "" : "s"}, never recorded` + (owner !== null ? ` (a part of plan "${owner}")` : "");
          })
          .join("\n") +
        `\nRecord each first, or remove its scores (docs/quality/audits/<id>/scores.json), then record this plan.`,
    );
  }

  // 6 and 7. Each part scored exactly its cells.
  const onDisk = new Set(onDiskIds);
  const scoresByPart: Record<string, QualityAssessment[]> = {};
  for (const part of included) scoresByPart[part.auditId] = loadScoresOrEmpty(root, part.auditId).assessments;
  const statuses = planPartStatuses({ parts: included }, scoresByPart);

  const strays = statuses.filter((status) => status.stray.length > 0);
  if (strays.length > 0) {
    const count = strays.reduce((sum, status) => sum + status.stray.length, 0);
    throw new Error(
      `${count} score${count === 1 ? "" : "s"} outside plan "${planId}" — the merge reads every audit directory, ` +
        `so ${count === 1 ? "it" : "they"} would enter the recorded matrix anyway. ` +
        `Remove ${count === 1 ? "it" : "them"} before recording, or make a plan that includes ${count === 1 ? "it" : "them"}:\n` +
        strays
          .map(
            (status) =>
              `  ${status.auditId}: ${status.stray.map(cellLabel).join(", ")} — ` +
              `for each, delete its row from docs/quality/audits/${status.auditId}/scores.json`,
          )
          .join("\n"),
    );
  }

  const unscored = statuses.filter((status) => status.missing.length > 0);
  if (unscored.length > 0) {
    const count = unscored.reduce((sum, status) => sum + status.missing.length, 0);
    throw new Error(
      `${count} plan cell${count === 1 ? " has" : "s have"} no score yet — a plan records once, after every part is scored ` +
        `(\`arkaik kritik plan --status ${planId}\`):\n` +
        unscored
          .map((status) =>
            onDisk.has(status.auditId)
              ? `  ${status.auditId}: ${status.missing.map(cellLabel).join(", ")}`
              : `  ${status.auditId}: no audit directory in this checkout — if this part ran in another worktree, ` +
                `copy or merge its docs/quality/audits/${status.auditId}/ here first`,
          )
          .join("\n"),
    );
  }

  // The merged reading through the plan's last part, and its marker.
  const section = loadQualitySectionThrough(root, last, library);
  const matrix = deriveQualityMatrix({ quality: section }, library);
  const scored = included.flatMap((part) => part.cells.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
  const since = scopeAnchorId(events);
  const scope: PlanAuditScope = {
    partial: true,
    cells: scored.length,
    ...(since !== null ? { since } : {}),
    plan: plan.planId,
    parts: included.map((part) => part.auditId),
    scored,
    coverage: coverageOf(section, library, scored.length),
  };
  const input = auditCompletedInput(matrix, {
    audit_id: plan.planId,
    framework_version: plan.frameworkVersion,
    ...(plan.commit !== null ? { commit: plan.commit } : {}),
    scope,
  });
  return { plan, section, matrix, scope, input };
}

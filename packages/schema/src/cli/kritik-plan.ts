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
import type { KritikLibrary } from "../quality";
import {
  PLAN_PLANS_DIR,
  buildKritikPlan,
  isPlanId,
  parseRun,
  planPartStatuses,
  type KritikPlan,
  type PlanPartStatus,
} from "../quality-plan";
import { parseKritikPlan } from "../quality-schemas";
import { listAuditIds, loadScoresOrEmpty, requireProfile } from "./kritik-audit";
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

export function loadPlan(root: string, planId: string): KritikPlan {
  return readPlanFile(planPath(root, planId));
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

/**
 * The prompts a Kritik plan carries (docs/superpowers/specs/2026-11-11-kritik-planner-design.md
 * § Prompt template): one per part, for a session that runs that part alone,
 * and one for a session that runs every included part in order.
 *
 * A prompt is the whole interface between the planner and an agent, so it
 * names every cell and every command in full. Two invariants carry the plan's
 * safety and a test pins both: every `kritik score` line passes `--audit
 * <partId>` (without it a score lands in the newest audit on disk, which with
 * two parts in flight may be the other part), and only the combined prompt's
 * last step records — a part prompt never names `--record`, because a part
 * is half a reading.
 *
 * Pure and zod-free. Its top level holds only constants and function
 * declarations, so esbuild drops it from the plugin scripts that do not call it.
 */

import type { KritikPlan, KritikPlanBand, KritikPlanPart } from "./quality-plan";

/** A part as the renderers read it: everything but the prompt being rendered. */
type PromptPart = Omit<KritikPlanPart, "prompt">;

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

const SKILL_STEP =
  'Follow the Kritik skill (SKILL.md), section "A planned partial audit". Run it in the repository checkout: a hosted session cannot score a plan part.';

const USAGE_READOUT = "this session's usage readout: model, tokens in and out, duration, number of agents.";

/** `signals` exits 1 when anything tripped since the last recorded audit (its CI use); an agent must not read that as a failure. */
const SIGNALS_EXIT =
  "It exits 1 when a signal has tripped since the last recorded audit: that is information for this audit, not an error.";

/** The flags `arkaik kritik finding open` requires, in its usage order, so the command runs as written. */
const FINDING_FLAGS = '--title "<one line>" --impact <1-5> --likelihood <1-5> --cost <S|M|L|XL> --evidence "<file:line …>"';

/** The one command that records a plan, printed by `plan` and run once at the end. */
export function planRecordCommand(planId: string): string {
  return `arkaik kritik matrix ${planId} --record --plan`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function tokenCount(value: number): string {
  return String(Math.round(value)).replace(THOUSANDS, ",");
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `(commit <sha>)`, or what a plan made outside git says instead. */
function where(commit: string | null): string {
  return commit === null ? "not a git checkout" : `commit ${commit}`;
}

/** ` Estimate: … tokens …, uncalibrated.` — or nothing, for a counts-only plan. */
function estimateSentence(tokens: KritikPlanBand | null, usd: KritikPlanBand | null, calibrated: boolean): string {
  if (tokens === null) return "";
  const cost = usd === null ? "" : ` (${dollars(usd.low)}–${dollars(usd.high)})`;
  return ` Estimate: ${tokenCount(tokens.low)}–${tokenCount(tokens.high)} tokens${cost}${calibrated ? "" : ", uncalibrated"}.`;
}

function scopeSentence(cells: number, steps: number): string {
  return `${plural(cells, "cell")}, ${plural(steps, "checklist step")}`;
}

/** Steps `first` to `first + 2` of a part: the run sheet, the cells, the findings. */
function partSteps(part: PromptPart, first: number): string[] {
  const audit = `--audit ${part.auditId}`;
  return [
    `${first}. Get the run sheet: \`arkaik kritik signals --domain ${part.domain} --surface ${part.surface}\`. ${SIGNALS_EXIT}`,
    `${first + 1}. Score exactly these cells and no others:`,
    ...part.cells.map(
      (cell) =>
        `   - ${cell.criterion_id} on ${cell.surface}: \`arkaik kritik score ${cell.criterion_id} ${cell.surface} <level> --evidence "<file:line …>" ${audit}\``,
    ),
    `${first + 2}. Open every finding on this part's audit: \`arkaik kritik finding open <criterion> ${part.surface} ${FINDING_FLAGS} ${audit}\`. ` +
      `Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.`,
  ];
}

/** The prompt for one part, run in a session of its own. */
export function renderPartPrompt(plan: Pick<KritikPlan, "planId" | "commit">, part: Omit<KritikPlanPart, "prompt">): string {
  const estimate =
    part.estimate === null ? "" : estimateSentence(part.estimate.tokens, part.estimate.usd, part.estimate.calibrated);
  return [
    `Run part ${part.domain}:${part.surface} of Kritik plan ${plan.planId} in this repo (${where(plan.commit)}).`,
    `Scope: ${scopeSentence(part.cells.length, part.steps)}.${estimate}`,
    `Audit id for this part: ${part.auditId}`,
    "",
    `1. ${SKILL_STEP}`,
    ...partSteps(part, 2),
    "5. Do not record this part. The plan is recorded once, after every part is scored, with the plan's own command.",
    `6. Finish by printing ${USAGE_READOUT}`,
  ].join("\n");
}

/** The prompt for one session that runs every included part in order, then records the plan. */
export function renderPlanPrompt(
  plan: Omit<KritikPlan, "prompt" | "parts"> & { parts: readonly Omit<KritikPlanPart, "prompt">[] },
): string {
  const included = plan.parts.filter((part) => part.status === "included");
  const deferred = plan.parts.filter((part) => part.status === "deferred");
  const calibrated = included.every((part) => part.estimate?.calibrated === true);
  const lines = [
    `Run Kritik plan ${plan.planId} in this repo (${where(plan.commit)}): ${plural(included.length, "part")}, one after the other, in this session.`,
    `Scope: ${scopeSentence(plan.totals.cells, plan.totals.steps)}, of ${plan.totals.applicableCells} applicable cells.` +
      estimateSentence(plan.totals.tokens, plan.totals.usd, calibrated),
    "",
    `1. ${SKILL_STEP} Do not record a part on its own.`,
  ];
  let step = 2;
  for (const part of included) {
    lines.push(
      "",
      `Part ${part.domain}:${part.surface}, audit id ${part.auditId} (${scopeSentence(part.cells.length, part.steps)}):`,
      ...partSteps(part, step),
    );
    step += 3;
  }
  lines.push(
    "",
    `${step}. Check that every part is scored: \`arkaik kritik plan --status ${plan.planId}\``,
    `${step + 1}. Print ${USAGE_READOUT}`,
    `${step + 2}. When every part is scored, run \`${plan.recordCommand}\``,
  );
  if (deferred.length > 0) {
    lines.push(
      "",
      "Not in this run (over budget):",
      ...deferred.map((part) => `   - ${part.domain}:${part.surface} (${part.auditId}). Do not score it.`),
    );
  }
  return lines.join("\n");
}

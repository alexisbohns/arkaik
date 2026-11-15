/**
 * What one write from the weighing form says — the merge, kept pure so it can be
 * tested without a React runtime (tests/app/weighing-panel.test.js).
 *
 * **Why a merge, and why the form cannot just read the cell.** The form's `cell`
 * is the value the LAST render held. Two quick gestures — typing evidence then
 * clicking a confidence (the click blurs the textarea first), or clicking a level
 * then a confidence before the refetch lands — each build their write from the
 * same stale cell, and the second one carries the first one's fields as they were:
 * the typed text, or the new level, would be silently put back. So every row
 * remembers what it last said (`lastSent`: the level, confidence and evidence it
 * sent, or — on a row still blank — the confidence a person has picked and is
 * holding for the level that is yet to come), and a write is
 *
 *     what the cell says  <  what the row last said  <  what this gesture changes
 *
 * Imports nothing at runtime (the types are structural), so a test can load it
 * with `ts.transpileModule` and the `@/…` alias tables never see it.
 */

/** What the row said last: only the keys it has said. */
export interface RowIntent {
  level?: number;
  confidence?: number;
  /** `""` means "cleared" and beats a stored evidence. */
  evidence?: string;
}

/** The part of a resolved cell the merge reads (an `EffectiveCell` satisfies it). */
export interface CellLike {
  level: number;
  confidence: number;
  source: "stored" | "seed";
  scorer: { kind: string };
  evidence?: string;
}

/** What a write carries: the fields of one `weighing.assessment.recorded`. */
export interface AssessmentFields {
  level: number;
  confidence: number;
  /** Absent when blank — the planner refuses blank evidence. */
  evidence?: string;
}

/** Drop the keys a patch does not set, so `undefined` never overwrites a value. */
function defined(intent: RowIntent | undefined): RowIntent {
  const out: RowIntent = {};
  if (intent?.level !== undefined) out.level = intent.level;
  if (intent?.confidence !== undefined) out.confidence = intent.confidence;
  if (intent?.evidence !== undefined) out.evidence = intent.evidence;
  return out;
}

/**
 * What the row currently says, before this gesture: the cell's level (whoever
 * scored it — choosing records the person's own score at that level), the
 * person's OWN confidence and evidence (an agent's are not theirs to inherit),
 * then whatever the row last said over the top.
 */
export function currentIntent(cell: CellLike | undefined, lastSent: RowIntent | undefined): RowIntent {
  const mine = cell?.source === "stored" && cell.scorer.kind === "human" ? cell : undefined;
  return {
    ...(cell === undefined ? {} : { level: cell.level }),
    ...(mine === undefined ? {} : { confidence: mine.confidence }),
    ...(mine?.evidence === undefined ? {} : { evidence: mine.evidence }),
    ...defined(lastSent),
  };
}

/**
 * The write for one gesture, or `undefined` when there is nothing to write yet
 * (no level anywhere: a blank row is written only once a level is chosen).
 * Confidence defaults to 1 — "inferred from the promise's own text" — because
 * nobody picking a level on a form means anything stronger than "I guessed".
 */
export function assessmentFieldsFor(cell: CellLike | undefined, lastSent: RowIntent | undefined, patch: RowIntent): AssessmentFields | undefined {
  const merged = { ...currentIntent(cell, lastSent), ...defined(patch) };
  if (merged.level === undefined) return undefined;
  const evidence = merged.evidence;
  return {
    level: merged.level,
    confidence: merged.confidence ?? 1,
    ...(evidence !== undefined && evidence.trim() !== "" ? { evidence } : {}),
  };
}

/** What to remember as "last said" after a write: the fields, with a blank evidence kept as an explicit clear. */
export function intentOf(fields: AssessmentFields): RowIntent {
  return { level: fields.level, confidence: fields.confidence, evidence: fields.evidence ?? "" };
}

/** Whether the text in the evidence box differs from what the row already says — the test for a blur worth saving. */
export function evidenceChanged(cell: CellLike | undefined, lastSent: RowIntent | undefined, next: string): boolean {
  return next !== (currentIntent(cell, lastSent).evidence ?? "");
}

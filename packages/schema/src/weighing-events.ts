/**
 * The journal half of the weighing layer: the events that write assessments and
 * a positioning away from a checkout, the fold that reads them back, and the
 * one validator-gated planner every writer goes through.
 *
 * Where each home keeps an assessment:
 *
 * - **A repository** keeps sidecar files under `docs/weighing/`, canonical the
 *   way `journal.jsonl` is ({@link ./cli/weighing-files}). No event is written
 *   there — the file is the record and git is its history.
 * - **A hosted project and a browser project** keep `weighing.assessment.recorded`
 *   and `weighing.set.saved` events in the journal, and every read folds them
 *   over the stored section ({@link foldWeighingEvents}) — the same rule as
 *   Kritik's `quality.assessment.scored`.
 *
 * {@link planWeighingEvents} is the single gate: the hosted route, the local
 * provider and the MCP tools all ask it before anything is written, so a score
 * written by an agent and a score written by a person are the same write.
 * **The writer's kind is stamped by the caller, never read from the payload**:
 * the route knows a session from a token, the MCP server knows it is an agent.
 *
 * Unlike {@link ./weighing} this module imports `makeEvent`, and so zod. It is
 * not bundled into the standalone validator.
 */

import type { Node } from "./bundle";
import { makeEvent } from "./emit";
import type { JournalEvent } from "./journal";
import { acceptanceFingerprint } from "./weighing";
import {
  POSITIONING_SET_ID,
  VALUE_SET_ID,
  VALUE_MATRIX_ID,
  resolveWeighing,
  setOfRef,
  weighingScaleOf,
} from "./weighing-library";
import {
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  upsertWeighingAssessment,
  type WeighingAssessment,
  type WeighingConfidence,
  type WeighingCriteriaSet,
  type WeighingMatrix,
  type WeighingScorerKind,
  type WeighingSection,
} from "./weighing";

/** Read an unknown field as an array, never throwing on a hand-edited section. */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// --- Inputs ------------------------------------------------------------------

/** One caller-supplied write, after {@link parseWeighingEventInputs} has narrowed its shape. */
export type WeighingEventInput =
  | {
      type: typeof WEIGHING_ASSESSMENT_RECORDED;
      /** Defaults to the built-in `value` matrix. */
      matrix?: string;
      subject: string;
      criterion: string;
      level: number;
      confidence: number;
      evidence?: string;
      refs?: string[];
      run?: string;
      commit?: string;
      /** The model behind an agent scorer. */
      model?: string;
    }
  | { type: typeof WEIGHING_SET_SAVED; set: WeighingCriteriaSet };

const MAX_EVENTS = 50;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** D14, not yet run: an opaque id or handle: no whitespace, 128 characters at most, and not an email (a sidecar is committed to a repo). */
const isOpaqueId = (value: string): boolean => value.length > 0 && value.length <= 128 && !/\s/.test(value) && !/[^\s@]+@[^\s@]+/.test(value);

/**
 * Shape-validate a request body into a batch of {@link WeighingEventInput}.
 *
 * Purely structural — it never looks at the graph or the section, so it cannot
 * refuse an unknown subject (that is {@link planWeighingEvents}'s job). A legal
 * batch is an array; an error is `{ error }`. 1–50 entries. **`scorer`, `basis`
 * and `ts` are refused outright**: provenance is stamped by the writer and the
 * fingerprint is read off the graph, so a caller can claim neither.
 */
export function parseWeighingEventInputs(body: unknown): WeighingEventInput[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an events array" };
  }
  const { events } = body as { events?: unknown };
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must contain at least one entry" };
  if (events.length > MAX_EVENTS) return { error: `events must contain at most ${MAX_EVENTS} entries` };

  const parsed: WeighingEventInput[] = [];
  for (const [index, raw] of events.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `events[${index}] must be an object` };
    const entry = raw as Record<string, unknown>;

    if (entry.type === WEIGHING_ASSESSMENT_RECORDED) {
      for (const stamped of ["scorer", "basis", "ts"] as const) {
        if (stamped in entry) return { error: `events[${index}].${stamped} is stamped by the server — remove it` };
      }
      for (const field of ["subject", "criterion"] as const) {
        if (!isNonEmptyString(entry[field])) return { error: `events[${index}].${field} must be a non-empty string` };
      }
      if (typeof entry.level !== "number" || !Number.isInteger(entry.level)) return { error: `events[${index}].level must be an integer` };
      if (typeof entry.confidence !== "number" || !Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 3) {
        return { error: `events[${index}].confidence must be an integer 0-3` };
      }
      for (const field of ["matrix", "evidence", "run", "commit", "model"] as const) {
        if (entry[field] !== undefined && !isNonEmptyString(entry[field])) return { error: `events[${index}].${field} must be a non-empty string when present` };
      }
      if (entry.refs !== undefined && (!Array.isArray(entry.refs) || !entry.refs.every(isNonEmptyString))) {
        return { error: `events[${index}].refs must be an array of non-empty strings when present` };
      }
      parsed.push({
        type: WEIGHING_ASSESSMENT_RECORDED,
        subject: entry.subject as string,
        criterion: entry.criterion as string,
        level: entry.level,
        confidence: entry.confidence,
        ...(entry.matrix !== undefined ? { matrix: entry.matrix as string } : {}),
        ...(entry.evidence !== undefined ? { evidence: entry.evidence as string } : {}),
        ...(entry.refs !== undefined ? { refs: entry.refs as string[] } : {}),
        ...(entry.run !== undefined ? { run: entry.run as string } : {}),
        ...(entry.commit !== undefined ? { commit: entry.commit as string } : {}),
        ...(entry.model !== undefined ? { model: entry.model as string } : {}),
      });
      continue;
    }

    if (entry.type === WEIGHING_SET_SAVED) {
      const set = entry.set;
      if (typeof set !== "object" || set === null || Array.isArray(set)) return { error: `events[${index}].set must be an object` };
      const s = set as Record<string, unknown>;
      if (!isNonEmptyString(s.id) || !isNonEmptyString(s.version) || !isNonEmptyString(s.subject)) {
        return { error: `events[${index}].set needs a non-empty id, version and subject` };
      }
      // The scale is optional: a positioning without one uses its ruler's (weighingScaleOf).
      if (!Array.isArray(s.criteria)) {
        return { error: `events[${index}].set needs a criteria array` };
      }
      parsed.push({ type: WEIGHING_SET_SAVED, set: set as WeighingCriteriaSet });
      continue;
    }

    return { error: `events[${index}].type must be ${WEIGHING_ASSESSMENT_RECORDED} or ${WEIGHING_SET_SAVED}` };
  }
  return parsed;
}

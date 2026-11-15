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

// --- The planner -------------------------------------------------------------

export type WeighingRefusalReason =
  | "unknown_matrix"
  | "unknown_subject"
  | "unknown_criterion"
  | "retired_criterion"
  | "level_out_of_range"
  | "invalid_on_behalf_of" // D14, not yet run
  | "invalid_set";

/** Why one entry of a batch was refused. `index` is its position in the request's `events` array. */
export interface WeighingRefusal {
  index: number;
  reason: WeighingRefusalReason;
  detail: string;
}

export interface WeighingPlanContext {
  /** The envelope's `actor`: `arkaik-app`, `arkaik-agent`, `arkaik-mcp`. */
  actor: string;
  /** Stamped by the caller: a session is `human`, a token or the MCP server is `agent`. Never `rule`. */
  scorerKind: Exclude<WeighingScorerKind, "rule">;
  /**
   * Whom the scorer acts for, when the writer knows (D14, not yet run): the token
   * owner's user id on the hosted route, whatever the MCP server was told in a
   * repo. An opaque id or handle, never an email. Absent otherwise.
   */
  onBehalfOf?: string;
  /** Defaults to now. */
  now?: Date;
}

export type WeighingPlan =
  | {
      ok: true;
      /** Stamped, ready to append. Same order as the inputs. */
      events: JournalEvent[];
      /** The assessment rows the assessment events carry — what a sidecar writer upserts. */
      assessments: WeighingAssessment[];
    }
  | { ok: false; refusals: WeighingRefusal[] };

/**
 * Plan the journal events one batch of {@link WeighingEventInput}s would
 * produce, or refuse the whole batch.
 *
 * Checks every assessment against the resolved library the way `kritik_score`
 * checks a score against the pack: the matrix exists, the subject is a node the
 * matrix judges, the criterion is in the set and not retired, the level is on
 * the set's scale. Then it stamps what the caller must not: the scorer, the
 * set's full version and the subject's fingerprint (and, when the writer knows
 * it, whom the scorer acts for) — so staleness is measured
 * from what the server saw, never from what a client said it saw.
 *
 * **All-or-nothing**, like `persistMutation`: one refusal anywhere refuses
 * every entry, each naming its `index`, so a caller retrying a corrected batch
 * never reasons about a partial write.
 *
 * A saved set is held to the positioning's contract: id `positioning`, role
 * `positioning`, extending a set the library holds, naming only that set's
 * criteria, every weight above zero. Nothing else can be saved in slice 1.
 */
export function planWeighingEvents(
  section: WeighingSection | undefined,
  nodes: readonly Pick<Node, "id" | "species" | "title" | "metadata">[],
  inputs: readonly WeighingEventInput[],
  ctx: WeighingPlanContext,
): WeighingPlan {
  const resolved = resolveWeighing(section);
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const now = ctx.now ?? new Date();
  const refusals: WeighingRefusal[] = [];
  const events: JournalEvent[] = [];
  const assessments: WeighingAssessment[] = [];

  inputs.forEach((input, index) => {
    const refuse = (reason: WeighingRefusalReason, detail: string) => refusals.push({ index, reason, detail });

    if (input.type === WEIGHING_SET_SAVED) {
      const set = input.set;
      const ruler = typeof set.extends === "string" ? setOfRef(resolved, set.extends) : undefined;
      if (set.id !== POSITIONING_SET_ID || set.role !== "positioning") {
        return refuse("invalid_set", `only the positioning can be saved: id "${POSITIONING_SET_ID}" with role "positioning"`);
      }
      if (ruler === undefined) return refuse("invalid_set", `a positioning extends a set the library holds (e.g. ${VALUE_SET_ID}@1)`);
      const known = new Set(ruler.criteria.map((criterion) => criterion.id));
      for (const criterion of set.criteria) {
        if (!isNonEmptyString(criterion?.id) || !known.has(criterion.id)) {
          return refuse("invalid_set", `"${String(criterion?.id)}" is not an element of ${ruler.id}`);
        }
        if (criterion.weight !== undefined && (typeof criterion.weight !== "number" || !(criterion.weight > 0))) {
          return refuse("invalid_set", `the weight for "${criterion.id}" must be a number above 0 — leave the element out to leave it unpositioned`);
        }
      }
      if (set.status !== undefined && set.status !== "draft" && set.status !== "active") {
        return refuse("invalid_set", `status must be "draft" or "active"`);
      }
      events.push(makeEvent(WEIGHING_SET_SAVED, { set }, { actor: ctx.actor, ts: now }));
      return;
    }

    const matrix = resolved.matrices.find((candidate) => candidate.id === (input.matrix ?? VALUE_MATRIX_ID));
    if (matrix === undefined) {
      return refuse("unknown_matrix", `no matrix "${input.matrix ?? VALUE_MATRIX_ID}" (have: ${resolved.matrices.map((m) => m.id).join(", ")})`);
    }
    const set = setOfRef(resolved, matrix.set);
    if (set === undefined) return refuse("unknown_matrix", `matrix "${matrix.id}" names set "${matrix.set}", which is not available`);

    const node = byId.get(input.subject);
    const judged = matrix.subjects.kind === "query" ? node?.species === matrix.subjects.species : matrix.subjects.items.some((item) => (item?.node_id ?? item?.id) === input.subject);
    if (node === undefined || !judged) {
      return refuse("unknown_subject", `"${input.subject}" is not a subject of matrix "${matrix.id}"`);
    }

    const criterion = set.criteria.find((candidate) => candidate.id === input.criterion);
    if (criterion === undefined) return refuse("unknown_criterion", `"${input.criterion}" is not in set "${set.id}"`);
    if (typeof criterion.superseded_by === "string") {
      return refuse("retired_criterion", `"${criterion.id}" is retired — score "${criterion.superseded_by}" instead`);
    }
    const scale = weighingScaleOf(set, resolved);
    if (input.level < scale.min || input.level > scale.max) {
      return refuse("level_out_of_range", `level ${input.level} is outside ${scale.min}..${scale.max}`);
    }

    if (ctx.onBehalfOf !== undefined && !isOpaqueId(ctx.onBehalfOf)) {
      // D14, not yet run.
      return refuse("invalid_on_behalf_of", "on_behalf_of is an opaque user id or handle, never an email — sidecars are committed to repos");
    }

    const ts = now.toISOString();
    const row: WeighingAssessment = {
      matrix: matrix.id,
      subject: input.subject,
      criterion: criterion.id,
      level: input.level,
      scorer: {
        kind: ctx.scorerKind,
        id: ctx.actor,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(ctx.onBehalfOf !== undefined ? { on_behalf_of: ctx.onBehalfOf } : {}), // D14, not yet run
      },
      confidence: input.confidence as WeighingConfidence,
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      ...(input.refs !== undefined ? { refs: input.refs } : {}),
      basis: {
        fingerprint: acceptanceFingerprint(node),
        set_version: set.version,
        ...(input.commit !== undefined ? { commit: input.commit } : {}),
      },
      ...(input.run !== undefined ? { run: input.run } : {}),
      ts,
    };
    assessments.push(row);
    const { ts: _ts, ...payload } = row;
    void _ts;
    events.push(makeEvent(WEIGHING_ASSESSMENT_RECORDED, payload, { actor: ctx.actor, ts: now }));
  });

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, events, assessments };
}

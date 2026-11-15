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
  assessmentKey,
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

/** One caller-supplied write: what {@link parseWeighingEventInputs} hands on. The types are a promise; {@link planWeighingEvents} judges every value anyway. */
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

/**
 * What one writer may put in one journal row. Enforced by {@link planWeighingEvents},
 * so every writer shares them; the hosted route also caps the whole body.
 */
export const WEIGHING_WRITE_LIMITS = { evidenceChars: 2000, refs: 50, refChars: 200 } as const;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** D14: an opaque id or handle: no whitespace, 128 characters at most, and not an email (a sidecar is committed to a repo). */
const isOpaqueId = (value: string): boolean => value.length > 0 && value.length <= 128 && !/\s/.test(value) && !/[^\s@]+@[^\s@]+/.test(value);

/**
 * Shape a request body into a batch of {@link WeighingEventInput} — the HTTP
 * half of the gate, and only that.
 *
 * It checks what only an HTTP body can get wrong: the body is an object with an
 * `events` array of 1–50 entries, each an object of a known `type`, and **none
 * carries `scorer`, `basis` or `ts`** — provenance is stamped by the writer and
 * the fingerprint is read off the graph, so a caller can claim neither. It
 * copies only the fields an event may carry, so a stray key never reaches the
 * planner. It does **not** judge a value (a level, a confidence, an empty
 * subject, a set's shape): that is {@link planWeighingEvents}'s job, because the
 * browser provider and the MCP tools never see this parser and must be held to
 * the same rules. An error is `{ error }`.
 */
export function parseWeighingEventInputs(body: unknown): WeighingEventInput[] | { error: string } {
  if (!isObject(body)) return { error: "body must be an object with an events array" };
  const { events } = body as { events?: unknown };
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must contain at least one entry" };
  if (events.length > MAX_EVENTS) return { error: `events must contain at most ${MAX_EVENTS} entries` };

  const parsed: WeighingEventInput[] = [];
  for (const [index, raw] of events.entries()) {
    if (!isObject(raw)) return { error: `events[${index}] must be an object` };
    const entry = raw;

    if (entry.type === WEIGHING_ASSESSMENT_RECORDED) {
      for (const stamped of ["scorer", "basis", "ts"] as const) {
        if (stamped in entry) return { error: `events[${index}].${stamped} is stamped by the server — remove it` };
      }
      const known: Record<string, unknown> = {};
      for (const field of ["matrix", "subject", "criterion", "level", "confidence", "evidence", "refs", "run", "commit", "model"] as const) {
        if (entry[field] !== undefined) known[field] = entry[field];
      }
      parsed.push({ type: WEIGHING_ASSESSMENT_RECORDED, ...known } as WeighingEventInput);
      continue;
    }

    if (entry.type === WEIGHING_SET_SAVED) {
      if (!isObject(entry.set)) return { error: `events[${index}].set must be an object` };
      parsed.push({ type: WEIGHING_SET_SAVED, set: entry.set as WeighingCriteriaSet });
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
  | "invalid_entry" // structurally wrong: a type, a level that is not an integer, a confidence outside 0-3, an empty id, a cap exceeded
  | "invalid_on_behalf_of" // D14
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
   * Whom the scorer acts for, when the writer knows (D14): the token
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

/** The first structural problem with an assessment entry, or `undefined` when it is well-formed. Judges shape, never the graph. */
function assessmentProblem(entry: Record<string, unknown>): string | undefined {
  for (const field of ["subject", "criterion"] as const) {
    if (!isNonEmptyString(entry[field])) return `${field} must be a non-empty string`;
  }
  if (typeof entry.level !== "number" || !Number.isInteger(entry.level)) return "level must be an integer";
  if (typeof entry.confidence !== "number" || !Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 3) {
    return "confidence must be an integer 0-3";
  }
  for (const field of ["matrix", "run", "commit", "model"] as const) {
    if (entry[field] !== undefined && !isNonEmptyString(entry[field])) return `${field} must be a non-empty string when present`;
  }
  const { evidenceChars, refs, refChars } = WEIGHING_WRITE_LIMITS;
  if (entry.evidence !== undefined) {
    if (!isNonEmptyString(entry.evidence)) return "evidence must be a non-empty string when present";
    if (entry.evidence.length > evidenceChars) return `evidence must be at most ${evidenceChars} characters`;
  }
  if (entry.refs !== undefined) {
    if (!Array.isArray(entry.refs) || !entry.refs.every(isNonEmptyString)) return "refs must be an array of non-empty strings when present";
    if (entry.refs.length > refs) return `refs must hold at most ${refs} items`;
    if (entry.refs.some((ref: string) => ref.length > refChars)) return `each ref must be at most ${refChars} characters`;
  }
  return undefined;
}

/**
 * Plan the journal events one batch of {@link WeighingEventInput}s would
 * produce, or refuse the whole batch.
 *
 * **The one gate.** The hosted route, the browser provider and the MCP tools all
 * come through here, and only the route sees {@link parseWeighingEventInputs},
 * so every structural rule lives HERE: an entry must be an object of a known
 * type, a subject and a criterion non-empty strings, the level an integer, the
 * confidence an integer 0-3, the optional strings non-empty, `evidence` at most
 * {@link WEIGHING_WRITE_LIMITS}.evidenceChars characters and `refs` at most
 * `refs` items of `refChars` characters. A failure is a refusal, never a throw —
 * the types a caller compiled against are a promise nothing forces it to keep.
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

  inputs.forEach((entry: unknown, index) => {
    const refuse = (reason: WeighingRefusalReason, detail: string) => refusals.push({ index, reason, detail });

    if (!isObject(entry)) return refuse("invalid_entry", "an entry must be an object");

    if (entry.type === WEIGHING_SET_SAVED) {
      const set = entry.set as WeighingCriteriaSet;
      if (!isObject(set)) return refuse("invalid_set", "set must be an object");
      if (!isNonEmptyString(set.id) || !isNonEmptyString(set.version) || !isNonEmptyString(set.subject)) {
        return refuse("invalid_set", "a set needs a non-empty id, version and subject");
      }
      if (!Array.isArray(set.criteria)) return refuse("invalid_set", "a set needs a criteria array");
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
      try {
        events.push(makeEvent(WEIGHING_SET_SAVED, { set }, { actor: ctx.actor, ts: now }));
      } catch (error) {
        return refuse("invalid_set", error instanceof Error ? error.message : "the event failed its schema");
      }
      return;
    }

    if (entry.type !== WEIGHING_ASSESSMENT_RECORDED) {
      return refuse("invalid_entry", `type must be ${WEIGHING_ASSESSMENT_RECORDED} or ${WEIGHING_SET_SAVED}`);
    }
    const problem = assessmentProblem(entry);
    if (problem !== undefined) return refuse("invalid_entry", problem);
    const input = entry as Extract<WeighingEventInput, { type: typeof WEIGHING_ASSESSMENT_RECORDED }>;

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
      // D14.
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
        // The model is an agent's account of itself; a person has none to claim.
        ...(input.model !== undefined && ctx.scorerKind === "agent" ? { model: input.model } : {}),
        ...(ctx.onBehalfOf !== undefined ? { on_behalf_of: ctx.onBehalfOf } : {}), // D14
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
    const { ts: _ts, ...payload } = row;
    void _ts;
    try {
      events.push(makeEvent(WEIGHING_ASSESSMENT_RECORDED, payload, { actor: ctx.actor, ts: now }));
    } catch (error) {
      // The strict event schema is the last word; what it refuses is a refusal, not a crash.
      return refuse("invalid_entry", error instanceof Error ? error.message : "the event failed its schema");
    }
    assessments.push(row);
  });

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, events, assessments };
}

// --- The fold ----------------------------------------------------------------

/** A row's time for "latest wins": an unparseable or missing time is the oldest there is. */
function timeOf(ts: unknown): number {
  const time = typeof ts === "string" ? Date.parse(ts) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** The assessment an event carries, or `undefined` when it is not a well-formed one. */
function assessmentOfEvent(event: JournalEvent): WeighingAssessment | undefined {
  const e = event as Record<string, unknown>;
  const scorer = e.scorer as { kind?: unknown; id?: unknown } | undefined;
  if (
    typeof e.matrix !== "string" ||
    e.matrix === "" ||
    typeof e.subject !== "string" ||
    e.subject === "" ||
    typeof e.criterion !== "string" ||
    e.criterion === "" ||
    typeof e.level !== "number" ||
    !Number.isInteger(e.level) ||
    typeof e.confidence !== "number" ||
    typeof e.ts !== "string" ||
    e.ts === "" ||
    typeof scorer !== "object" ||
    scorer === null ||
    typeof scorer.kind !== "string" ||
    // A `rule` row is computed on read and never stored (D3): an event claiming to be one is skipped,
    // whoever appended it, so a seed can never be forged into a stored cell.
    scorer.kind === "rule" ||
    typeof scorer.id !== "string"
  ) {
    return undefined;
  }
  // The envelope's own keys are not part of the assessment; `ts` is both.
  const { id: _id, actor: _actor, type: _type, v: _v, ...rest } = e;
  void _id;
  void _actor;
  void _type;
  void _v;
  return rest as unknown as WeighingAssessment;
}

/**
 * Fold the weighing events of a journal over a stored section, latest-wins.
 *
 * Returns the SAME `section` reference when there is nothing to fold, so a
 * caller can tell "unchanged" with `===` — the identity check the hosted read
 * and the local provider both use to avoid copying a bundle for nothing. Unlike
 * the Kritik fold it will start a section from nothing: weighing needs no audit
 * restored first, so a project holding only events still folds.
 *
 * An assessment event replaces the stored row with the same
 * {@link assessmentKey} **only when it is at least as recent**: the two are
 * compared by their `ts` with `Date.parse`, an unparseable time counts as the
 * oldest there is, and on equal times the later event (the one folded last)
 * wins. So a section a restore stored AFTER an event was written is not undone
 * by replaying that event, and a clock-skewed event cannot overwrite a newer
 * row. A `rule`-scored event is skipped (a rule row is never stored). A set
 * event replaces the set with the same id by the same rule, measured against the
 * last event folded for that id (a stored set has no time of its own, so an event
 * replaces it). An event that is not shaped right is skipped, never thrown on — the journal is
 * append-only, and a bad line stays forever.
 */
export function foldWeighingEvents(
  section: WeighingSection | undefined,
  events: readonly JournalEvent[],
): WeighingSection | undefined {
  const relevant = events.filter((event) => event?.type === WEIGHING_ASSESSMENT_RECORDED || event?.type === WEIGHING_SET_SAVED);
  if (relevant.length === 0) return section;

  const assessments = [...asArray<WeighingAssessment>(section?.assessments)];
  /** The time of the last event folded into each set id; a set that came from the section has none. */
  const setTimes = new Map<string, number>();
  let sets = asArray<WeighingCriteriaSet>(section?.sets);

  for (const event of relevant) {
    if (event.type === WEIGHING_ASSESSMENT_RECORDED) {
      const row = assessmentOfEvent(event);
      if (row === undefined) continue;
      const key = assessmentKey(row);
      const at = assessments.findIndex((existing) => assessmentKey(existing) === key);
      if (at === -1) assessments.push(row);
      else if (timeOf(row.ts) >= timeOf(assessments[at]?.ts)) assessments[at] = row;
      continue;
    }
    const set = (event as { set?: unknown }).set;
    if (typeof set !== "object" || set === null || Array.isArray(set)) continue;
    const id = (set as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    const at = sets.findIndex((existing) => existing?.id === id);
    const time = timeOf(event.ts);
    if (at === -1) {
      sets = [...sets, set as WeighingCriteriaSet];
      setTimes.set(id, time);
    } else {
      // A stored set carries no time, so one this fold has not replaced yet loses to any event;
      // after that the last folded event's time is the one to beat (ties go to the later event).
      const known = setTimes.get(id);
      if (known !== undefined && time < known) continue;
      sets = sets.map((existing, i) => (i === at ? (set as WeighingCriteriaSet) : existing));
      setTimes.set(id, time);
    }
  }

  return { ...(section ?? {}), sets, matrices: asArray<WeighingMatrix>(section?.matrices), assessments };
}

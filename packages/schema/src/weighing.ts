/**
 * Weighing — the layer that gives a promise a weight (docs/rfcs/weighing.md).
 *
 * Counting says how many promises claim a value; weighing says how much each
 * one carries, according to whom, and how sure. A project pins a versioned
 * **criteria set** (the 30 elements of value are the first), declares a
 * **matrix** (which subjects are judged against which set) and records
 * **assessments** — one signed level per (subject × criterion), with who judged
 * (`scorer`), how sure (`confidence`) and what the judge was looking at
 * (`basis`). Everything downstream — served, cost, kept share, element masses,
 * the claim-versus-assessment flags — is derived in {@link ./weighing-derive}
 * and never stored, exactly as Kritik's severity and grades are.
 *
 * This is Kritik's section shape one for one (`bundle.weighing` beside
 * `bundle.quality`, {@link ./quality}), with three differences that are the
 * point of it: the scale is signed (−3..+3, so a promise can cost a value as
 * well as serve it), every cell carries its scorer and confidence, and a
 * staleness check reads a fingerprint of the subject rather than a commit.
 *
 * Same doctrine as {@link ./quality}: pure functions, immutable, deliberately
 * **zod-free** (type-only imports plus plain constants) so the module stays
 * browser-safe and adds nothing to the standalone validator bundle. The zod
 * shapes live next door in {@link ./weighing-schemas}.
 *
 * Everything here is lenient and total. A set that left the section, a level
 * outside the scale, a stray scorer — none of them throw; they degrade to a
 * blank cell and a `validateBundle()` warning, because a hand-edited weighing
 * section must never fail an import or a CI gate. That includes the zod
 * shapes: they are looser than Kritik's on purpose (a section is filled at
 * scale by agents and scorers, so one bad cell must not block importing the
 * project), and the validator owns every judgement about a value.
 *
 * **Types and storage.** The record types below describe a record that has
 * passed its shape guard (`isWeighingSetShape`, `isWeighingMatrixShape`,
 * `isWeighingAssessmentShape`), plus the few things a stored record may
 * legitimately lack: an assessment's `scorer`, a positioning's `scale`. What
 * comes out of storage is not that — the zod shapes accept any value in any
 * leaf — so a reader goes through `resolveWeighing` (sets and matrices) and
 * `readWeighingAssessments` (rows), which hand back only records that pass
 * their guard. Only the containers are strict: the section is an object and
 * each of its lists is an array.
 */

import type { Node } from "./bundle";

// --- Scales ------------------------------------------------------------------

/** The signed value scale: −3 costs it at its core … +3 is core. 0 is "unrelated". */
export type WeighingLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export const WEIGHING_LEVELS: readonly WeighingLevel[] = [-3, -2, -1, 0, 1, 2, 3];

export const WEIGHING_MIN_LEVEL = -3;
export const WEIGHING_MAX_LEVEL = 3;

/** How sure the scorer is. 0 is a guess; a seeding rule always scores 0. */
export type WeighingConfidence = 0 | 1 | 2 | 3;

export const CONFIDENCE_LEVELS: readonly WeighingConfidence[] = [0, 1, 2, 3];

/** What each confidence level means, in words — the anchors a form and a prompt both show. */
export const CONFIDENCE_ANCHORS: Readonly<Record<WeighingConfidence, string>> = {
  0: "Guess. Nothing behind it.",
  1: "Inferred from the subject's own text.",
  2: "Evidenced: cites something outside the subject.",
  3: "Verified: reviewed by a human, measured, or survived a second scorer trying to refute it.",
};

/**
 * Who judged. The order is the authority order, strongest first: a human's level
 * beats an agent's, which beats a rule's. A `rule` is a seeding rule — it is
 * computed on read and never stored.
 */
export type WeighingScorerKind = "human" | "agent" | "rule";

export const SCORER_KINDS: readonly WeighingScorerKind[] = ["human", "agent", "rule"];

/** The kinds a stored assessment may carry — `rule` seeds are derived, never written. */
export const STORED_SCORER_KINDS: readonly WeighingScorerKind[] = ["human", "agent"];

/** 3 human, 2 agent, 1 rule — higher wins a cell. */
export function scorerRank(kind: string | undefined): number {
  const index = SCORER_KINDS.indexOf(kind as WeighingScorerKind);
  // A kind nobody defined (a hand-edited sidecar) ranks below a rule, so it can never win a cell.
  return index === -1 ? 0 : SCORER_KINDS.length - index;
}

export interface WeighingScorer extends Record<string, unknown> {
  kind: WeighingScorerKind;
  /** Who: a person's handle, an agent's name, or the seeding rule's id. */
  id: string;
  /** The model behind an agent, when it says. */
  model?: string;
  /**
   * Whom the scorer acts for, when the writer knows: an opaque user id, a
   * handle or a display name (a git author name), NEVER an email (sidecars are
   * committed to repos). Stamped by the writer, never sent by a caller.
   */
  on_behalf_of?: string;
}

// --- Criteria sets -----------------------------------------------------------

export interface WeighingScale extends Record<string, unknown> {
  min: number;
  max: number;
  /** Every level described in words, keyed by the level as a string (`"-3"` … `"3"`). */
  anchors: Record<string, string>;
}

export interface WeighingGroup extends Record<string, unknown> {
  id: string;
  title: string;
}

export interface WeighingCriterion extends Record<string, unknown> {
  /** Stable. For the value set this is a `ValueId`. Never redefined — retired via `superseded_by`. */
  id: string;
  /** A {@link WeighingGroup.id} — for the value set, the tier. */
  group?: string;
  name?: string;
  question?: string;
  definition?: string;
  /** This criterion's own wording of each level, in the product's words on a positioning. */
  anchors?: Record<string, string>;
  /** On a positioning: how much the product stands on it. Absent means 1. */
  weight?: number;
  superseded_by?: string;
}

export type WeighingCriteriaSetStatus = "draft" | "active";

export interface WeighingCriteriaSet extends Record<string, unknown> {
  id: string;
  /** Semver. Levels are comparable only within a major. */
  version: string;
  title?: string;
  /** What the set judges. Slice 1 uses `acceptance`; the rest is reserved. */
  subject?: string;
  /** Absent on a positioning, which then uses its `extends` ruler's scale ({@link weighingScaleOf}). */
  scale?: WeighingScale;
  groups?: WeighingGroup[];
  criteria: WeighingCriterion[];
  /** `positioning` marks the set a project writes about itself; it re-weights `extends`. */
  role?: string;
  /**
   * Absent or `"active"` is active; anything else — `"draft"`, or a mistyped
   * value — is a draft, which feeds no roll-up until someone activates it
   * ({@link isActiveWeighingSet}).
   */
  status?: string;
  /** A positioning's ruler: `value-contribution@1`. */
  extends?: string;
}

// --- Matrices ----------------------------------------------------------------

export type WeighingMatrixSubjects =
  | { kind: "query"; species: string }
  | { kind: "list"; items: { id: string; title?: string; node_id?: string }[] };

export interface WeighingMatrix extends Record<string, unknown> {
  id: string;
  title?: string;
  /** `value-contribution@1` — the set's id and major. */
  set: string;
  subjects: WeighingMatrixSubjects;
  /** The id of the positioning set that re-weights this matrix, when one exists. */
  positioning?: string;
  context?: { node_id: string };
  /** Same reading as {@link WeighingCriteriaSet.status}. */
  status?: string;
}

// --- Assessments -------------------------------------------------------------

/** What a scorer was looking at, so a re-read can tell the score went stale. */
export interface WeighingAssessmentBasis extends Record<string, unknown> {
  /** A hash of the subject's judged fields ({@link acceptanceFingerprint}). */
  fingerprint?: string;
  commit?: string;
  /** The full version of the set the level was read against. */
  set_version: string;
}

/** One (matrix × subject × criterion) judgement. */
export interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;
  /** A node id for the value matrix. */
  subject: string;
  /** A {@link WeighingCriterion.id}. */
  criterion: string;
  /** A whole number on the set's scale. No half points. 0 means "unrelated". */
  level: number;
  /** Absent on a hand-edited row: it is then read as unscored (the validator warns) and can win no cell. */
  scorer?: WeighingScorer;
  confidence: WeighingConfidence;
  /** Markdown. */
  evidence?: string;
  /** Ids cited: nodes, journal events, findings. */
  refs?: string[];
  basis?: WeighingAssessmentBasis;
  /** The audit or plan the score belongs to. */
  run?: string;
  /** ISO 8601. */
  ts: string;
}

/**
 * The project-owned weighing state — a top-level bundle section, like
 * `quality`. The built-in set and matrix are library content and are not
 * stored here; `sets` holds the project's own (its positioning, today).
 */
export interface WeighingSection extends Record<string, unknown> {
  /** Each list may be absent in storage; a reader treats it as empty. */
  sets?: WeighingCriteriaSet[];
  matrices?: WeighingMatrix[];
  /** Latest per (matrix × subject × criterion × scorer kind); history lives in the journal. */
  assessments?: WeighingAssessment[];
}

// --- Journal event types -----------------------------------------------------

/** One assessment recorded away from a checkout (a hosted session, a browser project). */
export const WEIGHING_ASSESSMENT_RECORDED = "weighing.assessment.recorded";
/** A criteria set saved whole — how a positioning is written away from a checkout. */
export const WEIGHING_SET_SAVED = "weighing.set.saved";

/** The event types {@link ./weighing-events}'s fold reads into the section on the way out. */
export const WEIGHING_FOLD_TYPES = [WEIGHING_ASSESSMENT_RECORDED, WEIGHING_SET_SAVED] as const;

// --- Keys and versions -------------------------------------------------------

/** The cell an assessment is about. */
export function cellKey(matrix: string, subject: string, criterion: string): string {
  return `${matrix}\u0000${subject}\u0000${criterion}`;
}

/**
 * One stored row per cell per scorer kind — a human's level and an agent's sit
 * side by side. Total: a hand-edited row with no scorer, or a key that is not a
 * string, still gets a key (it never matches a well-formed row's), so keying
 * cannot throw on it. Readers skip such rows with {@link isWeighingAssessmentShape}.
 */
export function assessmentKey(a: Pick<WeighingAssessment, "matrix" | "subject" | "criterion" | "scorer">): string {
  const kind = typeof a?.scorer?.kind === "string" ? a.scorer.kind : "";
  return `${cellKey(String(a?.matrix), String(a?.subject), String(a?.criterion))}\u0000${kind}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A row a reader can address: an object whose `matrix`, `subject` and
 * `criterion` are strings. A row that is not (a `null`, a number, a row with no
 * criterion) is skipped by every reader and warned about by the validator
 * (`weighing-assessment-shape`) — it never blocks an import.
 */
export function isWeighingAssessmentShape(row: unknown): row is WeighingAssessment {
  return isRecord(row) && typeof row.matrix === "string" && typeof row.subject === "string" && typeof row.criterion === "string";
}

/** The rows of a section a reader can address, in stored order. A missing list or a garbage row yields nothing. */
export function readWeighingAssessments(section: Partial<Pick<WeighingSection, "assessments">> | null | undefined): WeighingAssessment[] {
  return Array.isArray(section?.assessments) ? section.assessments.filter(isWeighingAssessmentShape) : [];
}

/**
 * Is a set (or matrix) active? Absent means active and `"active"` means active;
 * ANY other present value — `"draft"`, `"Draft"`, a typo, a non-string — counts
 * as a draft, so a mistyped status can never let a draft feed a roll-up. The
 * validator warns on anything but the two spellings (`weighing-set-status`).
 */
export function isActiveWeighingSet(set: { status?: unknown } | null | undefined): boolean {
  const status = set?.status;
  return status === undefined || status === "active";
}

/** `value-contribution@1` → `{ id: "value-contribution", major: "1" }`. A ref with no `@` has no major. */
export function splitSetRef(ref: string): { id: string; major: string | undefined } {
  const at = ref.lastIndexOf("@");
  if (at === -1) return { id: ref, major: undefined };
  return { id: ref.slice(0, at), major: ref.slice(at + 1) };
}

/** The major of a semver string, as a string; `undefined` for anything that does not start with digits. */
export function majorOf(version: string): string | undefined {
  const match = /^(\d+)(?:\.|$)/.exec(version);
  return match ? match[1] : undefined;
}

// --- Fingerprints ------------------------------------------------------------

/**
 * A 53-bit string hash (cyrb53). Not cryptographic and not meant to be: it
 * only has to tell "the text this scorer read" from "the text now", in a
 * browser, in Node and in the plugin scripts alike, with no dependency.
 */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * The fingerprint of an acceptance: its title, its Gherkin and its values, in
 * that order, whitespace-normalized. **Not its status** — delivery is a fact
 * joined at read time, not something the scorer judged — and not its
 * platforms, for the same reason. Values keep their order because the order is
 * what the seeding rule reads.
 */
export function acceptanceFingerprint(node: Pick<Node, "title" | "metadata">): string {
  const gherkin = typeof node.metadata?.gherkin === "string" ? node.metadata.gherkin : "";
  const values = Array.isArray(node.metadata?.values) ? node.metadata.values : [];
  const text = JSON.stringify([squash(node.title ?? ""), squash(gherkin), values]);
  return `fp1-${hash53(text).toString(16).padStart(14, "0")}`;
}

// --- Writing assessments -----------------------------------------------------

/**
 * Record one assessment, latest-per-cell-per-scorer-kind: a second row for the
 * same key REPLACES in place, keeping its position, so a re-score reads as a
 * correction. The replaced row comes back so the caller can say so.
 */
export function upsertWeighingAssessment(
  assessments: readonly WeighingAssessment[],
  next: WeighingAssessment,
): { assessments: WeighingAssessment[]; replaced?: WeighingAssessment } {
  const key = assessmentKey(next);
  const index = assessments.findIndex((candidate) => assessmentKey(candidate) === key);
  if (index === -1) return { assessments: [...assessments, next] };
  const updated = [...assessments];
  const replaced = updated[index];
  updated[index] = next;
  return { assessments: updated, replaced };
}

/** A stable order for a sidecar file, so two writers diff cleanly: matrix, subject, criterion, then authority. */
export function sortWeighingAssessments(assessments: readonly WeighingAssessment[]): WeighingAssessment[] {
  return [...assessments].sort((a, b) => {
    // A key that is not a string sorts last, so a malformed row stays in the file but out of the way.
    const text = (x: unknown) => (typeof x === "string" ? x : "\uffff");
    const by = (x: unknown, y: unknown) => (text(x) < text(y) ? -1 : text(x) > text(y) ? 1 : 0);
    return (
      by(a?.matrix, b?.matrix) ||
      by(a?.subject, b?.subject) ||
      by(a?.criterion, b?.criterion) ||
      scorerRank(b?.scorer?.kind) - scorerRank(a?.scorer?.kind)
    );
  });
}

/**
 * The weighing projections — everything a matrix says that is not stored.
 *
 * Stored: assessments. Computed, every time, from those and from the graph:
 * the level a cell reads at, how much a promise serves and costs, how much of
 * it is kept, what each element is promised and kept, which claims the
 * assessments do not support, and how much of every number rests on a guess.
 * A computed number cannot go stale and cannot disagree with its inputs — the
 * rule `deriveQualityMatrix` already follows for Kritik's severity and grades.
 *
 * **Served and cost are never netted.** A promise that serves "reduces
 * anxiety" at +3 and costs it at −2 reads "serves 1.0 · costs 0.67", never
 * "0.33": netting hides the trade-off the matrix exists to show.
 *
 * **Seeds are computed, not stored.** A claimed value with no assessment reads
 * at a level seeded from the *order* of `metadata.values` (first +3, second +2,
 * the rest +1), scorer `rule`, confidence 0. Negatives are never seeded.
 *
 * Same doctrine as {@link ./quality}: pure, immutable, zod-free and fs-free,
 * minimal `Pick<>` inputs, lenient and total — a level outside the scale, an
 * element the set dropped, a node with no platforms degrade to a blank cell or
 * a `null`, never a throw.
 */

import { DEFAULT_DELIVERED_STATUSES, resolvePlatformStatus } from "./acceptance";
import type { Node } from "./bundle";
import {
  acceptanceFingerprint,
  cellKey,
  isActiveWeighingSet,
  majorOf,
  readWeighingAssessments,
  type WeighingAssessment,
  type WeighingConfidence,
  type WeighingCriteriaSet,
  type WeighingMatrix,
  type WeighingScorer,
  type WeighingSection,
} from "./weighing";
import { VALUE_MATRIX_ID, resolveWeighing, setOfRef } from "./weighing-library";

/** The seeding rule's scorer id — what a `rule` cell reads as. */
export const SEED_SCORER_ID = "seed-by-claim-order";

/** The scorer every seed carries. */
const SEED_SCORER: WeighingScorer = { kind: "rule", id: SEED_SCORER_ID };

/** A seed has no time. */
export const SEED_TS = "1970-01-01T00:00:00.000Z";

/** A judged node: only the fields the projections read. */
export type WeighedNode = Pick<Node, "id" | "title" | "species" | "status" | "platforms" | "metadata">;

// --- Seeding -----------------------------------------------------------------

/** First claimed value +3, second +2, every other +1. Positive only — a rule never invents a cost. */
export function seedLevelAt(position: number): number {
  return position === 0 ? 3 : position === 1 ? 2 : 1;
}

/** The claimed values of a node that the set knows, deduplicated, in claim order. */
export function claimedElements(node: Pick<Node, "metadata">, set: Pick<WeighingCriteriaSet, "criteria">): string[] {
  // `resolveWeighing` hands back sets whose criteria are all objects with string ids; read a set from there.
  const known = new Set(set.criteria.map((criterion) => criterion.id));
  const claimed = Array.isArray(node.metadata?.values) ? node.metadata.values : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of claimed) {
    if (typeof value !== "string" || !known.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** The seeded assessments of a node, one per claimed element. Computed on read, never stored. */
export function seedAssessments(node: WeighedNode, matrix: Pick<WeighingMatrix, "id">, set: WeighingCriteriaSet): WeighingAssessment[] {
  const fingerprint = acceptanceFingerprint(node);
  return claimedElements(node, set).map((criterion, position) => ({
    matrix: matrix.id,
    subject: node.id,
    criterion,
    level: seedLevelAt(position),
    scorer: SEED_SCORER,
    confidence: 0,
    basis: { fingerprint, set_version: set.version },
    ts: SEED_TS,
  }));
}

// --- One cell ----------------------------------------------------------------

/** What a cell reads as, and why. */
export interface EffectiveCell {
  criterion: string;
  /** The winning level. */
  level: number;
  scorer: WeighingScorer;
  confidence: WeighingConfidence;
  /** `seed` means no scorer has judged this cell — the level is the rule's guess. */
  source: "stored" | "seed";
  /** The subject or the set moved since the winner looked. Never changes who wins. */
  stale: boolean;
  evidence?: string;
  /** The author claimed this element in `metadata.values`. */
  claimed: boolean;
  /** Stored rows of the other kinds — the fresh agent level beside a stale human one. */
  others: WeighingAssessment[];
  /** A human and an agent differ by two levels or more. */
  review: boolean;
}

/** A row's time as text, `""` when it has none (the validator warns), so a row with no ts is the oldest. */
const tsOf = (row: WeighingAssessment): string => (typeof row.ts === "string" ? row.ts : "");

/** The latest row of a kind: greatest `ts`, a tie going to the later row. */
function latestOf(rows: readonly WeighingAssessment[]): WeighingAssessment | undefined {
  let best: WeighingAssessment | undefined;
  for (const row of rows) {
    if (best === undefined || tsOf(row) >= tsOf(best)) best = row;
  }
  return best;
}

/**
 * The level one cell reads at.
 *
 * A human beats an agent beats a rule, and the latest wins within a kind.
 * **Staleness never changes the winner** — a stale human level still shows,
 * flagged, with the fresh agent level beside it in `others`; an agent never
 * replaces a human. A stored `rule` row is ignored: seeds are computed, so one
 * on disk is a hand edit, and the validator warns about it.
 */
export function resolveCell(
  criterion: string,
  stored: readonly WeighingAssessment[],
  seed: WeighingAssessment | undefined,
  current: { fingerprint: string; setVersion: string },
  claimed: boolean,
): EffectiveCell | undefined {
  const human = latestOf(stored.filter((row) => row.scorer?.kind === "human"));
  const agent = latestOf(stored.filter((row) => row.scorer?.kind === "agent"));
  const winner = human ?? agent;

  if (winner === undefined) {
    if (seed === undefined) return undefined;
    return {
      criterion,
      level: seed.level,
      scorer: seed.scorer ?? SEED_SCORER,
      confidence: 0,
      source: "seed",
      stale: false,
      claimed,
      others: [],
      review: false,
    };
  }

  const basis = winner.basis;
  const stale =
    (basis?.fingerprint !== undefined && basis.fingerprint !== current.fingerprint) ||
    (basis?.set_version !== undefined && majorOf(basis.set_version) !== majorOf(current.setVersion));
  const other = winner === human ? agent : undefined;
  return {
    criterion,
    level: winner.level,
    // The winner was picked by `scorer?.kind`, so it has a scorer.
    scorer: winner.scorer as WeighingScorer,
    confidence: winner.confidence,
    source: "stored",
    stale,
    ...(winner.evidence !== undefined ? { evidence: winner.evidence } : {}),
    claimed,
    others: other === undefined ? [] : [other],
    review: human !== undefined && agent !== undefined && Math.abs(human.level - agent.level) >= 2,
  };
}

// --- The context -------------------------------------------------------------

/** The matrix, its set, the stored cells and the active positioning, resolved once. */
export interface WeighingContext {
  matrix: WeighingMatrix;
  set: WeighingCriteriaSet;
  /** Stored non-rule rows by {@link cellKey}. */
  byCell: Map<string, WeighingAssessment[]>;
  /** The project's positioning set, active or not. */
  positioningSet: WeighingCriteriaSet | undefined;
  /** Present only while the positioning is active; a draft feeds no roll-up. */
  positioning: { set: WeighingCriteriaSet; weights: Map<string, number> } | null;
}

/** Resolve a matrix over a section — `undefined` when the matrix or its set is not available. */
export function buildWeighingContext(
  section: Partial<Pick<WeighingSection, "sets" | "matrices" | "assessments">> | null | undefined,
  matrixId: string = VALUE_MATRIX_ID,
): WeighingContext | undefined {
  const resolved = resolveWeighing(section);
  const matrix = resolved.matrices.find((candidate) => candidate.id === matrixId);
  if (matrix === undefined) return undefined;
  const set = setOfRef(resolved, matrix.set);
  if (set === undefined) return undefined;

  const byCell = new Map<string, WeighingAssessment[]>();
  // Rows a reader cannot address (no string matrix/subject/criterion) are skipped, and so is a
  // row whose level is not a finite number — the validator warns about both.
  for (const row of readWeighingAssessments(section)) {
    if (row.matrix !== matrix.id || row.scorer?.kind === "rule" || typeof row.level !== "number" || !Number.isFinite(row.level)) continue;
    const key = cellKey(row.matrix, row.subject, row.criterion);
    const rows = byCell.get(key);
    if (rows === undefined) byCell.set(key, [row]);
    else rows.push(row);
  }

  const positioningSet = matrix.positioning === undefined ? undefined : resolved.sets.find((candidate) => candidate.id === matrix.positioning);
  const positioning =
    positioningSet === undefined || !isActiveWeighingSet(positioningSet)
      ? null
      : {
          set: positioningSet,
          weights: new Map(positioningSet.criteria.map((criterion) => [criterion.id, typeof criterion.weight === "number" && criterion.weight > 0 ? criterion.weight : 1] as const)),
        };
  return { matrix, set, byCell, positioningSet, positioning };
}

// --- One promise -------------------------------------------------------------

export interface PromiseWeighing {
  node_id: string;
  title: string;
  status: string;
  /** An archived promise is weighed but counts toward no element's mass. */
  archived: boolean;
  fingerprint: string;
  /** Every non-blank cell: the claimed elements first, in claim order, then the rest in set order. */
  cells: EffectiveCell[];
  /** Σ of positive levels ÷ 3. */
  served: number;
  /** Σ of |negative levels| ÷ 3. Never netted against `served`. */
  cost: number;
  /** The same sums over the positioned elements only, each times its weight. `null` without an active positioning. */
  positioned: { served: number; cost: number } | null;
  /** Platforms where the promise is live ÷ platforms it applies to; `null` when it applies to none. */
  kept_share: number | null;
  /** The share (0–1) of `served` and of `cost` that rests on confidence-0 cells. */
  guesswork: { served: number; cost: number };
  flags: {
    /** Claimed, and the stored level is 1 or less: the claim is stronger than the promise. */
    claim_not_supported: string[];
    /** Not claimed, and the stored level is 1 or more: the promise does more than it says. */
    unclaimed_value: string[];
    /** Any stored negative level — authors claim intent, so a cost is never claimed. */
    unclaimed_cost: string[];
  };
  /** Elements whose winning level was scored against a subject or set that has since moved. */
  stale: string[];
  /** Elements where a human and an agent differ by two levels or more. */
  review: string[];
}

/** Live platforms ÷ applicable platforms, read through the same resolution `getNodePlatformStatuses` uses. */
export function keptShare(node: Pick<Node, "status" | "platforms" | "metadata">): number | null {
  if (!Array.isArray(node.platforms) || node.platforms.length === 0) return null;
  const live = node.platforms.filter((platform) => {
    const status = resolvePlatformStatus(node, platform);
    return status !== undefined && DEFAULT_DELIVERED_STATUSES.includes(status);
  }).length;
  return live / node.platforms.length;
}

/** Weigh one promise against a resolved context. */
export function weighPromise(node: WeighedNode, ctx: WeighingContext): PromiseWeighing {
  const fingerprint = acceptanceFingerprint(node);
  const current = { fingerprint, setVersion: ctx.set.version };
  const claimedList = claimedElements(node, ctx.set);
  const claimedSet = new Set(claimedList);
  const seeds = new Map(seedAssessments(node, ctx.matrix, ctx.set).map((seed) => [seed.criterion, seed] as const));

  const order = [...claimedList, ...ctx.set.criteria.map((criterion) => criterion.id).filter((id) => !claimedSet.has(id))];
  const cells: EffectiveCell[] = [];
  for (const criterion of order) {
    const stored = ctx.byCell.get(cellKey(ctx.matrix.id, node.id, criterion)) ?? [];
    const cell = resolveCell(criterion, stored, seeds.get(criterion), current, claimedSet.has(criterion));
    if (cell !== undefined) cells.push(cell);
  }

  let served = 0;
  let cost = 0;
  let servedGuess = 0;
  let costGuess = 0;
  let positionedServed = 0;
  let positionedCost = 0;
  const flags: PromiseWeighing["flags"] = { claim_not_supported: [], unclaimed_value: [], unclaimed_cost: [] };
  const stale: string[] = [];
  const review: string[] = [];

  for (const cell of cells) {
    const weight = ctx.positioning?.weights.get(cell.criterion);
    if (cell.level > 0) {
      const mass = cell.level / 3;
      served += mass;
      if (cell.confidence === 0) servedGuess += mass;
      if (weight !== undefined) positionedServed += mass * weight;
    } else if (cell.level < 0) {
      const mass = -cell.level / 3;
      cost += mass;
      if (cell.confidence === 0) costGuess += mass;
      if (weight !== undefined) positionedCost += mass * weight;
    }
    if (cell.stale) stale.push(cell.criterion);
    if (cell.review) review.push(cell.criterion);
    if (cell.source === "stored") {
      if (cell.claimed && cell.level <= 1) flags.claim_not_supported.push(cell.criterion);
      if (!cell.claimed && cell.level >= 1) flags.unclaimed_value.push(cell.criterion);
      if (cell.level < 0) flags.unclaimed_cost.push(cell.criterion);
    }
  }

  return {
    node_id: node.id,
    title: node.title,
    status: node.status,
    archived: node.status === "archived",
    fingerprint,
    cells,
    served,
    cost,
    positioned: ctx.positioning === null ? null : { served: positionedServed, cost: positionedCost },
    kept_share: keptShare(node),
    guesswork: { served: served > 0 ? servedGuess / served : 0, cost: cost > 0 ? costGuess / cost : 0 },
    flags,
    stale,
    review,
  };
}

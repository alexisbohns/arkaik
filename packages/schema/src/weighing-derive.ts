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
 * **Every number says how much of it is guesswork** (RFC § 12): alongside each
 * share or mass, the part of it that rests on confidence-0 cells. A confidence
 * that is not one of {@link CONFIDENCE_LEVELS} reads as 0 — an unknown
 * confidence is a guess, so a guesswork share is never understated.
 *
 * **Exact, not rounded.** Sums are taken over whole levels and divided by 3
 * once, so no float drift accumulates; the figures themselves are returned
 * unrounded so a test (or a caller summing them) can rely on them. Rounding is
 * a display concern and belongs to the surface (the MCP tool and the panel
 * round at their edge).
 *
 * Same doctrine as {@link ./quality}: pure, immutable, zod-free and fs-free,
 * minimal `Pick<>` inputs, lenient and total — a level outside the scale, an
 * element the set dropped, a node with no platforms degrade to a blank cell or
 * a `null`, never a throw. Nothing here mutates its inputs; `others` on a cell
 * and `positioning.set` on a view are REFERENCES into them, not copies.
 */

import { DEFAULT_DELIVERED_STATUSES, resolvePlatformStatus } from "./acceptance";
import type { Node } from "./bundle";
import {
  CONFIDENCE_LEVELS,
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
import { VALUE_MATRIX_ID, resolveWeighing, setOfRef, weighingScaleOf } from "./weighing-library";

/** The seeding rule's scorer id — what a `rule` cell reads as. */
export const SEED_SCORER_ID = "seed-by-claim-order";

/** The scorer every seed carries. Frozen: every seed (and every cell reading one) shares it. */
const SEED_SCORER: WeighingScorer = Object.freeze({ kind: "rule", id: SEED_SCORER_ID });

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
  /** 0 when the stored one is not a known confidence: unknown is a guess. */
  confidence: WeighingConfidence;
  /** `seed` means no scorer has judged this cell — the level is the rule's guess. */
  source: "stored" | "seed";
  /** The subject or the set moved since the winner looked. Never changes who wins. */
  stale: boolean;
  /** Only when the stored evidence is a string. */
  evidence?: string;
  /** The author claimed this element in `metadata.values`. */
  claimed: boolean;
  /** Stored rows of the other kinds — the fresh agent level beside a stale human one. References to the stored rows, not copies. */
  others: WeighingAssessment[];
  /** A human and an agent differ by two levels or more. */
  review: boolean;
}

/** A row's time in ms. A missing or unparseable `ts` (the validator warns) is the oldest possible. */
const tsOf = (row: WeighingAssessment): number => {
  const ms = typeof row.ts === "string" ? Date.parse(row.ts) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/** A stored confidence the scale knows, else 0: an unknown confidence is a guess. */
const confidenceOf = (value: unknown): WeighingConfidence =>
  (CONFIDENCE_LEVELS as readonly unknown[]).includes(value) ? (value as WeighingConfidence) : 0;

/** The latest row of a kind: greatest time, a tie going to the later row. */
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
    confidence: confidenceOf(winner.confidence),
    source: "stored",
    stale,
    ...(typeof winner.evidence === "string" ? { evidence: winner.evidence } : {}),
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
  /** Stored non-rule rows by {@link cellKey}, only those a reader can address with a level on the set's scale. */
  byCell: Map<string, WeighingAssessment[]>;
  /** The project's positioning set, active or not. */
  positioningSet: WeighingCriteriaSet | undefined;
  /** Present only while the positioning is active; a draft feeds no roll-up. */
  positioning: { set: WeighingCriteriaSet; weights: Map<string, number> } | null;
}

/**
 * Resolve a matrix over a section — `undefined` when the matrix or its set is
 * not available, **or when the matrix is a draft** (anything but an absent or
 * `"active"` status, {@link isActiveWeighingSet}): a draft feeds no roll-up.
 */
export function buildWeighingContext(
  section: Partial<Pick<WeighingSection, "sets" | "matrices" | "assessments">> | null | undefined,
  matrixId: string = VALUE_MATRIX_ID,
): WeighingContext | undefined {
  const resolved = resolveWeighing(section);
  const matrix = resolved.matrices.find((candidate) => candidate.id === matrixId);
  if (matrix === undefined || !isActiveWeighingSet(matrix)) return undefined;
  const set = setOfRef(resolved, matrix.set);
  if (set === undefined) return undefined;
  const scale = weighingScaleOf(set, resolved);

  const byCell = new Map<string, WeighingAssessment[]>();
  // Rows a reader cannot address (no string matrix/subject/criterion) are skipped by
  // `readWeighingAssessments`; a row whose level is not a whole number on the set's
  // scale is skipped here (a cell then reads its seed or stays blank). The validator
  // warns about both.
  for (const row of readWeighingAssessments(section)) {
    if (row.matrix !== matrix.id || row.scorer?.kind === "rule") continue;
    if (typeof row.level !== "number" || !Number.isInteger(row.level) || row.level < scale.min || row.level > scale.max) continue;
    const key = cellKey(row.matrix, row.subject, row.criterion);
    const rows = byCell.get(key);
    if (rows === undefined) byCell.set(key, [row]);
    else rows.push(row);
  }

  // A positioning is the set the matrix points to AND that says it is one: the id alone is not enough.
  const positioningSet =
    matrix.positioning === undefined
      ? undefined
      : resolved.sets.find((candidate) => candidate.id === matrix.positioning && candidate.role === "positioning");
  let positioning: WeighingContext["positioning"] = null;
  if (positioningSet !== undefined && isActiveWeighingSet(positioningSet)) {
    const weights = new Map<string, number>();
    for (const criterion of positioningSet.criteria) {
      if (weights.has(criterion.id)) continue; // the first wins
      // 0 means "this element does not count"; anything that is not a finite, non-negative number means "no weight said" (1).
      weights.set(criterion.id, typeof criterion.weight === "number" && Number.isFinite(criterion.weight) && criterion.weight >= 0 ? criterion.weight : 1);
    }
    positioning = { set: positioningSet, weights };
  }
  return { matrix, set, byCell, positioningSet, positioning };
}

// --- One promise -------------------------------------------------------------

/** A share (0–1) of a figure that rests on confidence-0 cells. */
export interface ServedCostGuesswork {
  served: number;
  cost: number;
}

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
  /** The same sums over the positioned elements only, each times its weight, with its own guesswork share. `null` without an active positioning. */
  positioned: { served: number; cost: number; guesswork: ServedCostGuesswork } | null;
  /** Platforms where the promise is live ÷ platforms it applies to; `null` when it applies to none. */
  kept_share: number | null;
  /** The share (0–1) of `served` and of `cost` that rests on confidence-0 cells. */
  guesswork: ServedCostGuesswork;
  /**
   * A clean partition — a cell raises at most one flag, and only a STORED
   * winner raises any (a seeded cell never does).
   */
  flags: {
    /** Claimed, and the stored winner is 0 or 1: the claim is stronger than the promise. */
    claim_not_supported: string[];
    /** Claimed, and the stored winner is negative: the promise costs what it claims to serve. */
    claim_contradicted: string[];
    /** Not claimed, and the stored winner is 1 or more: the promise does more than it says. */
    unclaimed_value: string[];
    /** Not claimed, and the stored winner is negative — authors claim intent, so a cost is never claimed. */
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

/** A guesswork share: the part of `total` that is `guess`, 0 when there is nothing. */
const share = (guess: number, total: number): number => (total > 0 ? guess / total : 0);

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

  // Whole levels are summed and divided by 3 once, so no float drift accumulates.
  let served = 0;
  let cost = 0;
  let servedGuess = 0;
  let costGuess = 0;
  let positionedServed = 0;
  let positionedCost = 0;
  let positionedServedGuess = 0;
  let positionedCostGuess = 0;
  const flags: PromiseWeighing["flags"] = { claim_not_supported: [], claim_contradicted: [], unclaimed_value: [], unclaimed_cost: [] };
  const stale: string[] = [];
  const review: string[] = [];

  for (const cell of cells) {
    const weight = ctx.positioning?.weights.get(cell.criterion);
    const guess = cell.confidence === 0;
    if (cell.level > 0) {
      served += cell.level;
      if (guess) servedGuess += cell.level;
      if (weight !== undefined) {
        positionedServed += cell.level * weight;
        if (guess) positionedServedGuess += cell.level * weight;
      }
    } else if (cell.level < 0) {
      cost += -cell.level;
      if (guess) costGuess += -cell.level;
      if (weight !== undefined) {
        positionedCost += -cell.level * weight;
        if (guess) positionedCostGuess += -cell.level * weight;
      }
    }
    if (cell.stale) stale.push(cell.criterion);
    if (cell.review) review.push(cell.criterion);
    if (cell.source === "stored") {
      if (cell.claimed) {
        if (cell.level < 0) flags.claim_contradicted.push(cell.criterion);
        else if (cell.level <= 1) flags.claim_not_supported.push(cell.criterion);
      } else if (cell.level < 0) flags.unclaimed_cost.push(cell.criterion);
      else if (cell.level >= 1) flags.unclaimed_value.push(cell.criterion);
    }
  }

  return {
    node_id: node.id,
    title: node.title ?? "",
    status: node.status,
    archived: node.status === "archived",
    fingerprint,
    cells,
    served: served / 3,
    cost: cost / 3,
    positioned:
      ctx.positioning === null
        ? null
        : {
            served: positionedServed / 3,
            cost: positionedCost / 3,
            guesswork: { served: share(positionedServedGuess, positionedServed), cost: share(positionedCostGuess, positionedCost) },
          },
    kept_share: keptShare(node),
    guesswork: { served: share(servedGuess, served), cost: share(costGuess, cost) },
    flags,
    stale,
    review,
  };
}

// --- The matrix --------------------------------------------------------------

/** What one element is promised and kept across every live promise. */
export interface ElementMass {
  /** Σ over promises of positive level ÷ 3. */
  promised: number;
  /** The same, each promise times its kept share (0 when it applies nowhere). */
  kept: number;
  /** Σ over promises of |negative level| ÷ 3. */
  cost: number;
  /** For each mass, the share (0–1) of it that rests on confidence-0 cells. */
  guesswork: { promised: number; kept: number; cost: number };
}

export interface WeighingView {
  matrix: WeighingMatrix;
  set: WeighingCriteriaSet;
  /** `null` when no positioning exists; `active: false` for a draft, which feeds nothing. `set` is a reference. */
  positioning: { set: WeighingCriteriaSet; active: boolean } | null;
  promises: PromiseWeighing[];
  /** One entry per element of the set, in set order, zeros included. Archived promises are left out. */
  elements: Record<string, ElementMass>;
  totals: {
    promised: number;
    kept: number;
    cost: number;
    guesswork: { promised: number; kept: number; cost: number };
    promises: number;
    archived: number;
    /** Live promises with at least one stored (non-seed) cell — archived ones are counted nowhere, like the masses. */
    assessed: number;
  };
}

/** The nodes a matrix judges, each node id once (the first wins). */
export function matrixSubjects<N extends Pick<Node, "id" | "species">>(nodes: readonly N[], matrix: WeighingMatrix): N[] {
  const wanted =
    matrix.subjects.kind === "query"
      ? undefined
      : new Set(matrix.subjects.items.map((item) => item?.node_id ?? item?.id));
  const species = matrix.subjects.kind === "query" ? matrix.subjects.species : undefined;
  const seen = new Set<string>();
  const out: N[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    if (wanted === undefined ? node.species !== species : !wanted.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

/**
 * Derive the whole matrix: every promise weighed, every element's masses, the
 * totals. `undefined` when the matrix or its set is not available or the
 * matrix is a draft ({@link buildWeighingContext}).
 *
 * Every roll-up is computed from promises, never from another roll-up, and an
 * archived promise is weighed (so its form still works) but counted nowhere.
 */
export function deriveWeighing(
  nodes: readonly WeighedNode[],
  section: Partial<Pick<WeighingSection, "sets" | "matrices" | "assessments">> | null | undefined,
  matrixId: string = VALUE_MATRIX_ID,
): WeighingView | undefined {
  const ctx = buildWeighingContext(section, matrixId);
  if (ctx === undefined) return undefined;

  const promises = matrixSubjects(nodes, ctx.matrix).map((node) => weighPromise(node, ctx));
  // Whole levels (kept: levels times a kept share), summed; each mass is divided by 3 once at the end.
  interface Raw {
    promised: number;
    promisedGuess: number;
    kept: number;
    keptGuess: number;
    cost: number;
    costGuess: number;
  }
  const empty = (): Raw => ({ promised: 0, promisedGuess: 0, kept: 0, keptGuess: 0, cost: 0, costGuess: 0 });
  const raw = new Map<string, Raw>(ctx.set.criteria.map((criterion) => [criterion.id, empty()]));

  let assessed = 0;
  let archived = 0;
  for (const promise of promises) {
    if (promise.archived) {
      archived++;
      continue;
    }
    if (promise.cells.some((cell) => cell.source === "stored")) assessed++;
    const kept = promise.kept_share ?? 0;
    for (const cell of promise.cells) {
      const mass = raw.get(cell.criterion);
      if (mass === undefined) continue;
      const guess = cell.confidence === 0;
      if (cell.level > 0) {
        mass.promised += cell.level;
        mass.kept += cell.level * kept;
        if (guess) {
          mass.promisedGuess += cell.level;
          mass.keptGuess += cell.level * kept;
        }
      } else if (cell.level < 0) {
        mass.cost += -cell.level;
        if (guess) mass.costGuess += -cell.level;
      }
    }
  }

  const elements: Record<string, ElementMass> = {};
  const total = empty();
  for (const [id, mass] of raw) {
    elements[id] = {
      promised: mass.promised / 3,
      kept: mass.kept / 3,
      cost: mass.cost / 3,
      guesswork: { promised: share(mass.promisedGuess, mass.promised), kept: share(mass.keptGuess, mass.kept), cost: share(mass.costGuess, mass.cost) },
    };
    for (const key of Object.keys(total) as (keyof Raw)[]) total[key] += mass[key];
  }

  return {
    matrix: ctx.matrix,
    set: ctx.set,
    positioning: ctx.positioningSet === undefined ? null : { set: ctx.positioningSet, active: ctx.positioning !== null },
    promises,
    elements,
    totals: {
      promised: total.promised / 3,
      kept: total.kept / 3,
      cost: total.cost / 3,
      guesswork: { promised: share(total.promisedGuess, total.promised), kept: share(total.keptGuess, total.kept), cost: share(total.costGuess, total.cost) },
      promises: promises.length,
      archived,
      assessed,
    },
  };
}

/** The sort keys a matrix page or an agent orders promises by. */
export type PromiseSortKey = "served" | "cost" | "positioned" | "title";

/**
 * Promises ordered by a derived key, heaviest first (title: A to Z); a promise
 * with no positioned figure sorts last. Every tie breaks by title, then by id,
 * so the order is total and stable across runs and locales.
 */
export function sortPromises(promises: readonly PromiseWeighing[], key: PromiseSortKey): PromiseWeighing[] {
  // A figure is never negative, so -1 is "below every real figure" — a null positioned sorts last.
  const value = (promise: PromiseWeighing): number =>
    key === "served" ? promise.served : key === "cost" ? promise.cost : key === "positioned" ? promise.positioned?.served ?? -1 : 0;
  const byTitle = (a: PromiseWeighing, b: PromiseWeighing): number =>
    (a.title ?? "").localeCompare(b.title ?? "", "en") || a.node_id.localeCompare(b.node_id);
  return [...promises].sort((a, b) => (key === "title" ? byTitle(a, b) : value(b) - value(a) || byTitle(a, b)));
}

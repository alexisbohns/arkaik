/**
 * The built-in weighing library — the `value-contribution` criteria set (the 30
 * elements of value, in their four tiers, on the signed −3..+3 scale) and the
 * `value` matrix that judges every acceptance against it.
 *
 * **Two majors, one current.** `value-contribution@2` is the ruler: a level
 * measures REACH in a person's life (+1 within the product, +2 across the
 * domain, +3 life-wide), and every element carries its own ladder
 * ({@link ./weighing-ladders}). `@1` measured how central a value is to the
 * promise; it stays here, frozen, so a positioning or a project matrix that
 * still says `@1` resolves — but the built-in matrix reads `@2`, and the major
 * bump makes every level scored against `@1` stale (docs/rfcs/weighing.md § 8).
 *
 * Library content, not project state: it is pinned by version and never stored
 * in `bundle.weighing`, the way Kritik's pack is shipped rather than authored
 * (`packages/kritik-library`). A project's own sets — its positioning — live in
 * the section and are layered on by {@link resolveWeighing}.
 *
 * Zod-free and fs-free, like {@link ./weighing}: the app, the CLI, the MCP
 * server and the plugin scripts all read this one copy.
 */

import type { Node } from "./bundle";
import { VALUE_IDS, VALUE_TIERS, type ValueId, type ValueTierId } from "./ids";
import { VALUE_REACH_LADDERS } from "./weighing-ladders";
import type { WeighingCriteriaSet, WeighingMatrix, WeighingScale, WeighingSection } from "./weighing";
import { majorOf, splitSetRef, stakeSpeciesDeclaredBy } from "./weighing";
import { USER_FACING_STAKE_SPECIES, stakeSpeciesOf } from "./stake";

/**
 * Freeze a value and everything under it. The built-ins are shared by every
 * reader in the process; a caller that mutated one would change it for all.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

export const VALUE_SET_ID = "value-contribution";
/** The current ruler's version. Levels are comparable only within a major. */
export const VALUE_SET_VERSION = "2.0.0";
/** The first ruler, kept frozen so an `@1` ref still resolves. */
export const VALUE_SET_V1_VERSION = "1.0.0";
export const VALUE_MATRIX_ID = "value";
/** The built-in matrix that judges stakes against the same ruler. Its own cells, never mixed into {@link VALUE_MATRIX_ID}'s. */
export const STAKE_MATRIX_ID = "stakes";
/** The id a project's positioning set carries. */
export const POSITIONING_SET_ID = "positioning";

/**
 * The scale, every level in words: how far into a person's life the promise
 * reaches. What a scorer — human or agent — reads before choosing, when the
 * element's own ladder does not say a level ({@link ./weighing-ladders} says
 * every level but 0).
 */
export const VALUE_SCALE_ANCHORS: Readonly<Record<string, string>> = {
  "3": "Life-wide. It gives the person this well beyond the product and its domain, in their life.",
  "2": "Across the domain. The person gets this in the whole area the product belongs to, not only inside it.",
  "1": "Within the product. A real contribution, felt while using it.",
  "0": "Unrelated: weighed and found to have nothing to do with it. (No row means nobody has weighed it yet.)",
  "-1": "Within the product. A small cost, felt while using it.",
  "-2": "Across the domain. The person notices the loss of this in the whole area the product belongs to.",
  "-3": "Life-wide. It leaves the person with the opposite of this in their life.",
};

/** The `@1` scale: how central a value is to the promise. Kept for the frozen `@1` set. */
export const VALUE_SCALE_V1_ANCHORS: Readonly<Record<string, string>> = {
  "3": "Core. The promise exists for this; take it away and the value goes.",
  "2": "Supports clearly. The user would notice it missing.",
  "1": "Touches. A side effect of the promise, not its purpose.",
  "0": "Unrelated: weighed and found to have nothing to do with it. (No row means nobody has weighed it yet.)",
  "-1": "Small friction. It costs this value a little.",
  "-2": "Works against it. The user notices the cost.",
  "-3": "Costs it at its core. The user feels the opposite.",
};

const TIER_TITLES: Readonly<Record<ValueTierId, string>> = {
  functional: "Functional",
  emotional: "Emotional",
  "life-changing": "Life-changing",
  "social-impact": "Social impact",
};

/**
 * One label and one definition per element. Mirrors `lib/config/values.ts`
 * (the app's UI table); `tests/app/value-icons.test.js` pins the two copies
 * together so neither can drift. A `Record<ValueId, …>` makes a missing element
 * a compile error.
 */
const VALUE_TEXT: Readonly<Record<ValueId, { name: string; definition: string }>> = {
  "saves-time": { name: "Saves time", definition: "Completes the user's task in less time." },
  simplifies: { name: "Simplifies", definition: "Reduces steps, choices, or cognitive load." },
  "makes-money": { name: "Makes money", definition: "Helps the user earn." },
  "reduces-risk": { name: "Reduces risk", definition: "Protects against loss, error, or uncertainty." },
  organizes: { name: "Organizes", definition: "Brings order to the user's things or life." },
  integrates: { name: "Integrates", definition: "Ties different tools or parts of life together." },
  connects: { name: "Connects", definition: "Brings the user together with other people." },
  "reduces-effort": { name: "Reduces effort", definition: "Same outcome, less work." },
  "avoids-hassles": { name: "Avoids hassles", definition: "Prevents friction and annoyance before it happens." },
  "reduces-cost": { name: "Reduces cost", definition: "Saves the user money." },
  quality: { name: "Quality", definition: "Superior craft or performance the user can feel." },
  variety: { name: "Variety", definition: "Meaningful choice and breadth." },
  "sensory-appeal": { name: "Sensory appeal", definition: "Looks, sounds, or feels good in the moment." },
  informs: { name: "Informs", definition: "Tells the user something they want to know." },
  "reduces-anxiety": { name: "Reduces anxiety", definition: "Calms; makes the user feel safe." },
  "rewards-me": { name: "Rewards me", definition: "Tangible perks for engagement." },
  nostalgia: { name: "Nostalgia", definition: "Positive memory of the past." },
  "design-aesthetics": { name: "Design / aesthetics", definition: "Beauty as an experienced value, beyond function." },
  "badge-value": { name: "Badge value", definition: "Signals identity or status to others." },
  wellness: { name: "Wellness", definition: "Improves physical or mental well-being." },
  "therapeutic-value": { name: "Therapeutic value", definition: "Actively supports emotional processing or healing." },
  "fun-entertainment": { name: "Fun / entertainment", definition: "Enjoyable, playful, delightful." },
  attractiveness: { name: "Attractiveness", definition: "Makes the user feel attractive." },
  "provides-access": { name: "Provides access", definition: "Grants entry to something otherwise out of reach." },
  "provides-hope": { name: "Provides hope", definition: "Reason to believe things can improve." },
  "self-actualization": { name: "Self-actualization", definition: "Helps the user become who they want to be." },
  motivation: { name: "Motivation", definition: "Energizes the user toward their goals." },
  heirloom: { name: "Heirloom", definition: "Something worth passing on across time." },
  "affiliation-belonging": { name: "Affiliation & belonging", definition: "Makes the user part of a group that matters." },
  "self-transcendence": { name: "Self-transcendence", definition: "Helps beyond the user themselves." },
};

/** The signed scale the value set (and, by default, a positioning) is read on. */
const VALUE_SCALE: WeighingScale = { min: -3, max: 3, anchors: { ...VALUE_SCALE_ANCHORS } };

const GROUPS = (Object.keys(TIER_TITLES) as ValueTierId[]).map((id) => ({ id, title: TIER_TITLES[id] }));

/**
 * The question a scorer answers per element. Informs is the one asked as "mainly":
 * asked "at least a little", nearly every promise informs the person about the
 * service (the Jev POC found it on 12 of 12), so it would read as served everywhere.
 */
function reachQuestion(id: ValueId): string {
  if (id === "informs") {
    return "Is what this promise mainly gives the person information, rather than an ability, a shortcut, a protection or a feeling? Or does it keep them from knowing something? And how far into their life does it reach?";
  }
  return `Does this promise serve, or cost, "${VALUE_TEXT[id].name}" for the person? And how far into their life does it reach: within the product, across its domain, or life-wide?`;
}

/**
 * The current ruler: the 30 elements as criteria, in `VALUE_IDS` order, grouped
 * by tier, each with its own reach ladder.
 */
export const VALUE_CONTRIBUTION_SET: WeighingCriteriaSet = deepFreeze({
  id: VALUE_SET_ID,
  version: VALUE_SET_VERSION,
  title: "Elements of value",
  subject: "acceptance",
  // The reference declares what it scores (stake architecture, part 4): the user-facing stakes are weighed on the pyramid.
  stake_species: [...USER_FACING_STAKE_SPECIES],
  scale: VALUE_SCALE,
  groups: GROUPS,
  criteria: VALUE_IDS.map((id) => ({
    id,
    group: VALUE_TIERS[id],
    name: VALUE_TEXT[id].name,
    question: reachQuestion(id),
    definition: VALUE_TEXT[id].definition,
    anchors: { ...VALUE_REACH_LADDERS[id] },
  })),
});

/** The first ruler (centrality), frozen. Nothing new is scored against it; it resolves so `@1` refs still read. */
export const VALUE_CONTRIBUTION_SET_V1: WeighingCriteriaSet = deepFreeze({
  id: VALUE_SET_ID,
  version: VALUE_SET_V1_VERSION,
  title: "Elements of value",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: { ...VALUE_SCALE_V1_ANCHORS } },
  groups: GROUPS,
  criteria: VALUE_IDS.map((id) => ({
    id,
    group: VALUE_TIERS[id],
    name: VALUE_TEXT[id].name,
    question: `Does this promise serve, or cost, "${VALUE_TEXT[id].name}"?`,
    definition: VALUE_TEXT[id].definition,
  })),
});

/** The built-in matrix: every acceptance, judged against the elements of value. */
export const VALUE_MATRIX: WeighingMatrix = deepFreeze({
  id: VALUE_MATRIX_ID,
  title: "Value",
  set: `${VALUE_SET_ID}@2`,
  subjects: { kind: "query", species: "acceptance" },
  positioning: POSITIONING_SET_ID,
  status: "active",
});

/**
 * The built-in stake matrix: every stake of a species the ruler declares
 * (bug, friction, need), judged against the elements of value. No positioning
 * re-weights it: a positioning speaks about the product's promises, and the
 * figures of the two matrices are never added.
 */
export const STAKE_MATRIX: WeighingMatrix = deepFreeze({
  id: STAKE_MATRIX_ID,
  title: "Stakes",
  set: `${VALUE_SET_ID}@2`,
  subjects: { kind: "query", species: "stake" },
  status: "active",
});

/**
 * The current ruler FIRST: a lookup by id alone (a ref with no `@`, a reader
 * that wants "the value set") finds the current major. {@link setOfRef} picks a
 * major explicitly.
 */
export const BUILT_IN_SETS: readonly WeighingCriteriaSet[] = [VALUE_CONTRIBUTION_SET, VALUE_CONTRIBUTION_SET_V1];
export const BUILT_IN_MATRICES: readonly WeighingMatrix[] = [VALUE_MATRIX, STAKE_MATRIX];

/**
 * The built-ins layered under a project's own entries — the WELL-FORMED view of a
 * section: every set and matrix here passed its shape guard, so derivation code
 * can read `.criteria`, `.set` and `.subjects` without checking. Read a stored
 * section through {@link resolveWeighing}, never straight off `section.sets`.
 */
export interface ResolvedWeighing {
  sets: WeighingCriteriaSet[];
  matrices: WeighingMatrix[];
  /**
   * Every stored entry the resolver dropped — malformed, a redefinition of a
   * built-in, or a duplicate id — with its position in the stored list, so a
   * surface can say "your saved positioning is malformed and is ignored"
   * instead of showing nothing. `id` is absent when the entry has none.
   */
  skipped: { kind: "set" | "matrix"; id?: string; /** A set's role, when it names one (a mistyped positioning has role `positioning` and any id). */ role?: string; index: number }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy of a project set without its unusable criteria; the set itself when it has none. */
function cleaned(set: WeighingCriteriaSet): WeighingCriteriaSet {
  const usable = set.criteria.filter((criterion) => isObject(criterion) && typeof criterion.id === "string");
  return usable.length === set.criteria.length ? set : { ...set, criteria: usable };
}

/**
 * A set a reader can use: a string id and version, a criteria array and a scale
 * object — except a positioning (`role: "positioning"`), which may have no
 * scale because it uses its `extends` ruler's ({@link weighingScaleOf}).
 */
export function isWeighingSetShape(set: unknown): set is WeighingCriteriaSet {
  return (
    isObject(set) &&
    typeof set.id === "string" &&
    typeof set.version === "string" &&
    Array.isArray(set.criteria) &&
    (isObject(set.scale) || set.role === "positioning")
  );
}

/**
 * A matrix a reader can use: a string id and set ref, and a subjects object of
 * a known kind that carries what the kind needs — a `query` names a species, a
 * `list` has an items array.
 */
export function isWeighingMatrixShape(matrix: unknown): matrix is WeighingMatrix {
  if (!isObject(matrix) || typeof matrix.id !== "string" || typeof matrix.set !== "string" || !isObject(matrix.subjects)) return false;
  const { kind, species, items } = matrix.subjects;
  return (kind === "query" && typeof species === "string") || (kind === "list" && Array.isArray(items));
}

/** A scale a reader can use: numeric `min` and `max` and an object `anchors` (`weighing-scale-shape` warns on the rest). */
function isUsableScale(scale: unknown): scale is WeighingScale {
  return isObject(scale) && typeof scale.min === "number" && typeof scale.max === "number" && isObject(scale.anchors);
}

/**
 * The scale a set is read on: its own, or — for a positioning with none — its
 * `extends` ruler's, or at the last the built-in signed scale — and it only
 * takes a set's own scale when that scale is usable (numeric min and max, an
 * anchors object), so `.anchors[...]` is always safe. Total, so a
 * reader never needs a guard before `.min` / `.max` / `.anchors`.
 */
export function weighingScaleOf(set: Pick<WeighingCriteriaSet, "scale" | "extends">, resolved?: Pick<ResolvedWeighing, "sets">): WeighingScale {
  if (isUsableScale(set.scale)) return set.scale;
  const ruler = typeof set.extends === "string" && resolved !== undefined ? setOfRef(resolved, set.extends) : undefined;
  return ruler !== undefined && isUsableScale(ruler.scale) ? ruler.scale : VALUE_SCALE;
}

/**
 * The effective sets and matrices: the built-ins, then the project's own.
 * A project entry that reuses a built-in's id is ignored — a pinned set is
 * never redefined (`validateBundle` warns) — and later duplicates lose to
 * earlier ones, matching every other first-wins read in this package. An entry
 * a reader could not use (a matrix with no set, a set with no criteria or
 * scale) is skipped rather than thrown on; the validator warns about it
 * (`weighing-set-shape`, `weighing-matrix-shape`). A criterion that is not an
 * object with a string id is dropped from a project set's copy, so
 * `set.criteria` is clean to walk (`weighing-criterion-shape` warns).
 */
export function resolveWeighing(section?: Partial<Pick<WeighingSection, "sets" | "matrices">> | null): ResolvedWeighing {
  const sets: WeighingCriteriaSet[] = [...BUILT_IN_SETS];
  const matrices: WeighingMatrix[] = [...BUILT_IN_MATRICES];
  const skipped: ResolvedWeighing["skipped"] = [];
  const idOf = (entry: unknown): { id?: string; role?: string } =>
    isObject(entry) ? { ...(typeof entry.id === "string" ? { id: entry.id } : {}), ...(typeof entry.role === "string" ? { role: entry.role } : {}) } : {};
  (Array.isArray(section?.sets) ? section.sets : []).forEach((set, index) => {
    if (isWeighingSetShape(set) && !sets.some((s) => s.id === set.id)) sets.push(cleaned(set));
    else skipped.push({ kind: "set", ...idOf(set), index });
  });
  (Array.isArray(section?.matrices) ? section.matrices : []).forEach((matrix, index) => {
    if (isWeighingMatrixShape(matrix) && !matrices.some((m) => m.id === matrix.id)) matrices.push(matrix);
    else skipped.push({ kind: "matrix", ...idOf(matrix), index });
  });
  return { sets, matrices, skipped };
}

/**
 * The set a `value-contribution@2` ref names, if the resolved library holds it
 * **at that major**: a ref to `@3` of a set that is at `2.x` is not the same
 * ruler, and levels are comparable only within a major. The library may hold
 * one id at several majors (the built-in value set keeps `@1` beside `@2`), so
 * the ref picks among them. A ref with no `@` names the set at the first major
 * listed — for a built-in, the current one. The validator tells the two
 * failures apart (`weighing-unknown-set` / `weighing-set-ref-major`).
 */
export function setOfRef(resolved: Pick<ResolvedWeighing, "sets">, ref: string): WeighingCriteriaSet | undefined {
  const { id, major } = splitSetRef(ref);
  return resolved.sets.find((candidate) => candidate.id === id && (major === undefined || majorOf(candidate.version) === major));
}

/**
 * Is a ref behind the library's current major of its set? `value-contribution@1`
 * is, now that `@2` is the ruler: it still resolves, but nothing new is scored
 * against it. `false` for an unknown set, a ref with no major, or a current one.
 */
export function isOlderMajorRef(resolved: Pick<ResolvedWeighing, "sets">, ref: string): boolean {
  const { id, major } = splitSetRef(ref);
  const current = resolved.sets.find((candidate) => candidate.id === id);
  if (current === undefined || major === undefined) return false;
  const now = Number(majorOf(current.version));
  return Number.isFinite(now) && Number(major) < now;
}

/**
 * Does the matrix judge this node? A query matrix judges the nodes of its
 * species, and — when that species is `stake` — only the stakes whose kind the
 * matrix's set declares it scores ({@link stakeSpeciesDeclaredBy}); a list
 * matrix judges the nodes it lists. The one rule the planner, the derivation
 * and the validator share.
 */
export function isMatrixSubject(
  node: Pick<Node, "id" | "species" | "metadata">,
  matrix: Pick<WeighingMatrix, "subjects">,
  set: Pick<WeighingCriteriaSet, "stake_species"> | undefined,
): boolean {
  if (matrix.subjects.kind !== "query") return matrix.subjects.items.some((item) => (item?.node_id ?? item?.id) === node.id);
  if (node.species !== matrix.subjects.species) return false;
  if (node.species !== "stake") return true;
  const kind = stakeSpeciesOf({ metadata: node.metadata });
  return kind !== undefined && set !== undefined && stakeSpeciesDeclaredBy(set).includes(kind);
}

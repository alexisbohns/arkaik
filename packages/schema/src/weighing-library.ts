/**
 * The built-in weighing library — the `value-contribution` criteria set (the 30
 * elements of value, in their four tiers, on the signed −3..+3 scale) and the
 * `value` matrix that judges every acceptance against it.
 *
 * Library content, not project state: it is pinned by version and never stored
 * in `bundle.weighing`, the way Kritik's pack is shipped rather than authored
 * (`packages/kritik-library`). A project's own sets — its positioning — live in
 * the section and are layered on by {@link resolveWeighing}.
 *
 * Zod-free and fs-free, like {@link ./weighing}: the app, the CLI, the MCP
 * server and the plugin scripts all read this one copy.
 */

import { VALUE_IDS, VALUE_TIERS, type ValueId, type ValueTierId } from "./ids";
import type { WeighingCriteriaSet, WeighingMatrix, WeighingSection } from "./weighing";
import { majorOf, splitSetRef } from "./weighing";

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
export const VALUE_SET_VERSION = "1.0.0";
export const VALUE_MATRIX_ID = "value";
/** The id a project's positioning set carries. */
export const POSITIONING_SET_ID = "positioning";

/** The scale, every level in words. The anchors a scorer — human or agent — reads before choosing. */
export const VALUE_SCALE_ANCHORS: Readonly<Record<string, string>> = {
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

/** The 30 elements as criteria, in `VALUE_IDS` order, grouped by tier. */
export const VALUE_CONTRIBUTION_SET: WeighingCriteriaSet = deepFreeze({
  id: VALUE_SET_ID,
  version: VALUE_SET_VERSION,
  title: "Elements of value",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: { ...VALUE_SCALE_ANCHORS } },
  groups: (Object.keys(TIER_TITLES) as ValueTierId[]).map((id) => ({ id, title: TIER_TITLES[id] })),
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
  set: `${VALUE_SET_ID}@1`,
  subjects: { kind: "query", species: "acceptance" },
  positioning: POSITIONING_SET_ID,
  status: "active",
});

export const BUILT_IN_SETS: readonly WeighingCriteriaSet[] = [VALUE_CONTRIBUTION_SET];
export const BUILT_IN_MATRICES: readonly WeighingMatrix[] = [VALUE_MATRIX];

/** The built-ins layered under a project's own entries. */
export interface ResolvedWeighing {
  sets: WeighingCriteriaSet[];
  matrices: WeighingMatrix[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A set a reader can use: an id, a criteria array and a scale object. */
export function isWeighingSetShape(set: unknown): set is WeighingCriteriaSet {
  return isObject(set) && typeof set.id === "string" && Array.isArray(set.criteria) && isObject(set.scale);
}

/** A matrix a reader can use: an id, a set ref and a subjects object. */
export function isWeighingMatrixShape(matrix: unknown): matrix is WeighingMatrix {
  return isObject(matrix) && typeof matrix.id === "string" && typeof matrix.set === "string" && isObject(matrix.subjects);
}

/**
 * The effective sets and matrices: the built-ins, then the project's own.
 * A project entry that reuses a built-in's id is ignored — a pinned set is
 * never redefined (`validateBundle` warns) — and later duplicates lose to
 * earlier ones, matching every other first-wins read in this package. An entry
 * a reader could not use (a matrix with no set, a set with no criteria or
 * scale) is skipped rather than thrown on; the validator warns about it
 * (`weighing-set-shape`, `weighing-matrix-shape`).
 */
export function resolveWeighing(section?: Partial<Pick<WeighingSection, "sets" | "matrices">> | null): ResolvedWeighing {
  const sets: WeighingCriteriaSet[] = [...BUILT_IN_SETS];
  const matrices: WeighingMatrix[] = [...BUILT_IN_MATRICES];
  for (const set of Array.isArray(section?.sets) ? section.sets : []) {
    if (isWeighingSetShape(set) && !sets.some((s) => s.id === set.id)) sets.push(set);
  }
  for (const matrix of Array.isArray(section?.matrices) ? section.matrices : []) {
    if (isWeighingMatrixShape(matrix) && !matrices.some((m) => m.id === matrix.id)) matrices.push(matrix);
  }
  return { sets, matrices };
}

/**
 * The set a `value-contribution@1` ref names, if the resolved library holds it
 * **at that major**: a ref to `@2` of a set that is at `1.x` is not the same
 * ruler, and levels are comparable only within a major. A ref with no `@` names
 * the set at whatever major it is. The validator tells the two failures apart
 * (`weighing-unknown-set` / `weighing-set-ref-major`).
 */
export function setOfRef(resolved: Pick<ResolvedWeighing, "sets">, ref: string): WeighingCriteriaSet | undefined {
  const { id, major } = splitSetRef(ref);
  const set = resolved.sets.find((candidate) => candidate.id === id);
  if (set === undefined) return undefined;
  return major === undefined || majorOf(set.version) === major ? set : undefined;
}

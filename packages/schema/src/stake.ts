/**
 * The stake species — one node, one chain from signal to proof
 * (docs/rfcs/stake-architecture.md, docs/superpowers/specs/2026-11-22-stake-architecture-parts-1-4-design.md).
 *
 * A stake is something that matters about the product: a bug, a friction, a
 * need, a requirement, a risk or a defect. Its kind lives in
 * `metadata.stake_species`; its stored lifecycle is the node's own `status`,
 * limited to idea, discovery and archived (every other state — raised,
 * considered, promised, addressed — is derived, never stored). It is anchored
 * to the product's anatomy by outgoing `concerns` edges.
 *
 * Like decision.ts this module is deliberately zod-free (type-only imports) so
 * it bundles into the standalone validator and stays browser-safe; enums.ts
 * wraps the id lists in zod.
 */

import type { Node, NodeMetadata } from "./bundle";
import { VALID_EDGE_SEMANTICS, type SpeciesId, type StatusId } from "./ids";

/** The six stake species (RFC § 3). */
export const STAKE_SPECIES_IDS = ["bug", "friction", "need", "requirement", "risk", "defect"] as const;
export type StakeSpeciesId = (typeof STAKE_SPECIES_IDS)[number];

/** Whether the stake was seen in the world or reasoned about ahead of it. Absent reads as observed. */
export const STAKE_PROVENANCE_IDS = ["observed", "anticipated"] as const;
export type StakeProvenanceId = (typeof STAKE_PROVENANCE_IDS)[number];

/**
 * The only node `status` values a stake stores (weighing § 6). Raised,
 * considered, promised, partly addressed and addressed are derived.
 */
export const STAKE_LIFECYCLE_STATUSES = ["idea", "discovery", "archived"] as const satisfies readonly StatusId[];
export type StakeLifecycleStatus = (typeof STAKE_LIFECYCLE_STATUSES)[number];

/** RFC § 4: nothing exists yet to have a bug or a friction, so these are the only species an anticipated stake may be. */
export const ANTICIPATED_STAKE_SPECIES = ["need", "requirement", "risk", "defect"] as const satisfies readonly StakeSpeciesId[];

/** Stakes about what a person feels: they are weighed on the value pyramid. */
export const USER_FACING_STAKE_SPECIES = ["bug", "friction", "need"] as const satisfies readonly StakeSpeciesId[];

/** Stakes about what the product must or must not be: they are read against Kritik criteria. */
export const QUALITY_STAKE_SPECIES = ["requirement", "risk", "defect"] as const satisfies readonly StakeSpeciesId[];

/** The species a stake's `concerns` edge may point at, derived from the grammar so the two cannot drift. */
export const STAKE_ANCHOR_SPECIES: readonly SpeciesId[] = VALID_EDGE_SEMANTICS.concerns.map(([, target]) => target);

/** Where a stake's catalog link may point: a Kritik criterion or a value of the pyramid. */
export const STAKE_CATALOG_SOURCES = ["kritik", "values"] as const;
export type StakeCatalogSource = (typeof STAKE_CATALOG_SOURCES)[number];

/**
 * A catalog link: only the id is stored (a Kritik criterion id such as
 * `SAF-01`, or a value id such as `reduces-anxiety`), never anything copied
 * from the catalog.
 */
export interface StakeCatalogLink {
  source: StakeCatalogSource;
  id: string;
}

/**
 * How a person feels a stake's absence (need qualification § 3, step 6): a
 * must-be they expect, a performance they want, or an attractive they would be
 * delighted by. User-facing species only; a bug is always `expected`.
 */
export const STAKE_FELT_IDS = ["expected", "wanted", "delight"] as const;
export type StakeFelt = (typeof STAKE_FELT_IDS)[number];

/**
 * How much addressing a stake matters to the person, 4 (most) to 1 (least).
 * One scale for every felt kind, worded per kind ({@link STAKE_MATTERS_WORDING}).
 * It is a separate scale from the value pyramid's -3..+3: the two are never
 * summed, and neither is ever summed with a Kritik criticality.
 */
export const STAKE_MATTERS_LEVELS = [1, 2, 3, 4] as const;
export type StakeMatters = (typeof STAKE_MATTERS_LEVELS)[number];

/** How often the situation comes up for the person. Shown beside mattering, never sorted by (RFC open question 4). */
export const STAKE_FREQUENCY_IDS = ["rare", "some", "often"] as const;
export type StakeFrequency = (typeof STAKE_FREQUENCY_IDS)[number];

/** The question and the four tiers of the mattering scale for one felt kind (need qualification § 3, step 7). */
export interface StakeMattersWording {
  question: string;
  tiers: Record<StakeMatters, { name: string; hint: string }>;
}

export const STAKE_MATTERS_WORDING: Record<StakeFelt, StakeMattersWording> = {
  wanted: {
    question: "How much does addressing this matter to the person?",
    tiers: {
      4: { name: "Transformative", hint: "Changes what the person gets from the product" },
      3: { name: "Valuable", hint: "Would clearly feel the difference" },
      2: { name: "Nice to have", hint: "Pleased, but not much would change" },
      1: { name: "Marginal", hint: "Would barely register" },
    },
  },
  delight: {
    question: "How much would it please the person?",
    tiers: {
      4: { name: "Memorable", hint: "Would remember it and mention it" },
      3: { name: "Pleasing", hint: "Would clearly enjoy it" },
      2: { name: "Pleasant", hint: "A small smile, not much more" },
      1: { name: "Barely registers", hint: "Most would hardly notice" },
    },
  },
  expected: {
    question: "How much would it hurt if it were missing?",
    tiers: {
      4: { name: "Deal-breaker", hint: "Would stop using or trusting the product" },
      3: { name: "Clearly annoying", hint: "Would notice and be bothered each time" },
      2: { name: "Mildly annoying", hint: "Would notice now and then" },
      1: { name: "Barely noticed", hint: "Most would shrug" },
    },
  },
};

/** Who voiced a piece of evidence: the person the signal came from, the maintainer, or an agent reading on their behalf. */
export const STAKE_EVIDENCE_VOICES = ["person", "maintainer", "agent"] as const;
export type StakeEvidenceVoice = (typeof STAKE_EVIDENCE_VOICES)[number];

/**
 * One signal behind a stake (`metadata.evidence[]`, written at qualification).
 * `event_id` names the journal event (a `request.filed`) it came from; `quote`
 * is the line that matters, exactly as voiced; `date` is when it was voiced.
 * Every field is optional so a hand-written note is as legal as a promoted
 * signal. This is the durable half of the signal ↔ stake link; the other half
 * is the optional `stake_ids[]` on the event.
 */
export interface StakeEvidence {
  event_id?: string;
  quote?: string;
  voice?: StakeEvidenceVoice;
  date?: string;
}

/** The catalog source a stake species links to: quality species to Kritik, user-facing species to the value pyramid. */
export function catalogSourceForStakeSpecies(species: StakeSpeciesId): StakeCatalogSource {
  return (QUALITY_STAKE_SPECIES as readonly string[]).includes(species) ? "kritik" : "values";
}

export function isUserFacingStakeSpecies(species: string | undefined): boolean {
  return (USER_FACING_STAKE_SPECIES as readonly string[]).includes(species as string);
}

/** A stake's species when it is in the vocabulary, else undefined (a stake missing the field is legal, and warned about). */
export function stakeSpeciesOf(node: Pick<Node, "metadata">): StakeSpeciesId | undefined {
  const raw = node.metadata?.stake_species;
  return (STAKE_SPECIES_IDS as readonly string[]).includes(raw as string) ? (raw as StakeSpeciesId) : undefined;
}

/** A stake's provenance as it should be read: the stored value when in the vocabulary, else observed. */
export function stakeProvenanceOf(node: Pick<Node, "metadata">): StakeProvenanceId {
  const raw = node.metadata?.provenance;
  return (STAKE_PROVENANCE_IDS as readonly string[]).includes(raw as string) ? (raw as StakeProvenanceId) : "observed";
}

/** A stake's catalog link when well-formed (a known source and a non-empty id), else undefined. */
export function stakeCatalogOf(node: Pick<Node, "metadata">): StakeCatalogLink | undefined {
  const raw = node.metadata?.catalog;
  if (!raw || typeof raw !== "object") return undefined;
  const { source, id } = raw as { source?: unknown; id?: unknown };
  if (!(STAKE_CATALOG_SOURCES as readonly string[]).includes(source as string)) return undefined;
  if (typeof id !== "string" || id === "") return undefined;
  return { source: source as StakeCatalogSource, id };
}

/** The species a stake of this provenance may take: anticipated stakes are never a bug or a friction (RFC § 4). */
export function stakeSpeciesFor(provenance: StakeProvenanceId): readonly StakeSpeciesId[] {
  return provenance === "anticipated" ? ANTICIPATED_STAKE_SPECIES : STAKE_SPECIES_IDS;
}

/** True when a stake of this species may be anticipated; a bug or a friction must be rerouted as a need first. */
export function canBeAnticipated(species: StakeSpeciesId | undefined): boolean {
  return species === undefined || (ANTICIPATED_STAKE_SPECIES as readonly string[]).includes(species);
}

/** A stake's felt kind when it is in the vocabulary, else undefined. */
export function stakeFeltOf(node: Pick<Node, "metadata">): StakeFelt | undefined {
  const raw = node.metadata?.felt;
  return (STAKE_FELT_IDS as readonly string[]).includes(raw as string) ? (raw as StakeFelt) : undefined;
}

/** A stake's mattering when it is one of 1 to 4, else undefined. */
export function stakeMattersOf(node: Pick<Node, "metadata">): StakeMatters | undefined {
  const raw = node.metadata?.matters;
  return (STAKE_MATTERS_LEVELS as readonly unknown[]).includes(raw) ? (raw as StakeMatters) : undefined;
}

/** A stake's frequency when it is in the vocabulary, else undefined. */
export function stakeFrequencyOf(node: Pick<Node, "metadata">): StakeFrequency | undefined {
  const raw = node.metadata?.frequency;
  return (STAKE_FREQUENCY_IDS as readonly string[]).includes(raw as string) ? (raw as StakeFrequency) : undefined;
}

/** One edit to a stake's own metadata. `undefined` clears the field, a missing key leaves it. */
export interface StakeFieldChange {
  stake_species?: StakeSpeciesId | undefined;
  provenance?: StakeProvenanceId | undefined;
  catalog?: StakeCatalogLink | undefined;
  felt?: StakeFelt | undefined;
  matters?: StakeMatters | undefined;
  frequency?: StakeFrequency | undefined;
}

/**
 * The metadata a stake should carry after `change`, as a new object (the input
 * is never mutated). Two consequences are applied here so every writer agrees:
 *
 * - A species that moves between the value pyramid and Kritik drops a catalog
 *   link that no longer fits it (a `values` link on a requirement is wrong, and
 *   the validator warns on it).
 * - `observed` is the default, so it is stored as absence, not as a value.
 * - felt, matters and frequency are for the user-facing species only (RFC § 6):
 *   a requirement, risk or defect drops all three, and a bug is always
 *   `expected`.
 */
export function stakeMetadataWith(metadata: NodeMetadata | undefined, change: StakeFieldChange): NodeMetadata {
  const next: NodeMetadata = { ...(metadata ?? {}) };
  for (const key of ["stake_species", "provenance", "catalog", "felt", "matters", "frequency"] as const) {
    if (!(key in change)) continue;
    const value = change[key];
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  if (next.provenance === "observed") delete next.provenance;
  const species = stakeSpeciesOf({ metadata: next });
  const catalog = stakeCatalogOf({ metadata: next });
  if (species !== undefined && catalog !== undefined && catalog.source !== catalogSourceForStakeSpecies(species)) {
    delete next.catalog;
  }
  if (species !== undefined && !isUserFacingStakeSpecies(species)) {
    delete next.felt;
    delete next.matters;
    delete next.frequency;
  } else if (species === "bug") {
    next.felt = "expected";
  }
  return next;
}

/** A stake's evidence entries, keeping only well-formed objects (a stray scalar in a hand-edited array is skipped, not trusted). */
export function stakeEvidenceOf(node: Pick<Node, "metadata">): StakeEvidence[] {
  const raw = node.metadata?.evidence;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is StakeEvidence => typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

/**
 * The journal event ids the given stakes cite as evidence. Non-stake nodes are
 * ignored, so a caller can hand over the whole node list. This is what lets a
 * projection read the stake-to-signal link without owning the nodes itself.
 */
export function stakeEvidenceEventIds(nodes: Iterable<Pick<Node, "species" | "metadata">>): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.species !== "stake") continue;
    for (const entry of stakeEvidenceOf(node)) {
      if (typeof entry.event_id === "string" && entry.event_id !== "") ids.add(entry.event_id);
    }
  }
  return ids;
}

/**
 * Qualification: turning a signal into a stake (docs/rfcs/stake-architecture.md
 * § 3 and § 9, docs/rfcs/need-qualification.md step 1 and step 4).
 *
 * Three pure pieces, in the order a qualifier meets them:
 *
 * 1. {@link routeSpecies} applies the RFC's species decision to facts a person
 *    or an agent supplies. It never judges the facts: whether a thing is broken
 *    or merely in the way is the qualifier's call, and the function only turns
 *    the answers into a species, a refusal or a route out. {@link ROUTING_QUESTIONS}
 *    is the single source of the questions, so the MCP tool descriptions and the
 *    skill text cannot drift from the table.
 * 2. {@link findMergeCandidates} looks for an existing stake the signal could
 *    join (the RFC's guardrail: merge before creating). It only ever proposes.
 * 3. {@link planSignalToStake} and {@link planSignalMerge} return the
 *    {@link MutationOp}s that record the decision. They never apply them, so the
 *    caller's `applyOps` stamps the usual events and validates the result.
 *
 * Like decision.ts and stake.ts this module is zod-free with relative imports
 * only, so it loads in every test harness and bundles without the zod runtime.
 * Its top level holds constants and function declarations only.
 */

import type { Edge, Node } from "./bundle";
import { deriveNodeId, edgeId, kebabCase } from "./id-gen";
import { VALUE_IDS } from "./ids";
import type { SignalSourceKind } from "./journal";
import type { MutationOp } from "./mutate";
import {
  ANTICIPATED_STAKE_SPECIES,
  STAKE_ANCHOR_SPECIES,
  catalogSourceForStakeSpecies,
  stakeCatalogOf,
  stakeEvidenceOf,
  stakeMetadataWith,
  stakeSpeciesOf,
  type StakeCatalogLink,
  type StakeEvidence,
  type StakeEvidenceVoice,
  type StakeProvenanceId,
  type StakeSpeciesId,
} from "./stake";

// --- 1. Routing ---------------------------------------------------------------

/** Which door the signal came through (RFC § 4): an existing product, or one being shaped. */
export const QUALIFY_DOORS = ["collect", "imagine"] as const;
export type QualifyDoor = (typeof QUALIFY_DOORS)[number];

/** Whether the input is about the product at all (need-qualification step 5). */
export const QUALIFY_SCOPES = ["product", "internal", "off-scope"] as const;
export type QualifyScope = (typeof QUALIFY_SCOPES)[number];

/** What the stake faces: a person's value, or quality and obligation (RFC § 3). */
export const QUALIFY_FACINGS = ["value", "quality"] as const;
export type QualifyFacing = (typeof QUALIFY_FACINGS)[number];

/** Value-facing: what the person expected. broken is a bug, as-designed a friction, absent a need. */
export const QUALIFY_EXPECTATIONS = ["broken", "as-designed", "absent"] as const;
export type QualifyExpectation = (typeof QUALIFY_EXPECTATIONS)[number];

/** Quality-facing: what kind of threat. obligation is a requirement, own-flaw a defect, mitigable-only a risk. */
export const QUALIFY_THREATS = ["obligation", "own-flaw", "mitigable-only"] as const;
export type QualifyThreat = (typeof QUALIFY_THREATS)[number];

/** Whether the species facts were said by someone or are the analyst's hypothesis (need-qualification step 3). */
export const QUALIFY_BASES = ["stated", "inferred"] as const;
export type QualifyBasis = (typeof QUALIFY_BASES)[number];

export interface RoutingQuestion {
  id: "scope" | "door" | "facing" | "expectation" | "threat" | "basis";
  question: string;
  /** Every accepted answer, and where it leads. */
  answers: Record<string, string>;
  /** When the question is asked. */
  askedWhen: string;
}

/**
 * The questions {@link routeSpecies} reads, in the order they are asked. The
 * single source for tool descriptions and skill text.
 */
export const ROUTING_QUESTIONS: readonly RoutingQuestion[] = [
  {
    id: "scope",
    question: "Is this about the product a person meets?",
    answers: {
      product: "continue",
      internal: "routed out: about operating the product (CI, telemetry, maker analytics), nobody experiences it",
      "off-scope": "routed out: not this product's business",
    },
    askedWhen: "always, first",
  },
  {
    id: "door",
    question: "Does the product exist and do people use it (collect), or is it still being shaped (imagine)?",
    answers: {
      collect: "observed; all six species are open",
      imagine: "anticipated; only need, requirement, risk and defect are open (nothing exists yet to have a bug or a friction)",
    },
    askedWhen: "after scope is product",
  },
  {
    id: "facing",
    question: "Does it face a person's value, or the product's quality and obligations?",
    answers: {
      value: "bug, friction or need: weighed on the value pyramid",
      quality: "requirement, risk or defect: read against Kritik criteria",
    },
    askedWhen: "after door",
  },
  {
    id: "expectation",
    question: "Value-facing: was something expected to work that does not (broken), does it work as designed and still get in the way (as-designed), or is the value simply not there (absent)?",
    answers: {
      broken: "bug",
      "as-designed": "friction",
      absent: "need",
    },
    askedWhen: "facing is value",
  },
  {
    id: "threat",
    question: "Quality-facing: is it an obligation from outside (obligation), a flaw of our own making that leaves a threat (own-flaw), or a threat that can only be mitigated (mitigable-only)?",
    answers: {
      obligation: "requirement",
      "own-flaw": "defect",
      "mitigable-only": "risk",
    },
    askedWhen: "facing is quality",
  },
  {
    id: "basis",
    question: "Did the source say this (stated), or is it the analyst's hypothesis (inferred)?",
    answers: {
      stated: "carried through as stated",
      inferred: "a person must confirm before the species is trusted",
    },
    askedWhen: "optional; defaults to stated",
  },
];

export interface RoutingAnswers {
  scope?: QualifyScope;
  door?: QualifyDoor;
  facing?: QualifyFacing;
  expectation?: QualifyExpectation;
  threat?: QualifyThreat;
  basis?: QualifyBasis;
}

export type RoutingRoute =
  /** A species was reached: create or merge a stake. */
  | "stake"
  /** Not a stake (internal or off-scope); nothing is written and the signal stays in the journal. */
  | "internal"
  | "off-scope"
  /** The answers contradict the RFC (a bug or friction through the imagine door). Re-answer. */
  | "refused"
  /** More answers are needed; `ask` names them. */
  | "incomplete";

export interface SpeciesRouting {
  route: RoutingRoute;
  species?: StakeSpeciesId;
  /** The provenance the door implies: collect is observed, imagine is anticipated. */
  provenance?: StakeProvenanceId;
  /** On a refusal: the species to reroute as. */
  rerouteAs?: StakeSpeciesId;
  /** Question ids still to answer (route incomplete). */
  ask: RoutingQuestion["id"][];
  reasons: string[];
  /** What a person must confirm: every route out, every refusal, every inferred answer, every anticipated stake. */
  handToHuman: string[];
}

const SPECIES_BY_EXPECTATION: Record<QualifyExpectation, StakeSpeciesId> = { broken: "bug", "as-designed": "friction", absent: "need" };
const SPECIES_BY_THREAT: Record<QualifyThreat, StakeSpeciesId> = { obligation: "requirement", "own-flaw": "defect", "mitigable-only": "risk" };

function inList<T extends string>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

/**
 * The RFC § 3 decision as a table: facts in, a route out. An unknown answer
 * reads as unanswered, never as a guess. Anything routed out, refused,
 * inferred or anticipated (the imagine door) is handed to a person
 * (need-qualification § 6; RFC § 4: anticipated is inferred until confirmed).
 */
export function routeSpecies(answers: RoutingAnswers): SpeciesRouting {
  const handToHuman: string[] = [];
  const reasons: string[] = [];
  const out = (route: RoutingRoute, extra: Partial<SpeciesRouting> = {}): SpeciesRouting => ({ route, ask: [], reasons, handToHuman, ...extra });
  // A species was reached. An anticipated stake is inferred until a person confirms it (RFC § 4).
  const reached = (species: StakeSpeciesId, provenance: StakeProvenanceId): SpeciesRouting => {
    if (provenance === "anticipated") {
      handToHuman.push("Anticipated (imagine door): nobody has met this yet, so the stake is inferred until a person confirms it.");
    }
    return out("stake", { species, provenance });
  };

  const basis = inList(QUALIFY_BASES, answers.basis) ? answers.basis : "stated";
  if (basis === "inferred") handToHuman.push("The answers are inferred, not stated: a person confirms the species before it is trusted.");

  const scope = inList(QUALIFY_SCOPES, answers.scope) ? answers.scope : undefined;
  if (scope === undefined) return out("incomplete", { ask: ["scope"], reasons: ["scope is not answered"] });
  if (scope !== "product") {
    reasons.push(`Routed out as ${scope}: it is not a stake to weigh.`);
    handToHuman.push(`Routed out as ${scope}: a person can overrule it. Nothing is written; the signal stays in the journal.`);
    return out(scope);
  }

  const door = inList(QUALIFY_DOORS, answers.door) ? answers.door : undefined;
  if (door === undefined) return out("incomplete", { ask: ["door"], reasons: ["door is not answered"] });
  const provenance: StakeProvenanceId = door === "collect" ? "observed" : "anticipated";

  const facing = inList(QUALIFY_FACINGS, answers.facing) ? answers.facing : undefined;
  if (facing === undefined) return out("incomplete", { ask: ["facing"], provenance, reasons: ["facing is not answered"] });

  if (facing === "value") {
    const expectation = inList(QUALIFY_EXPECTATIONS, answers.expectation) ? answers.expectation : undefined;
    if (expectation === undefined) return out("incomplete", { ask: ["expectation"], provenance, reasons: ["expectation is not answered"] });
    const species = SPECIES_BY_EXPECTATION[expectation];
    if (door === "imagine" && !(ANTICIPATED_STAKE_SPECIES as readonly string[]).includes(species)) {
      reasons.push(`An anticipated stake is never a ${species}: nothing exists yet to have one. Reroute as need.`);
      handToHuman.push(`Refused: a ${species} cannot come through the imagine door. Reroute as need, or take the collect door if the product exists.`);
      return out("refused", { provenance, rerouteAs: "need" });
    }
    reasons.push(`Value-facing, ${expectation}: ${species}.`);
    return reached(species, provenance);
  }

  const threat = inList(QUALIFY_THREATS, answers.threat) ? answers.threat : undefined;
  if (threat === undefined) return out("incomplete", { ask: ["threat"], provenance, reasons: ["threat is not answered"] });
  const species = SPECIES_BY_THREAT[threat];
  reasons.push(`Quality-facing, ${threat}: ${species}.`);
  return reached(species, provenance);
}

// --- 2. Merge candidates --------------------------------------------------------

/** The signal as the matcher reads it: the routed species and the words, anchors and catalog id it carries. */
export interface SignalLike {
  /** The journal event the signal is, when it has one: lets the matcher notice a stake already citing it. */
  event_id?: string;
  title: string;
  verbatim?: string;
  /** The routed species: a signal only ever merges into a stake of the same species. */
  species: StakeSpeciesId;
  /** Nodes the signal is about (a flow, view, data model or endpoint). */
  node_ids?: readonly string[];
  /** A Kritik criterion id or a value id the signal comes from. */
  catalog_id?: string;
  source_kind?: SignalSourceKind;
}

export type MergeConfidence = "high" | "medium" | "low";

export interface MergeCandidate {
  stake_id: string;
  title: string;
  status: Node["status"];
  stake_species: StakeSpeciesId;
  /** 0 to 1, rounded to three places. 1 means a stake already cites this very signal. */
  score: number;
  confidence: MergeConfidence;
  reasons: string[];
  /** An archived stake is flagged, never hidden: a person decides whether to reopen it. */
  archived: boolean;
  /** The stake already cites this signal as evidence: merging again is a no-op. */
  alreadyCited: boolean;
  /** False for a benchmark: it joins as evidence but never counts toward frequency or mattering (RFC § 7). */
  countsAsEvidence: boolean;
}

/** Score at or above which a candidate reads high / medium; below LOW it is not returned. */
export const MERGE_HIGH = 0.6;
export const MERGE_MEDIUM = 0.35;
export const MERGE_LOW = 0.15;

/** Weights of the three soft signals; they sum to 1. */
const WEIGHT_CATALOG = 0.35;
const WEIGHT_ANCHOR = 0.25;
const WEIGHT_TEXT = 0.4;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "has", "not", "but", "can", "when", "you", "your", "its", "have", "had", "will", "would", "into", "than", "then", "they", "them", "there", "what", "which", "who", "how", "why", "all", "any", "out", "off", "too", "very", "just",
  "les", "des", "une", "pour", "que", "qui", "dans", "sur", "pas", "est", "mon", "mes", "son", "ses", "avec", "sans", "plus", "par",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of kebabCase(text).split("-")) {
    if (word.length >= 3 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** A stake's anchors: the targets of its outgoing `concerns` edges. */
export function stakeAnchors(stakeId: string, edges: readonly Pick<Edge, "source_id" | "target_id" | "edge_type">[]): string[] {
  const anchors = new Set<string>();
  for (const edge of edges) if (edge.edge_type === "concerns" && edge.source_id === stakeId) anchors.add(edge.target_id);
  return [...anchors].sort();
}

export interface MergeOptions {
  /** The graph's edges, so a stake's anchors can be read. Without them anchors do not score. */
  edges?: readonly Pick<Edge, "source_id" | "target_id" | "edge_type">[];
  /** At most this many candidates (default 5). */
  limit?: number;
}

/**
 * Stakes the signal could join, best first. A stake qualifies only when it is a
 * stake of the signal's own species (a need is never merged into a friction);
 * it is scored on three soft signals, a shared catalog id (weaker when the
 * anchors disagree: one criterion can raise several requirements), shared
 * anchors, and the words the two share. Order is deterministic (score, then
 * id). **This only proposes.** Nothing here merges, and the caller hands a
 * medium or low candidate to a person.
 */
export function findMergeCandidates(
  signal: SignalLike,
  stakes: readonly Pick<Node, "id" | "title" | "description" | "species" | "status" | "metadata">[],
  options: MergeOptions = {},
): MergeCandidate[] {
  const edges = options.edges ?? [];
  const signalAnchors = new Set(signal.node_ids ?? []);
  const signalWords = tokens(`${signal.title} ${signal.verbatim ?? ""}`);
  const found: MergeCandidate[] = [];

  for (const stake of stakes) {
    if (stake.species !== "stake" || stakeSpeciesOf(stake) !== signal.species) continue;
    const reasons: string[] = [];
    const alreadyCited = signal.event_id !== undefined && stakeEvidenceOf(stake).some((entry) => entry.event_id === signal.event_id);
    const anchors = new Set(stakeAnchors(stake.id, edges));

    let score = 0;
    if (alreadyCited) {
      score = 1;
      reasons.push("This stake already cites the signal as evidence.");
    } else {
      const anchorScore = jaccard(signalAnchors, anchors);
      const catalog = stakeCatalogOf(stake);
      const sameCatalog = signal.catalog_id !== undefined && catalog?.id === signal.catalog_id;
      // A catalog id alone is not identity: one criterion raises several
      // requirements (RFC § 5). Full weight only when an anchor is shared; with
      // no shared anchor (different, or one side or both unanchored) the match
      // is half weight, so it can never reach a merge suggestion on its own.
      const anchorsAgree = anchorScore > 0;
      if (sameCatalog) {
        score += anchorsAgree ? WEIGHT_CATALOG : WEIGHT_CATALOG / 2;
        reasons.push(
          anchorsAgree
            ? `Same catalog id (${signal.catalog_id}).`
            : signalAnchors.size > 0 && anchors.size > 0
              ? `Same catalog id (${signal.catalog_id}) but a different anchor: a related stake, not necessarily the same one.`
              : `Same catalog id (${signal.catalog_id}) but no anchor to confirm it: a related stake, not necessarily the same one.`,
        );
      }
      if (anchorScore > 0) {
        score += WEIGHT_ANCHOR * anchorScore;
        reasons.push(`Shares an anchor (${[...signalAnchors].filter((id) => anchors.has(id)).join(", ")}).`);
      }
      const textScore = jaccard(signalWords, tokens(`${stake.title} ${stake.description ?? ""}`));
      if (textScore > 0) {
        score += WEIGHT_TEXT * textScore;
        reasons.push(`Shares words with the title (${Math.round(textScore * 100)}% overlap).`);
      }
    }

    const rounded = round3(Math.min(score, 1));
    if (rounded < MERGE_LOW) continue;
    found.push({
      stake_id: stake.id,
      title: stake.title,
      status: stake.status,
      stake_species: signal.species,
      score: rounded,
      confidence: rounded >= MERGE_HIGH ? "high" : rounded >= MERGE_MEDIUM ? "medium" : "low",
      reasons,
      archived: stake.status === "archived",
      alreadyCited,
      countsAsEvidence: signal.source_kind !== "benchmark",
    });
  }

  found.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.stake_id < b.stake_id ? -1 : a.stake_id > b.stake_id ? 1 : 0));
  return found.slice(0, options.limit ?? 5);
}

// --- 3. Plans -----------------------------------------------------------------

/** What a plan needs to know about the signal it records. */
export interface QualificationSignal {
  /** The journal event id: the durable half of the signal to stake link. Absent for an inline signal. */
  event_id?: string;
  title: string;
  /** Becomes the evidence quote, exactly as voiced. */
  verbatim?: string;
  /** When it was voiced (ISO 8601). */
  date?: string;
  voice?: StakeEvidenceVoice;
}

export type QualificationAction = "create" | "merge" | "noop" | "refused";

export interface QualificationPlan {
  action: QualificationAction;
  /** The ops to apply, in order. Empty for a noop or a refusal. */
  ops: MutationOp[];
  /** The stake created, merged into, or already citing the signal. */
  stake_id?: string;
  /** Why a plan was refused, or why it did nothing. */
  reasons: string[];
  handToHuman: string[];
}

function evidenceEntryFor(signal: QualificationSignal): StakeEvidence {
  const entry: StakeEvidence = {
    ...(signal.event_id !== undefined ? { event_id: signal.event_id } : {}),
    ...(signal.verbatim !== undefined && signal.verbatim !== "" ? { quote: signal.verbatim } : {}),
    ...(signal.voice !== undefined ? { voice: signal.voice } : {}),
    ...(signal.date !== undefined ? { date: signal.date } : {}),
  };
  // An inline signal with nothing but a title would append an empty `{}`:
  // no information and no way to de-duplicate. The title is what was voiced.
  if (Object.keys(entry).length === 0) entry.quote = signal.title;
  return entry;
}

function refused(reasons: string[]): QualificationPlan {
  return { action: "refused", ops: [], reasons, handToHuman: [] };
}

/** The stake (if any), of any species, that already cites this event as evidence. */
export function stakeCiting(nodes: readonly Node[], eventId: string | undefined): Node | undefined {
  if (eventId === undefined) return undefined;
  return nodes.find((node) => node.species === "stake" && stakeEvidenceOf(node).some((entry) => entry.event_id === eventId));
}

export interface PlanToStakeInput {
  projectId: string;
  signal: QualificationSignal;
  species: StakeSpeciesId;
  provenance: StakeProvenanceId;
  /** Existing flow, view, data model or endpoint ids this stake concerns. May be empty: an unanchored stake is legal and warned about. */
  anchors?: readonly string[];
  /** The stake's own wording. Defaults to the signal's title; a qualifier should rewrite it positively and solution-neutrally. */
  title?: string;
  /** A catalog link. Its source must fit the species (Kritik for requirement, risk, defect; the value pyramid otherwise). */
  catalog?: StakeCatalogLink;
  nodes: readonly Node[];
  edges: readonly Edge[];
}

/**
 * Create a stake from a signal: one `create_node` (status idea, no platforms,
 * the species, provenance, catalog and a first evidence entry) and one
 * `concerns` edge per anchor. Refuses, instead of writing something the
 * validator would warn about, an anticipated bug or friction, a catalog link
 * from the wrong family, a value link whose id is not one of the pyramid's, and an anchor that does not exist or is not a flow,
 * view, data model or endpoint. A signal some stake already cites is a noop.
 */
export function planSignalToStake(input: PlanToStakeInput): QualificationPlan {
  const { signal, species, provenance, nodes } = input;
  const cited = stakeCiting(nodes, signal.event_id);
  if (cited !== undefined) {
    const citedSpecies = stakeSpeciesOf(cited);
    const handToHuman =
      citedSpecies !== species
        ? [`${cited.id} already cites this signal as ${citedSpecies === undefined ? "a stake with no species" : `a ${citedSpecies}`}, but it now routes as ${species}: a person decides which species is right.`]
        : [];
    return { action: "noop", ops: [], stake_id: cited.id, reasons: [`${cited.id} already cites this signal as evidence.`], handToHuman };
  }

  const problems: string[] = [];
  if (provenance === "anticipated" && !(ANTICIPATED_STAKE_SPECIES as readonly string[]).includes(species)) {
    problems.push(`An anticipated stake is never a ${species}: reroute as need.`);
  }
  if (input.catalog !== undefined && input.catalog.source !== catalogSourceForStakeSpecies(species)) {
    problems.push(`A ${species} links to the ${catalogSourceForStakeSpecies(species)} catalog, not ${input.catalog.source}.`);
  }
  if (input.catalog !== undefined && input.catalog.source === "values" && !(VALUE_IDS as readonly string[]).includes(input.catalog.id)) {
    problems.push(`"${input.catalog.id}" is not a value of the pyramid: a ${species} links to one of the 30 value ids.`);
  }
  const anchors = [...new Set(input.anchors ?? [])];
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  for (const anchor of anchors) {
    const target = byId.get(anchor);
    if (target === undefined) problems.push(`Anchor "${anchor}" does not exist.`);
    else if (!(STAKE_ANCHOR_SPECIES as readonly string[]).includes(target.species)) {
      problems.push(`Anchor "${anchor}" is a ${target.species}: a stake concerns a flow, view, data model or endpoint.`);
    }
  }
  const title = (input.title ?? signal.title).trim();
  if (title === "") problems.push("A stake needs a title.");
  if (problems.length > 0) return refused(problems);

  const id = deriveNodeId("stake", title, nodes.map((node) => node.id));
  const metadata = stakeMetadataWith(undefined, {
    stake_species: species,
    provenance,
    ...(input.catalog !== undefined ? { catalog: input.catalog } : {}),
  });
  metadata.evidence = [evidenceEntryFor(signal)];
  const node: Node = { id, project_id: input.projectId, title, species: "stake", status: "idea", platforms: [], metadata };

  const ops: MutationOp[] = [{ op: "create_node", node }];
  for (const anchor of anchors) {
    ops.push({ op: "create_edge", edge: { id: edgeId(id, anchor), project_id: input.projectId, source_id: id, target_id: anchor, edge_type: "concerns" } });
  }

  const handToHuman: string[] = [];
  if (anchors.length === 0) handToHuman.push("The stake has no anchor yet: name the flow, view, data model or endpoint it concerns.");
  if (input.title === undefined) handToHuman.push("The stake carries the signal's own title: reword it positively and solution-neutrally.");
  return { action: "create", ops, stake_id: id, reasons: [`Create ${id} (${species}, ${provenance}).`], handToHuman };
}

export interface PlanMergeInput {
  signal: QualificationSignal;
  /** The stake the signal joins. */
  target: Node;
  /** The routed species. When given, a target of another species is refused. */
  species?: StakeSpeciesId;
  nodes: readonly Node[];
}

/**
 * Append one evidence entry to an existing stake: a single `update_node` that
 * spreads the stake's metadata (a patch replaces metadata wholesale) and adds
 * the entry, de-duplicated by `event_id`. A signal the target already cites is
 * a noop, so re-running a plan changes nothing. An archived target is allowed
 * and handed to a person.
 */
export function planSignalMerge(input: PlanMergeInput): QualificationPlan {
  const { signal, target } = input;
  if (target.species !== "stake") return refused([`${target.id} is a ${target.species}, not a stake.`]);
  const targetSpecies = stakeSpeciesOf(target);
  if (input.species !== undefined && targetSpecies !== input.species) {
    return refused([`${target.id} is ${targetSpecies === undefined ? "a stake with no species" : `a ${targetSpecies}`}; the signal routes to ${input.species}. A signal never merges across species.`]);
  }

  const existing = stakeEvidenceOf(target);
  if (signal.event_id !== undefined && existing.some((entry) => entry.event_id === signal.event_id)) {
    return { action: "noop", ops: [], stake_id: target.id, reasons: [`${target.id} already cites this signal as evidence.`], handToHuman: [] };
  }
  const other = stakeCiting(input.nodes, signal.event_id);
  const handToHuman: string[] = [];
  if (other !== undefined) handToHuman.push(`${other.id} also cites this signal: the same signal now backs two stakes.`);
  if (target.status === "archived") handToHuman.push(`${target.id} is archived: a person decides whether the new evidence reopens it.`);

  const metadata = { ...(target.metadata ?? {}), evidence: [...existing, evidenceEntryFor(signal)] };
  return {
    action: "merge",
    ops: [{ op: "update_node", node_id: target.id, patch: { metadata } }],
    stake_id: target.id,
    reasons: [`Append evidence to ${target.id}.`],
    handToHuman,
  };
}

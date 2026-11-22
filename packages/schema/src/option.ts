/**
 * The option species — one way to address a stake
 * (docs/rfcs/stake-architecture.md § 14, docs/superpowers/specs/2026-11-22-stake-architecture-parts-5-6-design.md).
 *
 * An option never exists without a stake: it points at the stake it addresses
 * with an outgoing `addresses` edge. Like a stake it carries no platforms and
 * stores only three lifecycle values (idea, discovery, archived). Whether it
 * was selected or closed is read from the decision that settled the stake, never
 * stored on the option. Its answer type (fix, enhancement, feature, diligence,
 * mitigation or resolution) is read from the kind of stake it addresses and is
 * never stored either.
 *
 * Like stake.ts this module is deliberately zod-free (type-only imports) so it
 * bundles into the standalone validator and stays browser-safe.
 */

import type { Edge, Node } from "./bundle";
import { STAKE_LIFECYCLE_STATUSES, stakeSpeciesOf, type StakeSpeciesId } from "./stake";

/** The only node `status` values an option stores. Selected, closed and open are derived from the decision. */
export const OPTION_LIFECYCLE_STATUSES = STAKE_LIFECYCLE_STATUSES;
export type OptionLifecycleStatus = (typeof OPTION_LIFECYCLE_STATUSES)[number];

/** What kind of answer an option is, set by the kind of stake it addresses (RFC § 3). */
export const ANSWER_TYPE_IDS = ["fix", "enhancement", "feature", "diligence", "mitigation", "resolution"] as const;
export type AnswerTypeId = (typeof ANSWER_TYPE_IDS)[number];

/** The answer type each stake species asks for. A table, so nothing is stored on the option. */
export const ANSWER_TYPE_FOR_STAKE_SPECIES: Record<StakeSpeciesId, AnswerTypeId> = {
  bug: "fix",
  friction: "enhancement",
  need: "feature",
  requirement: "diligence",
  risk: "mitigation",
  defect: "resolution",
};

/** One option that lost, with the reason it lost (`metadata.closed_options[]` on a decision). */
export interface ClosedOption {
  option_id: string;
  reason: string;
}

type EdgeLike = Pick<Edge, "source_id" | "target_id" | "edge_type">;
type NodeLike = Pick<Node, "id" | "species" | "metadata">;

/** The answer type a stake asks for, or undefined when its kind is missing or unknown. */
export function answerTypeForStake(stake: Pick<Node, "metadata">): AnswerTypeId | undefined {
  const species = stakeSpeciesOf(stake);
  return species === undefined ? undefined : ANSWER_TYPE_FOR_STAKE_SPECIES[species];
}

/** The id of the request.filed event that seeded an option, when a non-empty string, else undefined. */
export function optionSuggestedByOf(node: Pick<Node, "metadata">): string | undefined {
  const raw = node.metadata?.suggested_by;
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/** A decision's closed options, keeping only well-formed entries (a stray scalar or an entry without an option id or a reason is skipped). */
export function closedOptionsOf(decision: Pick<Node, "metadata">): ClosedOption[] {
  const raw = decision.metadata?.closed_options;
  if (!Array.isArray(raw)) return [];
  const kept: ClosedOption[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { option_id, reason } = entry as { option_id?: unknown; reason?: unknown };
    if (typeof option_id !== "string" || option_id === "" || typeof reason !== "string") continue;
    kept.push({ option_id, reason });
  }
  return kept;
}

/** The stakes an option addresses, in edge order, each once. */
export function stakesAddressedBy<N extends NodeLike>(optionId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const found: N[] = [];
  for (const edge of edges) {
    if (edge.edge_type !== "addresses" || edge.source_id !== optionId || seen.has(edge.target_id)) continue;
    const target = byId.get(edge.target_id);
    if (target?.species !== "stake") continue;
    seen.add(edge.target_id);
    found.push(target);
  }
  return found;
}

/** The options that address a stake, in edge order, each once. An acceptance that addresses the stake is not an option and is left out. */
export function optionsAddressing<N extends NodeLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const found: N[] = [];
  for (const edge of edges) {
    if (edge.edge_type !== "addresses" || edge.target_id !== stakeId || seen.has(edge.source_id)) continue;
    const source = byId.get(edge.source_id);
    if (source?.species !== "option") continue;
    seen.add(edge.source_id);
    found.push(source);
  }
  return found;
}

/** The distinct answer types of the stakes an option addresses, in {@link ANSWER_TYPE_IDS} order. More than one is a warning. */
export function answerTypesOf(optionId: string, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): AnswerTypeId[] {
  const types = new Set<AnswerTypeId>();
  for (const stake of stakesAddressedBy(optionId, nodes, edges)) {
    const type = answerTypeForStake(stake);
    if (type !== undefined) types.add(type);
  }
  return ANSWER_TYPE_IDS.filter((id) => types.has(id));
}

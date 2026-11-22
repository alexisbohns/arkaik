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
 * Part B adds the decision half: the readers that say which option answers a
 * stake, whether an option is selected, closed or open, and which acceptances
 * read as promises, and the planner that writes a decision selecting an option.
 * All of it is derived from the graph; nothing but the decision and its two
 * edges is ever stored.
 *
 * Like stake.ts this module is deliberately zod-free (type-only imports) so it
 * bundles into the standalone validator and stays browser-safe.
 */

import { resolvePlatformStatus } from "./acceptance";
import type { Edge, Node } from "./bundle";
import { decisionStatusOf, lifecycleStatusForDecision } from "./decision";
import { deriveNodeId, edgeId } from "./id-gen";
import type { MutationOp } from "./mutate";
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

// --- The decision: answer, closure, promises ---------------------------------

type DecisionNodeLike = Pick<Node, "id" | "species" | "metadata">;

/** The decision statuses in which a decision settles its stake (RFC § 14.0 call 3). A proposed, rejected, deprecated or superseded decision settles nothing. */
const SETTLING_DECISION_STATUSES: readonly string[] = ["approved", "enacted"];

/** The targets of `source`'s outgoing edges of one type, in edge order, each once. */
function targetsOf(sourceId: string, edgeType: Edge["edge_type"], edges: readonly EdgeLike[]): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const edge of edges) {
    if (edge.edge_type !== edgeType || edge.source_id !== sourceId || seen.has(edge.target_id)) continue;
    seen.add(edge.target_id);
    found.push(edge.target_id);
  }
  return found;
}

/** The sources of edges of one type into `targetId`, in edge order, each once. */
function sourcesOf(targetId: string, edgeType: Edge["edge_type"], edges: readonly EdgeLike[]): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const edge of edges) {
    if (edge.edge_type !== edgeType || edge.target_id !== targetId || seen.has(edge.source_id)) continue;
    seen.add(edge.source_id);
    found.push(edge.source_id);
  }
  return found;
}

/** True when a decision settles its stake: it reads approved or enacted. */
export function isSettlingDecision(decision: Pick<Node, "metadata">): boolean {
  return SETTLING_DECISION_STATUSES.includes(decisionStatusOf(decision));
}

/** The time a decision was taken, in ms. An absent or unparseable `decided_at` reads as the oldest. */
function decidedAtMs(decision: Pick<Node, "metadata">): number {
  const raw = decision.metadata?.decided_at;
  const ms = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Latest first: by `decided_at`, then by id, so the order never depends on node order. */
function latestFirst<N extends DecisionNodeLike>(a: N, b: N): number {
  const byDate = decidedAtMs(b) - decidedAtMs(a);
  if (byDate !== 0 && !Number.isNaN(byDate)) return byDate;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The decisions with an `impacts` edge to a stake, in any status, in node order. */
export function decisionsImpacting<N extends DecisionNodeLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const impacting = new Set(sourcesOf(stakeId, "impacts", edges));
  return nodes.filter((node) => node.species === "decision" && impacting.has(node.id));
}

/**
 * The decisions that settle a stake (approved or enacted, with an `impacts` edge
 * to it), latest first. The validator warns when there is more than one; the
 * readers below take the first and report the rest as `competing`.
 */
export function settlingDecisionsFor<N extends DecisionNodeLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  return decisionsImpacting(stakeId, nodes, edges).filter(isSettlingDecision).sort(latestFirst);
}

/** The options a decision generates, in edge order. */
export function optionsGeneratedBy<N extends NodeLike>(decisionId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const found: N[] = [];
  for (const id of targetsOf(decisionId, "generates", edges)) {
    const target = byId.get(id);
    if (target?.species === "option") found.push(target);
  }
  return found;
}

/** The answer to a stake: the option its settling decision generates. */
export interface StakeAnswer<N> {
  decision: N;
  option: N;
  /** Other settling decisions for the same stake. Not empty means the data is ambiguous (the validator warns); the latest decision was taken. */
  competing: string[];
}

/**
 * The option that answers a stake: the one its settling decision generates.
 * Undefined when no decision settles the stake, or the settling decision
 * generates no option. With two settling decisions the latest one wins, by
 * `decided_at` then id, and the others are named in `competing`.
 */
export function answerFor<N extends NodeLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): StakeAnswer<N> | undefined {
  const [latest, ...rest] = settlingDecisionsFor(stakeId, nodes, edges);
  if (latest === undefined) return undefined;
  const option = optionsGeneratedBy(latest.id, nodes, edges)[0];
  return option === undefined ? undefined : { decision: latest, option, competing: rest.map((decision) => decision.id) };
}

export type OptionClosureState = "selected" | "closed" | "open";

/** Where an option stands for one stake. */
export interface OptionClosure {
  state: OptionClosureState;
  /** The settling decision, when there is one. */
  decision_id?: string;
  /** Why a closed option lost, from the decision's `closed_options`. Absent when none was given. */
  reason?: string;
  /** Other settling decisions for the same stake: the data is ambiguous and the latest was read. */
  competing: string[];
}

/**
 * An option's closure for one stake, read from the stake's settling decision and
 * never stored: `selected` when the decision generates it, `closed` when the
 * decision generates another option (with the reason from `closed_options`, if
 * it gave one), `open` otherwise. A decision that is proposed, rejected,
 * deprecated or superseded settles nothing, so the option reopens.
 */
export function optionClosureFor(optionId: string, stakeId: string, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): OptionClosure {
  const [latest, ...rest] = settlingDecisionsFor(stakeId, nodes, edges);
  if (latest === undefined) return { state: "open", competing: [] };
  const competing = rest.map((decision) => decision.id);
  const generated = optionsGeneratedBy(latest.id, nodes, edges);
  if (generated.length === 0) return { state: "open", decision_id: latest.id, competing };
  if (generated.some((option) => option.id === optionId)) return { state: "selected", decision_id: latest.id, competing };
  const reason = closedOptionsOf(latest).find((entry) => entry.option_id === optionId)?.reason;
  return { state: "closed", decision_id: latest.id, ...(reason !== undefined && reason !== "" ? { reason } : {}), competing };
}

type AcceptanceLike = Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">;

/** The acceptances with an `addresses` edge to a stake or an option, in edge order. */
export function acceptancesAddressing<N extends NodeLike>(targetId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const found: N[] = [];
  for (const id of sourcesOf(targetId, "addresses", edges)) {
    const source = byId.get(id);
    if (source?.species === "acceptance") found.push(source);
  }
  return found;
}

/**
 * True when an acceptance reads as a promise (RFC § 14.0 call 4): an approved or
 * enacted decision generates it, directly or through an option it addresses, or
 * it already resolves to `live` on a platform it applies to. An archived
 * acceptance is never a promise. Derived, never stored.
 */
export function isPromise(acceptance: AcceptanceLike, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): boolean {
  if (acceptance.species !== "acceptance" || acceptance.status === "archived") return false;
  if (acceptance.platforms.some((platform) => resolvePlatformStatus(acceptance, platform) === "live")) return true;
  const settling = new Set(nodes.filter((n) => n.species === "decision" && isSettlingDecision(n)).map((n) => n.id));
  if (sourcesOf(acceptance.id, "generates", edges).some((id) => settling.has(id))) return true;
  const options = new Set(targetsOf(acceptance.id, "addresses", edges));
  if (options.size === 0) return false;
  return edges.some((edge) => edge.edge_type === "generates" && settling.has(edge.source_id) && options.has(edge.target_id));
}

/**
 * True when an acceptance is a candidate: it sits at `idea` or `discovery` and no
 * decision has chosen it. A candidate that a decision later chooses becomes a
 * promise; nothing about the acceptance changes.
 */
export function isCandidate(acceptance: AcceptanceLike, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): boolean {
  if (acceptance.species !== "acceptance") return false;
  if (acceptance.status !== "idea" && acceptance.status !== "discovery") return false;
  return !isPromise(acceptance, nodes, edges);
}

/**
 * The promises of a stake: the acceptances that address the option answering it
 * (they read as promises because the decision chose that option), plus the
 * acceptances that address the stake directly and read as promises on their own
 * (the quick win nobody debated). Archived acceptances are left out. Empty when
 * no decision has answered the stake and nothing addresses it directly.
 */
export function promisesOf<N extends NodeLike & AcceptanceLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const found = new Map<string, N>();
  const answer = answerFor(stakeId, nodes, edges);
  if (answer !== undefined) {
    for (const acceptance of acceptancesAddressing(answer.option.id, nodes, edges)) {
      if (acceptance.status !== "archived") found.set(acceptance.id, acceptance);
    }
  }
  for (const acceptance of acceptancesAddressing(stakeId, nodes, edges)) {
    if (isPromise(acceptance, nodes, edges)) found.set(acceptance.id, acceptance);
  }
  return [...found.values()];
}

/**
 * The candidates for a stake: the acceptances at `idea` or `discovery` that
 * address it, or an option addressing it, and that no decision has chosen.
 */
export function candidatesFor<N extends NodeLike & AcceptanceLike>(stakeId: string, nodes: readonly N[], edges: readonly EdgeLike[]): N[] {
  const found = new Map<string, N>();
  const targets = [stakeId, ...optionsAddressing(stakeId, nodes, edges).map((option) => option.id)];
  for (const target of targets) {
    for (const acceptance of acceptancesAddressing(target, nodes, edges)) {
      if (isCandidate(acceptance, nodes, edges)) found.set(acceptance.id, acceptance);
    }
  }
  return [...found.values()];
}

// --- The planner: select an option for a stake --------------------------------

export interface SelectOptionInput {
  projectId: string;
  stakeId: string;
  optionId: string;
  /** Why this option: the decision's context. Required. */
  reason: string;
  /** Why each loser lost. Every other non-archived option addressing the stake is closed even when it is not named here. */
  closed?: readonly ClosedOption[];
  /** The decision's title. Defaults to `Select "<option>" for "<stake>"`. */
  title?: string;
  /** The decision's status. Default approved. */
  status?: "approved" | "enacted";
  /** Required when the stake already has a settling decision: that decision becomes superseded. */
  supersede?: boolean;
  /** An ISO 8601 date, written to `metadata.decided_at`. */
  decidedAt?: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
}

export type SelectOptionAction = "decide" | "refused";

export interface SelectOptionPlan {
  action: SelectOptionAction;
  /** The ops to apply, in order. Empty for a refusal. */
  ops: MutationOp[];
  /** The decision created. */
  decision_id?: string;
  /** Why the plan was refused, or what it supersedes. */
  reasons: string[];
  /** What a person should still do: the closing reasons the planner had to default. */
  handToHuman: string[];
}

function refusedSelection(reasons: string[]): SelectOptionPlan {
  return { action: "refused", ops: [], reasons, handToHuman: [] };
}

/**
 * Select an option for a stake: create the decision (approved by default, with
 * the reason as its context and every loser's reason in `closed_options`), its
 * `impacts` edge to the stake and its `generates` edge to the option. With
 * `supersede`, the stake's earlier settling decision is first updated to
 * `superseded` through `update_node`, so the journal records
 * `decision.status_changed`, and the new decision gets a `supersedes` edge to it.
 *
 * Refuses, instead of writing something the validator would warn about, when the
 * stake or option is missing or the wrong species, the option does not address
 * the stake or is archived, the reason is empty, the stake already has a settling
 * decision and `supersede` is not set, or a closed entry names an option that
 * does not address the stake (or the selected option itself).
 */
export function planSelectOption(input: SelectOptionInput): SelectOptionPlan {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const stake = byId.get(input.stakeId);
  const option = byId.get(input.optionId);
  const status = input.status ?? "approved";
  const reason = input.reason.trim();
  const problems: string[] = [];

  if (stake === undefined) problems.push(`No node with id "${input.stakeId}".`);
  else if (stake.species !== "stake") problems.push(`"${input.stakeId}" is a ${stake.species}, not a stake.`);
  if (option === undefined) problems.push(`No node with id "${input.optionId}".`);
  else if (option.species !== "option") problems.push(`"${input.optionId}" is a ${option.species}, not an option.`);
  if (status !== "approved" && status !== "enacted") problems.push(`A decision is created at approved or enacted, not "${String(status)}".`);
  if (reason === "") problems.push("A decision needs a reason: say why this option was chosen.");
  if (problems.length > 0 || stake === undefined || option === undefined) return refusedSelection(problems);

  const addressing = optionsAddressing(stake.id, input.nodes, input.edges);
  if (!addressing.some((candidate) => candidate.id === option.id)) {
    problems.push(`Option "${option.id}" does not address stake "${stake.id}": add the addresses edge first.`);
  }
  if (option.status === "archived") problems.push(`Option "${option.id}" is archived: an archived option cannot be selected.`);

  const settling = settlingDecisionsFor(stake.id, input.nodes, input.edges);
  if (settling.length > 0 && input.supersede !== true) {
    problems.push(
      `Stake "${stake.id}" already has a settling decision (${settling.map((d) => d.id).join(", ")}): pass supersede to replace it.`,
    );
  }

  const addressingIds = new Set(addressing.map((candidate) => candidate.id));
  const closed = new Map<string, string>();
  for (const entry of input.closed ?? []) {
    if (entry.option_id === option.id) {
      problems.push(`"${option.id}" is the selected option and cannot also be closed.`);
    } else if (!addressingIds.has(entry.option_id)) {
      problems.push(`Closed option "${entry.option_id}" does not address stake "${stake.id}".`);
    } else if (!closed.has(entry.option_id)) {
      closed.set(entry.option_id, entry.reason.trim());
    }
  }
  if (problems.length > 0) return refusedSelection(problems);

  const handToHuman: string[] = [];
  const closedOptions: ClosedOption[] = [];
  for (const [optionId, given] of closed) closedOptions.push({ option_id: optionId, reason: given });
  for (const other of addressing) {
    if (other.id === option.id || other.status === "archived" || closed.has(other.id)) continue;
    closedOptions.push({ option_id: other.id, reason: "" });
  }
  for (const entry of closedOptions) {
    if (entry.reason !== "") continue;
    entry.reason = `Not selected: "${option.title}" was chosen.`;
    handToHuman.push(`No reason was given for closing "${byId.get(entry.option_id)?.title ?? entry.option_id}" (${entry.option_id}): the default reason was recorded. Write the real one.`);
  }

  const title = input.title !== undefined && input.title.trim() !== "" ? input.title.trim() : `Select "${option.title}" for "${stake.title}"`;
  const decisionId = deriveNodeId("decision", title, input.nodes.map((n) => n.id));
  const ops: MutationOp[] = [];
  const reasons: string[] = [];

  if (input.supersede === true) {
    for (const previous of settling) {
      const was = decisionStatusOf(previous);
      ops.push({
        op: "update_node",
        node_id: previous.id,
        patch: {
          status: lifecycleStatusForDecision("superseded"),
          metadata: { ...(byId.get(previous.id)?.metadata ?? {}), decision_status: "superseded" },
        },
      });
      reasons.push(`Supersedes ${previous.id} (it was ${was}).`);
    }
  }

  ops.push({
    op: "create_node",
    node: {
      id: decisionId,
      project_id: input.projectId,
      title,
      species: "decision",
      status: lifecycleStatusForDecision(status),
      platforms: [],
      metadata: {
        decision_status: status,
        context: reason,
        ...(input.decidedAt !== undefined && input.decidedAt !== "" ? { decided_at: input.decidedAt } : {}),
        ...(closedOptions.length > 0 ? { closed_options: closedOptions } : {}),
      },
    },
  });
  ops.push({
    op: "create_edge",
    edge: { id: edgeId(decisionId, stake.id), project_id: input.projectId, source_id: decisionId, target_id: stake.id, edge_type: "impacts" },
  });
  ops.push({
    op: "create_edge",
    edge: { id: edgeId(decisionId, option.id), project_id: input.projectId, source_id: decisionId, target_id: option.id, edge_type: "generates" },
  });
  if (input.supersede === true) {
    for (const previous of settling) {
      ops.push({
        op: "create_edge",
        edge: { id: edgeId(decisionId, previous.id), project_id: input.projectId, source_id: decisionId, target_id: previous.id, edge_type: "supersedes" },
      });
    }
  }

  return { action: "decide", ops, decision_id: decisionId, reasons, handToHuman };
}

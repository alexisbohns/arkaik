/**
 * A decision's panel as data: where it stands and since when, its reasoning,
 * the replacement line through it, and the two ways the data can disagree with
 * itself — so the panel renders a model and never re-derives a rule.
 *
 * Built twice per panel, deliberately: from the COMMITTED node for what does
 * not move while you type (the header's chip, the lineage), and from the
 * editor's optimistic status and typed text for the verdict and the reasoning,
 * which must follow the keyboard rather than the round trip.
 */
import type { Edge, Node } from "@/lib/data/types";
import { decisionStatusOf, type DecisionStatusId } from "@/lib/utils/decision";
import { DECISION_STATUS_LABEL, formatDecidedInstant } from "@/lib/utils/decision-log";

export interface DecisionLineageEntry {
  node: Node;
  status: DecisionStatusId;
  statusLabel: string;
  dateLabel: string | null;
  /** Newer decisions that replaced this one are successors; older ones it replaced, predecessors. */
  relation: "successor" | "self" | "predecessor";
  /** Hops from this decision (0 = itself). */
  depth: number;
}

export interface DecisionPanelModel {
  status: DecisionStatusId;
  statusLabel: string;
  /** The authored `decided_at` (YYYY-MM-DD), or "". */
  decidedAt: string;
  decidedLabel: string | null;
  context: string;
  consequences: string;
  /** Resolved `supersedes` neighbours (an id no node answers to is dropped). */
  supersedes: Node[];
  supersededBy: Node[];
  /**
   * The whole replacement line through this decision, newest first: every
   * successor (transitively), this one, every predecessor (transitively).
   * Length 1 means it stands alone. Cycle-safe: a decision is listed once.
   */
  lineage: DecisionLineageEntry[];
  /** Marked superseded, but nothing replaces it. */
  supersededWithoutSuccessor: boolean;
  /** Another decision replaced it, yet it is still on the road (not marked superseded). */
  replacedButNotSuperseded: boolean;
  /** No save path: render facts, never dead controls. */
  readOnly: boolean;
}

export function buildDecisionPanel(
  node: Node,
  opts: {
    status: DecisionStatusId;
    decidedAt: string;
    context: string;
    consequences: string;
    allNodes?: Node[];
    allEdges?: Edge[];
    readOnly: boolean;
  },
): DecisionPanelModel {
  const { status } = opts;
  const byId = new Map((opts.allNodes ?? []).map((n) => [n.id, n]));
  // `supersedes` points new → old: `replaces` walks to predecessors, `replacedBy` to successors.
  const replaces = new Map<string, string[]>();
  const replacedBy = new Map<string, string[]>();
  for (const e of opts.allEdges ?? []) {
    if (e.edge_type !== "supersedes") continue;
    replaces.set(e.source_id, [...(replaces.get(e.source_id) ?? []), e.target_id]);
    replacedBy.set(e.target_id, [...(replacedBy.get(e.target_id) ?? []), e.source_id]);
  }
  const resolve = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => byId.get(id)).filter((n): n is Node => n !== undefined);
  const supersedes = resolve(replaces.get(node.id));
  const supersededBy = resolve(replacedBy.get(node.id));

  const dateOf = (n: Node) =>
    typeof n.metadata?.decided_at === "string" ? formatDecidedInstant(n.metadata.decided_at) : null;
  const seen = new Set<string>([node.id]);
  function walk(
    from: string,
    edges: Map<string, string[]>,
    relation: "successor" | "predecessor",
    depth: number,
    into: DecisionLineageEntry[],
  ) {
    for (const id of edges.get(from) ?? []) {
      if (seen.has(id)) continue;
      const n = byId.get(id);
      if (!n) continue;
      seen.add(id);
      const s = decisionStatusOf(n);
      into.push({ node: n, status: s, statusLabel: DECISION_STATUS_LABEL[s], dateLabel: dateOf(n), relation, depth });
      walk(id, edges, relation, depth + 1, into);
    }
  }
  const successors: DecisionLineageEntry[] = [];
  walk(node.id, replacedBy, "successor", 1, successors);
  const predecessors: DecisionLineageEntry[] = [];
  walk(node.id, replaces, "predecessor", 1, predecessors);
  const decidedLabel = opts.decidedAt ? formatDecidedInstant(opts.decidedAt) : null;

  return {
    status,
    statusLabel: DECISION_STATUS_LABEL[status],
    decidedAt: opts.decidedAt,
    decidedLabel,
    context: opts.context,
    consequences: opts.consequences,
    supersedes,
    supersededBy,
    lineage: [
      ...successors.sort((a, b) => b.depth - a.depth),
      { node, status, statusLabel: DECISION_STATUS_LABEL[status], dateLabel: decidedLabel, relation: "self", depth: 0 },
      ...predecessors.sort((a, b) => a.depth - b.depth),
    ],
    supersededWithoutSuccessor: status === "superseded" && supersededBy.length === 0,
    replacedButNotSuperseded: supersededBy.length > 0 && status !== "superseded",
    readOnly: opts.readOnly,
  };
}

/** The panel model from the committed node alone — for what does not follow the keyboard. */
export function committedDecisionPanel(node: Node, allNodes: Node[] | undefined, allEdges: Edge[] | undefined, readOnly: boolean) {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return buildDecisionPanel(node, {
    status: decisionStatusOf(node),
    decidedAt: text(node.metadata?.decided_at),
    context: text(node.metadata?.context),
    consequences: text(node.metadata?.consequences),
    allNodes,
    allEdges,
    readOnly,
  });
}

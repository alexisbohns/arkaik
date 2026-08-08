/**
 * Decision-status editing helpers, as pure functions over plain data — the
 * `blocked.ts` pattern. The one write path for a decision transition: the
 * metadata write and the lifecycle sync travel in the same patch, so the
 * journal derivation (diffNodeUpdate) sees both and emits
 * decision.status_changed + node.status_changed together (spec §4).
 */

import { decisionStatusOf, lifecycleStatusForDecision, type DecisionStatusId } from "@arkaik/schema";
import type { Node, NodeMetadata } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";

export { decisionStatusOf, DECISION_STATUS_IDS, type DecisionStatusId } from "@arkaik/schema";

/**
 * How many of these decisions carry each status.
 *
 * Lives here rather than in the bar that renders it because the bar is now one
 * level up from the list: the toolbar and the log are siblings under the page, so
 * the count has to be derived once by their common owner instead of twice.
 * Statuses with no decisions are absent rather than zero — a caller reading with
 * `?? 0` gets the same answer, and building seven entries to say "none" is work
 * for nothing.
 */
export function decisionStatusCounts(decisions: readonly Node[]): Map<DecisionStatusId, number> {
  const counts = new Map<DecisionStatusId, number>();
  for (const decision of decisions) {
    const status = decisionStatusOf(decision);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

/** This node's metadata with `decision_status` set; the rest carried through untouched. */
export function withDecisionStatus(
  metadata: NodeMetadata | undefined,
  decisionStatus: DecisionStatusId,
): NodeMetadata {
  return { ...(metadata ?? {}), decision_status: decisionStatus };
}

/**
 * The full update patch for a decision transition: the new decision_status
 * plus the synced lifecycle status, in one `updateNode` call.
 */
export function decisionUpdatePatch(
  node: Pick<Node, "metadata">,
  decisionStatus: DecisionStatusId,
): { status: StatusId; metadata: NodeMetadata } {
  return {
    status: lifecycleStatusForDecision(decisionStatus),
    metadata: withDecisionStatus(node.metadata, decisionStatus),
  };
}

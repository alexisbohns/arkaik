/**
 * Decision-status editing helpers, as pure functions over plain data — the
 * `blocked.ts` pattern. The one write path for a decision transition: the
 * metadata write and the lifecycle sync travel in the same patch, so the
 * journal derivation (diffNodeUpdate) sees both and emits
 * decision.status_changed + node.status_changed together (spec §4).
 */

import { lifecycleStatusForDecision, type DecisionStatusId } from "@arkaik/schema";
import type { Node, NodeMetadata } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";

export { decisionStatusOf, DECISION_STATUS_IDS, type DecisionStatusId } from "@arkaik/schema";

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

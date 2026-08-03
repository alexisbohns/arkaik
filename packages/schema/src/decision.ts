/**
 * The decision species — ADR-style records (cycle 2,
 * docs/superpowers/specs/2026-08-03-decisions-species-design.md).
 *
 * Decision statuses are NOT node lifecycle statuses: they live in
 * `metadata.decision_status` (the acceptance precedent — platformStatuses),
 * and the node's global `status` is kept in sync at write time via
 * {@link lifecycleStatusForDecision}. Like acceptance.ts, this module is
 * deliberately zod-free (type-only imports) so it bundles into standalone
 * tools and stays browser-safe; enums.ts wraps the id list in zod.
 */

import type { StatusId } from "./ids";
import type { Node } from "./bundle";

/** Decision statuses, in the usual path order; the last three are terminal. */
export const DECISION_STATUS_IDS = [
  "proposed",
  "approved",
  "enacted",
  "rejected",
  "deprecated",
  "superseded",
] as const;
export type DecisionStatusId = (typeof DECISION_STATUS_IDS)[number];

/**
 * The lifecycle status a decision node's global `status` field should carry
 * for a given decision status (spec §2). Applied by writers (the app's
 * decision editor, agents, the CLI); the validator cross-checks it as a
 * warning, never an error.
 *
 * `approved → backlog` is the load-bearing row: agreed but not yet reality is
 * exactly what `backlog` ("ready to be delivered") means.
 */
export function lifecycleStatusForDecision(decisionStatus: DecisionStatusId): StatusId {
  switch (decisionStatus) {
    case "proposed":
      return "discovery";
    case "approved":
      return "backlog";
    case "enacted":
      return "live";
    case "rejected":
    case "deprecated":
    case "superseded":
      return "archived";
  }
}

/**
 * A node's decision status as it should be read: the stored value when it is
 * in the vocabulary, else `proposed` — a decision missing the field, or
 * carrying an unknown value, renders as proposed rather than crashing
 * (spec §9).
 */
export function decisionStatusOf(node: Pick<Node, "metadata">): DecisionStatusId {
  const raw = node.metadata?.decision_status;
  return (DECISION_STATUS_IDS as readonly string[]).includes(raw as string)
    ? (raw as DecisionStatusId)
    : "proposed";
}

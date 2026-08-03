"use client";

import { useMemo } from "react";
import type { MutationOp } from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import {
  planAcceptanceAttach,
  planAcceptanceDetach,
  planAcceptanceSplit,
  planAnchorForAcceptance,
} from "@/lib/utils/acceptance-intake";

/**
 * The four gestures acceptance-first intake needs, bound to one surface's data.
 *
 * A single object rather than four props because it is one capability: a panel
 * either can decompose an idea or it cannot, and threading four callbacks
 * through the shell, the panel grid and the detail panel would be four chances
 * for a surface to end up half-wired — a Covers list that can attach but not
 * detach is worse than one that does neither.
 */
export interface AcceptanceIntake {
  /** Cover an existing view or flow. A no-op if it is already covered. */
  attach(acceptance: Node, anchor: Node): Promise<void>;
  /** Stop covering one anchor. The anchor itself is untouched. */
  detach(acceptance: Node, anchorId: string): Promise<void>;
  /**
   * Create the view or flow *and* cover it, as one write. Resolves to the new
   * node so the caller can open it, or to `null` when the title was blank.
   */
  createAnchor(acceptance: Node, species: "view" | "flow", title: string): Promise<Node | null>;
  /** Split into the given pieces — the first renames, the rest are created. */
  split(acceptance: Node, titles: readonly string[]): Promise<void>;
}

interface AcceptanceIntakeParams {
  projectId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** `useNodes`'s atomic batch — every gesture here is more than one write. */
  applyMutations: (ops: MutationOp[]) => Promise<{ nodes: Node[]; edges: Edge[] }>;
  /** `useEdges`'s adopt-the-batch-result, since `applyMutations` owns only nodes. */
  syncEdges: (edges: Edge[]) => void;
}

/**
 * Bind the intake rules to a surface's node/edge state.
 *
 * The rules themselves live in `lib/utils/acceptance-intake.ts` and are asserted
 * there; this hook only turns a plan into a write and keeps both halves of the
 * surface's local state in step afterwards. A plan with no ops is not written at
 * all — every one of these gestures has a legitimate no-op case (an anchor
 * already covered, a blank title, a split into one piece), and an empty batch
 * would still be a round-trip and a journal read.
 *
 * Every page that lets a panel *edit* passes one of these; pages whose panels
 * are read-only pass none, and the Covers list renders exactly as it did before.
 */
export function useAcceptanceIntake({
  projectId,
  nodes,
  edges,
  applyMutations,
  syncEdges,
}: AcceptanceIntakeParams): AcceptanceIntake {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return useMemo(() => {
    async function commit(ops: MutationOp[]): Promise<void> {
      if (ops.length === 0) return;
      const result = await applyMutations(ops);
      syncEdges(result.edges);
    }

    return {
      async attach(acceptance, anchor) {
        await commit(planAcceptanceAttach(acceptance, anchor, projectId, edges));
      },
      async detach(acceptance, anchorId) {
        await commit(planAcceptanceDetach(acceptance.id, anchorId, edges));
      },
      async createAnchor(acceptance, species, title) {
        const plan = planAnchorForAcceptance(acceptance, species, title, projectId, edges, nodesById);
        if (!plan) return null;
        await commit(plan.ops);
        return plan.node;
      },
      async split(acceptance, titles) {
        await commit(planAcceptanceSplit(acceptance, titles, projectId, edges, nodesById));
      },
    };
  }, [projectId, edges, nodesById, applyMutations, syncEdges]);
}

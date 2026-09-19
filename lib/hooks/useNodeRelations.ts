"use client";

import { useMemo } from "react";
import type { MutationOp, SpeciesId } from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import type { RelationLineSpec } from "@/lib/utils/relation-lines";
import {
  planRelationLink,
  planRelationNew,
  planRelationUnlink,
} from "@/lib/utils/node-relations";

/**
 * Writing a node's relations, bound to one surface's data.
 *
 * A single object rather than three props, for the reason `AcceptanceIntake`
 * gives: it is one capability. A panel either can author relations or it
 * cannot, and threading three callbacks through the shell, the panel grid and
 * the detail panel would be three chances for a surface to end up half-wired —
 * a line that can link but not unlink is worse than one that does neither.
 *
 * Every page that lets a panel *edit* passes one of these; pages whose panels
 * are read-only pass none, and every relation line there renders read-only —
 * no `+`, no `×`, and an empty line dropped rather than shown as a bare label.
 *
 * `covers` is not written through here — see `node-relations.ts` for the
 * boundary and why it is drawn where it is.
 */
export interface NodeRelations {
  /** Link a counterpart along one line. A no-op if it is already linked. */
  link(node: Node, counterpart: Node, line: RelationLineSpec): Promise<void>;
  /** Unlink one counterpart. The counterpart itself is untouched. */
  unlink(node: Node, counterpartId: string, line: RelationLineSpec): Promise<void>;
  /**
   * Create the counterpart *and* link it, as one write. Resolves to the new
   * node so the caller can open it, or to `null` when the title was blank.
   */
  linkNew(node: Node, line: RelationLineSpec, species: SpeciesId, title: string): Promise<Node | null>;
}

interface NodeRelationsParams {
  projectId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** `useNodes`' atomic batch — `linkNew` is more than one write. */
  applyMutations: (ops: MutationOp[]) => Promise<{ nodes: Node[]; edges: Edge[]; version?: string }>;
  /**
   * `useEdges`' adopt-the-batch-result.
   *
   * Not what makes the edges land: `applyMutations` routes through
   * `writeBackGraph`, which writes nodes AND edges into the shared bundle
   * entry, so a created or cascaded edge has already reached `useEdges` by the
   * time this runs. It is the belt to that write-back's braces — idempotent on
   * the same result, and guarded by the same version — kept because the two
   * hooks are the seam where an edge would otherwise go missing for a render.
   */
  syncEdges: (edges: Edge[], version?: string) => void;
}

export function useNodeRelations({
  projectId,
  nodes,
  edges,
  applyMutations,
  syncEdges,
}: NodeRelationsParams): NodeRelations {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return useMemo(() => {
    async function commit(ops: MutationOp[]): Promise<void> {
      // A plan with no ops is not written at all. Not to save a round trip —
      // `applyMutations` already answers an empty batch from the cache without
      // one — but to skip the `syncEdges` it would otherwise be followed by,
      // which is a `writeBackEdges` and a cache write on every click that
      // changed nothing. Every gesture here has a legitimate no-op case.
      if (ops.length === 0) return;
      const result = await applyMutations(ops);
      syncEdges(result.edges, result.version);
    }

    return {
      async link(node, counterpart, line) {
        await commit(planRelationLink(node, counterpart, line, projectId, edges));
      },
      async unlink(node, counterpartId, line) {
        await commit(planRelationUnlink(node.id, counterpartId, line, edges));
      },
      async linkNew(node, line, species, title) {
        const plan = planRelationNew(node, line, species, title, projectId, edges, nodesById);
        if (!plan) return null;
        await commit(plan.ops);
        return plan.node;
      },
    };
  }, [projectId, edges, nodesById, applyMutations, syncEdges]);
}

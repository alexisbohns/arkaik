"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationOp } from "@arkaik/schema";

import {
  bundleKey,
  bundleQueryOptions,
  deriveLoadState,
  EMPTY_EDGES,
  EMPTY_NODES,
  selectNodes,
  writeBackGraph,
  type BundleEntry,
} from "@/lib/data/project-queries";
import { getProvider } from "@/lib/data/provider-registry";
import type { Edge, Node } from "@/lib/data/types";

/**
 * The project's nodes, as a projection of the one cached bundle entry
 * (`lib/data/project-queries.ts`). Every mutator is a batch through
 * `applyMutations` whose result is written straight back into that entry —
 * nodes AND edges, so a cascaded delete or a synthesized `composes` edge
 * reaches `useEdges` at once instead of on the next reload.
 */
export function useNodes(projectId: string) {
  const client = useQueryClient();
  const result = useQuery({ ...bundleQueryOptions(projectId), select: selectNodes });
  const nodes: Node[] = result.data ?? EMPTY_NODES;
  const { loading, error } = deriveLoadState(result, "Failed to load nodes");

  const { refetch } = result;
  /** The retry behind every `PageError` — joins a fetch already in flight. */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  /** The one write path: commit the batch, then adopt its result. */
  const commit = useCallback(
    async (ops: MutationOp[]) => {
      const outcome = await getProvider().applyMutations(projectId, ops);
      await writeBackGraph(client, projectId, outcome);
      return outcome;
    },
    [client, projectId],
  );

  const addNode = useCallback(
    async (node: Node) => {
      const outcome = await commit([{ op: "create_node", node }]);
      return outcome.nodes.find((candidate) => candidate.id === node.id) ?? node;
    },
    [commit],
  );

  const removeNode = useCallback(
    async (id: string) => {
      await commit([{ op: "delete_node", node_id: id }]);
    },
    [commit],
  );

  const removeNodes = useCallback(
    async (ids: string[]) => {
      // An empty batch is a 400 on the server and a no-op everywhere else.
      if (ids.length === 0) return;
      await commit([{ op: "delete_nodes", node_ids: ids }]);
    },
    [commit],
  );

  const updateNode = useCallback(
    async (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => {
      const outcome = await commit([{ op: "update_node", node_id: id, patch }]);
      const updated = outcome.nodes.find((candidate) => candidate.id === id);
      if (!updated) throw new Error(`Node ${id} not found`);
      return updated;
    },
    [commit],
  );

  /**
   * Apply several ops as one atomic write and adopt the resulting graph.
   *
   * Use this instead of chaining single-op calls whenever a half-applied result
   * would be wrong — creating a node and the edge that anchors it, say. The
   * edges are returned too so a caller holding `useEdges` can `syncEdges`
   * them, with the server `version` they came under so that write-back keeps
   * the same guard; the cache already has both halves by the time this
   * resolves.
   */
  const applyMutations = useCallback(
    async (ops: MutationOp[]): Promise<{ nodes: Node[]; edges: Edge[]; version?: string }> => {
      if (ops.length === 0) {
        // Nothing to commit: answer from the cache rather than send an empty
        // batch, which the server refuses.
        const entry = client.getQueryData<BundleEntry | null>(bundleKey(projectId));
        return {
          nodes: entry?.bundle.nodes ?? EMPTY_NODES,
          edges: entry?.bundle.edges ?? EMPTY_EDGES,
          version: entry?.version ?? undefined,
        };
      }
      const outcome = await commit(ops);
      return { nodes: outcome.nodes, edges: outcome.edges, version: outcome.version };
    },
    [client, commit, projectId],
  );

  return { nodes, loading, error, reload, addNode, removeNode, removeNodes, updateNode, applyMutations };
}

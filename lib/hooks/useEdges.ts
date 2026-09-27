"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationOp } from "@arkaik/schema";

import {
  bundleQueryOptions,
  deriveLoadState,
  EMPTY_EDGES,
  selectEdges,
  writeBackEdges,
  writeBackGraph,
} from "@/lib/data/project-queries";
import { getProvider } from "@/lib/data/provider-registry";
import type { Edge } from "@/lib/data/types";

/**
 * The project's edges, as a projection of the one cached bundle entry that
 * `useNodes` and `useProject` observe too (`lib/data/project-queries.ts`).
 * Mutators write their whole result back — nodes included — so nothing
 * observed elsewhere goes stale.
 */
export function useEdges(projectId: string) {
  const client = useQueryClient();
  const result = useQuery({ ...bundleQueryOptions(projectId), select: selectEdges });
  const edges: Edge[] = result.data ?? EMPTY_EDGES;
  const { loading, error } = deriveLoadState(result, "Failed to load edges");

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

  const addEdge = useCallback(
    async (edge: Edge) => {
      const outcome = await commit([{ op: "create_edge", edge }]);
      // The stored edge, not the caller's input: the backends normalize the id
      // to `e-{source}-{target}`, so it is found by its endpoints.
      return (
        outcome.edges.find(
          (candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id,
        ) ?? edge
      );
    },
    [commit],
  );

  const removeEdge = useCallback(
    async (id: string) => {
      await commit([{ op: "delete_edge", edge_id: id }]);
    },
    [commit],
  );

  /**
   * Adopt an edge list produced by an atomic batch elsewhere (see `useNodes`'s
   * `applyMutations`). The write has already committed — and, since that batch
   * wrote both halves back itself, this is idempotent on its result. `version`
   * is the server version the list came under: without it, a list the batch's
   * own write-back refused as older would be adopted here regardless.
   */
  const syncEdges = useCallback(
    (next: Edge[], version?: string) => {
      void writeBackEdges(client, projectId, next, version);
    },
    [client, projectId],
  );

  return { edges, loading, error, reload, addEdge, removeEdge, syncEdges };
}

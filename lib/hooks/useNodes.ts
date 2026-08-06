"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MutationOp } from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

export function useNodes(projectId: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which load is allowed to write. Bumped per attempt; an answer carrying a
   * token that is no longer the current one is dropped on the floor.
   *
   * Two loads genuinely overlap once `reload` is wired to a button: a retry
   * fired while the failing read is still hanging (a remote request that
   * eventually 500s takes as long as it takes), and the effect re-running for a
   * new `projectId`. Without the token the SLOWER answer wins by arriving last
   * — the retry succeeds, the user sees their nodes, and then the original
   * failure lands and throws the surface back into its error state over a list
   * it has already adopted. The reverse is just as bad: a stale success
   * overwriting fresh nodes with the previous project's.
   */
  const loadToken = useRef(0);

  /**
   * The read itself, extracted from the effect so an error gate can run it
   * again (#362): every surface that reads `error` needs a way out of it, and
   * "reload the whole page" is not one when the read that failed was transient.
   *
   * It writes state only from the promise's callbacks — never synchronously —
   * which is what keeps the effect below a legal effect (`set-state-in-effect`)
   * and is exactly what the inline load it replaced did. The two synchronous
   * writes a retry needs live in `reload`, which only ever runs from an event
   * handler.
   */
  const runLoad = useCallback(() => {
    const token = ++loadToken.current;
    return getProvider()
      .getNodes(projectId)
      .then((n) => {
        if (loadToken.current !== token) return;
        setNodes(n);
        setLoading(false);
      })
      .catch((err) => {
        if (loadToken.current !== token) return;
        console.error("[useNodes] Failed to load nodes:", err);
        setError(err instanceof Error ? err.message : "Failed to load nodes");
        setLoading(false);
      });
  }, [projectId]);

  /** Re-run the read — the retry behind every `PageError` on a project surface. */
  const reload = useCallback(() => {
    // Not folded into `runLoad`: `loading` is already true on the first run, so
    // these two only matter on a retry, which has to look like a load rather
    // than like a button that does nothing.
    setLoading(true);
    setError(null);
    return runLoad();
  }, [runLoad]);

  // `runLoad` is the whole dependency list because it already carries
  // `projectId`: it is rebuilt exactly when the project changes, which is
  // exactly when the read must run again.
  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  const addNode = useCallback(async (node: Node) => {
    const created = await getProvider().createNode(node);
    // The provider returns a fresh node and does not mutate this hook's state
    // (the IndexedDB backend hands back new objects, not shared references).
    // The id guard stays as a defensive no-op against a double add.
    setNodes((prev) => {
      if (prev.some((n) => n.id === created.id)) return prev;
      return [...prev, created];
    });
    return created;
  }, []);

  const removeNode = useCallback(async (id: string) => {
    await getProvider().deleteNode(projectId, id);
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, [projectId]);

  const removeNodes = useCallback(async (ids: string[]) => {
    await getProvider().deleteNodes(projectId, ids);
    const idSet = new Set(ids);
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
  }, [projectId]);

  const updateNode = useCallback(
    async (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => {
      const updated = await getProvider().updateNode(projectId, id, patch);
      setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    },
    [projectId]
  );

  /**
   * Apply several ops as one atomic write and adopt the resulting node list.
   *
   * Use this instead of chaining single-op calls whenever a half-applied result
   * would be wrong — creating a node and the edge that anchors it, say. It
   * returns the edges too, so a caller holding `useEdges` can sync that half
   * with `syncEdges`; the write itself already committed as a unit.
   */
  const applyMutations = useCallback(
    async (ops: MutationOp[]): Promise<{ nodes: Node[]; edges: Edge[] }> => {
      const result = await getProvider().applyMutations(projectId, ops);
      setNodes(result.nodes);
      return result;
    },
    [projectId],
  );

  return { nodes, loading, error, reload, addNode, removeNode, removeNodes, updateNode, applyMutations };
}

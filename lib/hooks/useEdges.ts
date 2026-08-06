"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Edge } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

export function useEdges(projectId: string) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Which load may write — see {@link useNodes} for why a token, not a flag. */
  const loadToken = useRef(0);

  /** The read — see {@link useNodes} for why the synchronous writes are not here. */
  const runLoad = useCallback(() => {
    const token = ++loadToken.current;
    return getProvider()
      .getEdges(projectId)
      .then((e) => {
        if (loadToken.current !== token) return;
        setEdges(e);
        setLoading(false);
      })
      .catch((err) => {
        if (loadToken.current !== token) return;
        console.error("[useEdges] Failed to load edges:", err);
        setError(err instanceof Error ? err.message : "Failed to load edges");
        setLoading(false);
      });
  }, [projectId]);

  /** Re-run the read — the retry behind every `PageError` on a project surface. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return runLoad();
  }, [runLoad]);

  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  const addEdge = useCallback(async (edge: Edge) => {
    const created = await getProvider().createEdge(edge);
    setEdges((prev) => [...prev, created]);
    return created;
  }, []);

  const removeEdge = useCallback(async (id: string) => {
    await getProvider().deleteEdge(projectId, id);
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }, [projectId]);

  /**
   * Adopt an edge list produced by an atomic batch elsewhere (see `useNodes`'s
   * `applyMutations`). Local state only — the write has already committed.
   */
  const syncEdges = useCallback((next: Edge[]) => setEdges(next), []);

  return { edges, loading, error, reload, addEdge, removeEdge, syncEdges };
}

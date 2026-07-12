"use client";

import { useState, useEffect, useCallback } from "react";
import type { Edge } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

export function useEdges(projectId: string) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProvider()
      .getEdges(projectId)
      .then((e) => {
        setEdges(e);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useEdges] Failed to load edges:", err);
        setError(err instanceof Error ? err.message : "Failed to load edges");
        setLoading(false);
      });
  }, [projectId]);

  const addEdge = useCallback(async (edge: Edge) => {
    const created = await getProvider().createEdge(edge);
    setEdges((prev) => [...prev, created]);
    return created;
  }, []);

  const removeEdge = useCallback(async (id: string) => {
    await getProvider().deleteEdge(id);
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { edges, loading, error, addEdge, removeEdge };
}

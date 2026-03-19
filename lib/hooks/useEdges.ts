"use client";

import { useState, useEffect, useCallback } from "react";
import type { Edge } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

export function useEdges(projectId: string) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localProvider
      .getEdges(projectId)
      .then((e) => {
        setEdges(e);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useEdges] Failed to load edges:", err);
        setLoading(false);
      });
  }, [projectId]);

  const addEdge = useCallback(async (edge: Edge) => {
    const created = await localProvider.createEdge(edge);
    setEdges((prev) => [...prev, created]);
    return created;
  }, []);

  const removeEdge = useCallback(async (id: string) => {
    await localProvider.deleteEdge(id);
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { edges, loading, addEdge, removeEdge };
}

"use client";

import { useState, useEffect, useCallback } from "react";
import type { Node } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

export function useNodes(projectId: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProvider()
      .getNodes(projectId)
      .then((n) => {
        setNodes(n);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useNodes] Failed to load nodes:", err);
        setError(err instanceof Error ? err.message : "Failed to load nodes");
        setLoading(false);
      });
  }, [projectId]);

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
    await getProvider().deleteNode(id);
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const removeNodes = useCallback(async (ids: string[]) => {
    await getProvider().deleteNodes(ids);
    const idSet = new Set(ids);
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
  }, []);

  const updateNode = useCallback(
    async (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => {
      const updated = await getProvider().updateNode(id, patch);
      setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    },
    []
  );

  return { nodes, loading, error, addNode, removeNode, removeNodes, updateNode };
}

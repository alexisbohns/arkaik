"use client";

import { useState, useEffect, useCallback } from "react";
import type { Node } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

export function useNodes(projectId: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localProvider
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
    const created = await localProvider.createNode(node);
    // localProvider.createNode mutates bundle.nodes in place, so prev may
    // already contain the new node. Always return a new array reference so
    // React re-renders even when the provider mutated state in place.
    setNodes((prev) => {
      if (prev.some((n) => n.id === created.id)) return [...prev];
      return [...prev, created];
    });
    return created;
  }, []);

  const removeNode = useCallback(async (id: string) => {
    await localProvider.deleteNode(id);
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const removeNodes = useCallback(async (ids: string[]) => {
    await localProvider.deleteNodes(ids);
    const idSet = new Set(ids);
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
  }, []);

  const updateNode = useCallback(
    async (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => {
      const updated = await localProvider.updateNode(id, patch);
      setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    },
    []
  );

  return { nodes, loading, error, addNode, removeNode, removeNodes, updateNode };
}

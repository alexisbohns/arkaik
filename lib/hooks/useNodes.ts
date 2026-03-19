"use client";

import { useState } from "react";
import type { ArkaikNode } from "@/lib/data/types";

export function useNodes(initial: ArkaikNode[] = []) {
  const [nodes, setNodes] = useState<ArkaikNode[]>(initial);

  function addNode(node: ArkaikNode) {
    setNodes((prev) => [...prev, node]);
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }

  function updateNode(id: string, patch: Partial<ArkaikNode>) {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch } : n))
    );
  }

  return { nodes, addNode, removeNode, updateNode };
}

"use client";

import { useState } from "react";
import type { Node } from "@/lib/data/types";

export function useNodes(initial: Node[] = []) {
  const [nodes, setNodes] = useState<Node[]>(initial);

  function addNode(node: Node) {
    setNodes((prev) => [...prev, node]);
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }

  function updateNode(id: string, patch: Partial<Node>) {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch } : n))
    );
  }

  return { nodes, addNode, removeNode, updateNode };
}

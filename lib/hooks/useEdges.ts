"use client";

import { useState } from "react";
import type { Edge } from "@/lib/data/types";

export function useEdges(initial: Edge[] = []) {
  const [edges, setEdges] = useState<Edge[]>(initial);

  function addEdge(edge: Edge) {
    setEdges((prev) => [...prev, edge]);
  }

  function removeEdge(id: string) {
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }

  return { edges, addEdge, removeEdge };
}

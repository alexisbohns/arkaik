"use client";

import { useState } from "react";
import type { ArkaikEdge } from "@/lib/data/types";

export function useEdges(initial: ArkaikEdge[] = []) {
  const [edges, setEdges] = useState<ArkaikEdge[]>(initial);

  function addEdge(edge: ArkaikEdge) {
    setEdges((prev) => [...prev, edge]);
  }

  function removeEdge(id: string) {
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }

  return { edges, addEdge, removeEdge };
}

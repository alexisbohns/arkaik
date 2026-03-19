"use client";

import { type Edge, type Node } from "@xyflow/react";
import { Canvas } from "@/components/graph/Canvas";

const initialNodes: Node[] = [
  {
    id: "1",
    type: "product",
    position: { x: 250, y: 200 },
    data: { label: "Pebbles", status: "live" },
  },
];

const initialEdges: Edge[] = [];

export default function ProjectCanvasPage() {
  return (
    <div className="h-screen w-full">
      <Canvas nodes={initialNodes} edges={initialEdges} />
    </div>
  );
}

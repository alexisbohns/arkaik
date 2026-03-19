"use client";

import { ReactFlow, MiniMap, Controls, Background, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const initialNodes: Node[] = [
  {
    id: "1",
    position: { x: 250, y: 200 },
    data: { label: "Pebbles" },
  },
];

const initialEdges: Edge[] = [];

export default function ProjectCanvasPage() {
  return (
    <div className="h-screen w-full">
      <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

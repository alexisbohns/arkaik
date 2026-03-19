"use client";

import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
}

export function Canvas({ nodes, edges }: CanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

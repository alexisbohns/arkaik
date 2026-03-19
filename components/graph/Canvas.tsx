"use client";

import { ReactFlow, MiniMap, Controls, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export function Canvas() {
  return (
    <div className="h-full w-full">
      <ReactFlow fitView>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

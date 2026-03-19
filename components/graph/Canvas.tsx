"use client";

import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ProductNode } from "./nodes/ProductNode";
import { ScenarioNode } from "./nodes/ScenarioNode";
import { FlowNode } from "./nodes/FlowNode";
import { StepNode } from "./nodes/StepNode";

const nodeTypes = {
  product: ProductNode,
  scenario: ScenarioNode,
  flow: FlowNode,
  step: StepNode,
};

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
}

export function Canvas({ nodes, edges }: CanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

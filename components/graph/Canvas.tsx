"use client";

import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ProductNode } from "./nodes/ProductNode";
import { ScenarioNode } from "./nodes/ScenarioNode";
import { FlowNode } from "./nodes/FlowNode";
import { StepNode } from "./nodes/StepNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { DataModelNode } from "./nodes/DataModelNode";
import { ApiEndpointNode } from "./nodes/ApiEndpointNode";
import { ComposeEdge } from "./edges/ComposeEdge";
import { BranchEdge } from "./edges/BranchEdge";

const nodeTypes = {
  product: ProductNode,
  scenario: ScenarioNode,
  flow: FlowNode,
  step: StepNode,
  condition: ConditionNode,
  dataModel: DataModelNode,
  apiEndpoint: ApiEndpointNode,
};

const edgeTypes = {
  compose: ComposeEdge,
  branch: BranchEdge,
};

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
}

export function Canvas({ nodes, edges, onNodeClick }: CanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView onNodeClick={onNodeClick}>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

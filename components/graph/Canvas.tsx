"use client";

import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge, type NodeMouseHandler, type OnConnect } from "@xyflow/react";
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
import { CrossLayerEdge } from "./edges/CrossLayerEdge";

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
  calls: CrossLayerEdge,
  displays: CrossLayerEdge,
  queries: CrossLayerEdge,
};

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
}

export function Canvas({ nodes, edges, onNodeClick, onConnect }: CanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView onNodeClick={onNodeClick} onConnect={onConnect}>
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

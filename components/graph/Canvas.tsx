"use client";

import { useCallback, useRef } from "react";
import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge, type NodeMouseHandler, type OnConnect, type EdgeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FlowNode } from "./nodes/FlowNode";
import { ViewNode } from "./nodes/ViewNode";
import { DataModelNode } from "./nodes/DataModelNode";
import { ApiEndpointNode } from "./nodes/ApiEndpointNode";
import { ComposeEdge } from "./edges/ComposeEdge";
import { BranchEdge } from "./edges/BranchEdge";
import { CrossLayerEdge } from "./edges/CrossLayerEdge";
import { FloatingDottedEdge } from "./edges/FloatingDottedEdge";

const nodeTypes = {
  flow: FlowNode,
  view: ViewNode,
  dataModel: DataModelNode,
  apiEndpoint: ApiEndpointNode,
};

const edgeTypes = {
  compose: ComposeEdge,
  branch: BranchEdge,
  floatingDotted: FloatingDottedEdge,
  calls: CrossLayerEdge,
  displays: CrossLayerEdge,
  queries: CrossLayerEdge,
};

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
}

export function Canvas({ nodes, edges, onNodeClick, onConnect, onEdgeClick }: CanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);

  const handleInit = useCallback((instance: ReactFlowInstance<Node, Edge>) => {
    reactFlowRef.current = instance;
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    const reactFlow = reactFlowRef.current;

    if (reactFlow) {
      const width = node.measured?.width ?? node.width ?? 0;
      const height = node.measured?.height ?? node.height ?? 0;

      void reactFlow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: reactFlow.getZoom(),
        duration: 250,
      });
    }

    onNodeClick?.(event, node);
  }, [onNodeClick]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
      >
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
    </div>
  );
}

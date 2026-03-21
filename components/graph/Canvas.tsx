"use client";

import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { ReactFlow, Controls, Background, type Node, type Edge, type NodeMouseHandler, type OnConnect, type EdgeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { FlowNode } from "./nodes/FlowNode";
import { ViewNode } from "./nodes/ViewNode";
import { DataModelNode } from "./nodes/DataModelNode";
import { ApiEndpointNode } from "./nodes/ApiEndpointNode";
import { ComposeEdge } from "./edges/ComposeEdge";
import { CrossLayerEdge } from "./edges/CrossLayerEdge";
import { FloatingDottedEdge } from "./edges/FloatingDottedEdge";
import { Minimap } from "../layout/Minimap";

const nodeTypes = {
  flow: FlowNode,
  view: ViewNode,
  dataModel: DataModelNode,
  apiEndpoint: ApiEndpointNode,
};

const edgeTypes = {
  compose: ComposeEdge,
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const flowStyle = useMemo(() => {
    return {
      "--xy-controls-button-background-color": "hsl(var(--card))",
      "--xy-controls-button-background-color-hover": "hsl(var(--accent))",
      "--xy-controls-button-color": "hsl(var(--foreground))",
      "--xy-controls-button-color-hover": "hsl(var(--foreground))",
      "--xy-controls-button-border-color": "hsl(var(--border))",
      "--xy-controls-box-shadow": isDark ? "0 10px 24px hsl(0 0% 0% / 0.45)" : "0 6px 16px hsl(240 10% 3.9% / 0.18)",
      "--xy-minimap-background-color": "hsl(var(--card))",
      "--xy-minimap-mask-stroke-color": isDark ? "#60a5fa" : "#3b82f6",
      "--xy-minimap-mask-stroke-width": "1.5",
    } as CSSProperties;
  }, [isDark]);

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
        colorMode={isDark ? "dark" : "light"}
        style={flowStyle}
        fitView
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
      >
        <Controls />
        <Minimap />
        <Background />
      </ReactFlow>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ReactFlow, Controls, Background, type Node, type Edge, type NodeMouseHandler, type OnConnect, type OnNodesChange, type EdgeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { applySpotlight, buildSpotlightIndex } from "@/lib/utils/graph-spotlight";
import type { MapMinimapColorMode } from "@arkaik/schema";
import type { ProductScope } from "@/lib/utils/product-scope";
import { CanvasScopeProvider } from "./canvas-scope";
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
  /** Increment to re-frame the viewport around the current graph (e.g. after a programmatic layout change). */
  fitSignal?: number;
  /** Dim non-neighbors of the hovered node — the dense-map legibility mode. */
  spotlight?: boolean;
  /** External spotlight pin (e.g. the map's panel-selected node); hover takes precedence. */
  spotlightNodeId?: string | null;
  /**
   * The product scope, published to the node cards.
   *
   * React Flow renders node components itself, so this is the canvas's way of
   * handing them the scope instead of letting them reach for a global. Omitted,
   * the cards fall back to every configured platform and to each node's own
   * array — a canvas with no scope draws exactly what it drew before products
   * existed.
   */
  scope?: ProductScope;
  /** What a minimap node's fill encodes (docs/spec/maps.md § Display Options). */
  minimapColor?: MapMinimapColorMode;
}

export function Canvas({
  nodes,
  edges,
  onNodeClick,
  onConnect,
  onEdgeClick,
  fitSignal,
  spotlight = false,
  spotlightNodeId = null,
  scope,
  minimapColor,
}: CanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const lastFitSignal = useRef(fitSignal);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const spotlightIndex = useMemo(
    () => (spotlight ? buildSpotlightIndex(edges) : null),
    [edges, spotlight],
  );

  const anchorId = spotlight ? hoveredNodeId ?? spotlightNodeId : null;

  const spotlit = useMemo(() => {
    if (!anchorId || !spotlightIndex) return { nodes, edges };
    return applySpotlight(nodes, edges, anchorId, spotlightIndex);
  }, [anchorId, edges, nodes, spotlightIndex]);

  /**
   * Measured node sizes, echoed back onto the nodes we hand React Flow.
   *
   * The canvas is prop-driven: parents own `nodes`, so React Flow's dimension
   * changes are never applied to those objects and `node.measured` stays
   * undefined. The graph itself doesn't care (it reads its own internals), but
   * the minimap reads `internals.userNode` and skips anything without
   * dimensions — which drew an empty frame. Keeping the sizes here and merging
   * them back in is what makes nodes visible in the minimap.
   */
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const handleNodesChange = useCallback<OnNodesChange>((changes) => {
    setMeasured((current) => {
      let next: Record<string, { width: number; height: number }> | null = null;

      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const { width, height } = change.dimensions;
        const known = current[change.id];
        if (known && known.width === width && known.height === height) continue;
        next ??= { ...current };
        next[change.id] = { width, height };
      }

      return next ?? current;
    });
  }, []);

  const display = useMemo(() => {
    const nodesWithSize = spotlit.nodes.map((node) => {
      const size = measured[node.id];
      if (!size || (node.measured?.width === size.width && node.measured?.height === size.height)) {
        return node;
      }
      return { ...node, measured: size };
    });

    return { nodes: nodesWithSize, edges: spotlit.edges };
  }, [measured, spotlit]);

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback<NodeMouseHandler>(() => {
    setHoveredNodeId(null);
  }, []);

  useEffect(() => {
    if (fitSignal === undefined || fitSignal === lastFitSignal.current) return;
    lastFitSignal.current = fitSignal;

    // Wait for React Flow to measure freshly mounted nodes — unmeasured nodes
    // are excluded from the fit bounds. minZoom matches the instance floor so
    // whole-product maps (the System map's ~140 nodes) frame in full.
    const timer = setTimeout(() => {
      void reactFlowRef.current?.fitView({ padding: 0.1, duration: 300, minZoom: 0.05 });
    }, 150);
    return () => clearTimeout(timer);
  }, [fitSignal]);

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
    <CanvasScopeProvider scope={scope}>
      <div className="h-full w-full">
        <ReactFlow
          nodes={display.nodes}
          edges={display.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={isDark ? "dark" : "light"}
          style={flowStyle}
          fitView
          minZoom={0.05}
          onInit={handleInit}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeMouseEnter={spotlight ? handleNodeMouseEnter : undefined}
          onNodeMouseLeave={spotlight ? handleNodeMouseLeave : undefined}
        >
          <Controls />
          <Minimap colorBy={minimapColor} />
          <Background />
        </ReactFlow>
      </div>
    </CanvasScopeProvider>
  );
}

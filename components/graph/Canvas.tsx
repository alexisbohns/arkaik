"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ReactFlow, Controls, Background, type Node, type Edge, type NodeMouseHandler, type OnConnect, type OnNodesChange, type EdgeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { applySpotlight, buildSpotlightIndex } from "@/lib/utils/graph-spotlight";
import type { MapMinimapColorMode } from "@arkaik/schema";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { Rect } from "@/lib/utils/journey-layout";
import { CanvasScopeProvider } from "./canvas-scope";
import { CameraFocus, type CanvasFocus } from "./CameraFocus";

export type { CanvasFocus } from "./CameraFocus";
import { FlowNode } from "./nodes/FlowNode";
import { ViewNode } from "./nodes/ViewNode";
import { ApiEndpointNode, DataModelNode } from "./nodes/SystemLayerNode";
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

/** See `CanvasProps.pin`. */
export interface CanvasPin {
  nodeId: string;
  /** Changes once per toggle; the canvas handles each version once. */
  version: number;
  /** The toggled card and everything under it, in flow coordinates. */
  reveal: Rect | null;
}

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
  /**
   * A canvas that only shows: no connecting, dragging or selecting, and no
   * controls or minimap. Panning and zooming stay on. The marketing page's
   * previews and any future embedded reading use this; the map pages never
   * pass it.
   */
  readOnly?: boolean;
  /**
   * Measured card sizes, as React Flow reports them. The Journey lays itself
   * out synchronously from estimates and re-lays from these, so a wrong
   * estimate costs one frame, never an overlap.
   */
  onMeasured?: (sizes: Record<string, { width: number; height: number }>) => void;
  /**
   * Keep one card where it is on screen while the graph re-lays around it —
   * the Journey's toggled flow — then pan just enough to reveal `reveal`,
   * keeping the card's top 24px inside the canvas. Collapsing reveals nothing
   * new, so a block already in view pans nothing.
   */
  pin?: CanvasPin | null;
  /** The card a click selected: centred in the canvas once it has its final size. */
  focus?: CanvasFocus | null;
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
  readOnly = false,
  onMeasured,
  pin = null,
  focus = null,
}: CanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // Reported from an effect, not from inside the state updater — updaters must
  // stay pure (StrictMode double-invokes them).
  const onMeasuredRef = useRef(onMeasured);
  useEffect(() => {
    onMeasuredRef.current = onMeasured;
  });
  useEffect(() => {
    onMeasuredRef.current?.(measured);
  }, [measured]);

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

  /** Where every card was on the previous render — the delta a pin cancels. */
  const lastPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const handledPin = useRef(0);

  useLayoutEffect(() => {
    const previous = lastPositions.current;
    lastPositions.current = new Map(nodes.map((node) => [node.id, node.position]));

    const reactFlow = reactFlowRef.current;
    const container = containerRef.current;
    if (!pin || !reactFlow || !container || pin.version === handledPin.current) return;
    const before = previous.get(pin.nodeId);
    const after = lastPositions.current.get(pin.nodeId);
    if (!before || !after) return;
    handledPin.current = pin.version;

    const viewport = reactFlow.getViewport();
    const { zoom } = viewport;
    // 1. Cancel the card's own move, instantly: it stays under the pointer.
    let x = viewport.x - (after.x - before.x) * zoom;
    let y = viewport.y - (after.y - before.y) * zoom;
    if (x !== viewport.x || y !== viewport.y) void reactFlow.setViewport({ x, y, zoom });

    // 2. Reveal the block, without pushing the card's top out of view.
    if (!pin.reveal) return;
    const margin = 24;
    const cardTop = { x: after.x * zoom + x, y: after.y * zoom + y };
    const overflow = {
      x: (pin.reveal.x + pin.reveal.width) * zoom + x + margin - container.clientWidth,
      y: (pin.reveal.y + pin.reveal.height) * zoom + y + margin - container.clientHeight,
    };
    const panX = Math.min(Math.max(overflow.x, 0), Math.max(cardTop.x - margin, 0));
    const panY = Math.min(Math.max(overflow.y, 0), Math.max(cardTop.y - margin, 0));
    if (panX === 0 && panY === 0) return;
    x -= panX;
    y -= panY;
    void reactFlow.setViewport({ x, y, zoom }, { duration: 250, interpolate: "linear" });
  }, [nodes, pin]);

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

  return (
    <CanvasScopeProvider scope={scope}>
      <div ref={containerRef} className="h-full w-full">
        <ReactFlow
          nodes={display.nodes}
          edges={display.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={isDark ? "dark" : "light"}
          style={flowStyle}
          fitView
          minZoom={0.05}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          // A read-only canvas is embedded in a scrolling page (the landing
          // previews): the wheel must scroll the page, not zoom the graph.
          // Panning by drag stays.
          zoomOnScroll={!readOnly}
          preventScrolling={!readOnly}
          // Delete/Backspace belong to the app's "delete-node" shortcut (with its
          // confirmation), not to React Flow: nodes are controlled here, so its
          // own delete removed nothing — it only swallowed Backspace, and whether
          // it got there first depended on listener attach order.
          deleteKeyCode={null}
          onInit={handleInit}
          onNodesChange={handleNodesChange}
          onNodeClick={onNodeClick}
          onConnect={readOnly ? undefined : onConnect}
          onEdgeClick={readOnly ? undefined : onEdgeClick}
          onNodeMouseEnter={spotlight ? handleNodeMouseEnter : undefined}
          onNodeMouseLeave={spotlight ? handleNodeMouseLeave : undefined}
        >
          <CameraFocus focus={focus} />
          {!readOnly && <Controls />}
          {!readOnly && <Minimap colorBy={minimapColor} />}
          <Background />
        </ReactFlow>
      </div>
    </CanvasScopeProvider>
  );
}

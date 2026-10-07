"use client";

import { useCallback, useMemo, useState } from "react";
import type { Node, NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapMinimapColorMode } from "@arkaik/schema";
import { Canvas, type CanvasPin } from "@/components/graph/Canvas";
import { buildJourneyGraph, type JourneyGraphParams } from "@/lib/utils/journey-graph";
import { estimateJourneyCardSize } from "@/lib/utils/journey-card-size";
import { blockBounds, findBlock, layoutJourney, type JourneyDirection, type Size } from "@/lib/utils/journey-layout";
import type { ProductScope } from "@/lib/utils/product-scope";

export interface JourneyCanvasProps extends JourneyGraphParams {
  /** The product scope the cards read platforms from. */
  scope: ProductScope;
  /** Increment to re-frame the viewport (see `Canvas`). */
  fitSignal?: number;
  /** What a minimap node's fill encodes (docs/spec/maps.md § Display Options). */
  minimapColor?: MapMinimapColorMode;
  /**
   * Show only: no connect, drag, select, controls or minimap. Disables
   * canvas-level editing only — card-level affordances (add child, insert
   * between) come from `handlers`, so a read-only caller should pass none or
   * only the reading handlers (`onToggleFlow`, `onOpenDetails`).
   */
  readOnly?: boolean;
  /** Reading direction; `DOWN` unless a map asks otherwise. */
  direction?: JourneyDirection;
  /**
   * The flow card last toggled, by visual id, with a version that changes per
   * toggle: the canvas keeps that card where it is on screen while the graph
   * re-lays around it, then pans just enough to reveal what opened under it.
   */
  toggled?: { nodeId: string; version: number } | null;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
}

/**
 * The Journey map's presentational half: graph construction → block layout →
 * `Canvas`, driven by plain data. Holds no project hooks, no panel context, no
 * dialogs — `JourneyMap` owns all of that and renders this. The marketing
 * page renders it over a fixture slice of the self-map.
 *
 * The layout is synchronous (`layoutJourney` over the builder's block tree),
 * so the first paint already has positions and a toggle re-lays in the same
 * render. Sizes start as estimates and switch to React Flow's measurements as
 * they arrive.
 *
 * `JourneyGraphParams` is spread straight into `buildJourneyGraph`, so the
 * props here are exactly the builder's inputs plus the canvas's own knobs.
 * `handlers` must be referentially stable (memoised by the caller): it is a
 * `buildJourneyGraph` input, so a fresh object every render rebuilds the graph.
 */
export function JourneyCanvas({
  scope,
  fitSignal,
  minimapColor,
  readOnly = false,
  direction = "DOWN",
  toggled = null,
  onNodeClick,
  onConnect,
  onEdgeClick,
  ...graphParams
}: JourneyCanvasProps) {
  const {
    dataNodes,
    dataEdges,
    nodesById,
    composeParentByChild,
    explicitRootNode,
    composeClosure,
    expandedFlows,
    display,
    viewApiRelationsByViewId,
    nodeFindings,
    handlers,
  } = graphParams;

  // Listed field by field rather than `[graphParams]`: the rest object is a
  // fresh identity every render, and a graph rebuild re-lays everything.
  const graph = useMemo(
    () =>
      buildJourneyGraph({
        dataNodes,
        dataEdges,
        nodesById,
        composeParentByChild,
        explicitRootNode,
        composeClosure,
        expandedFlows,
        display,
        viewApiRelationsByViewId,
        nodeFindings,
        handlers,
      }),
    [
      composeClosure,
      composeParentByChild,
      dataEdges,
      dataNodes,
      display,
      expandedFlows,
      explicitRootNode,
      handlers,
      nodeFindings,
      nodesById,
      viewApiRelationsByViewId,
    ],
  );

  const [measured, setMeasured] = useState<Record<string, Size>>({});

  const sizeOf = useCallback(
    (id: string): Size => {
      const known = measured[id];
      if (known) return known;
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node ? estimateJourneyCardSize(node) : { width: 0, height: 0 };
    },
    [graph, measured],
  );

  const positions = useMemo(() => layoutJourney(graph.roots, sizeOf, direction), [direction, graph, sizeOf]);

  const nodes = useMemo<Node[]>(
    () => graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    [graph, positions],
  );

  const pin = useMemo<CanvasPin | null>(() => {
    if (!toggled) return null;
    const reveal = blockBounds(findBlock(graph.roots, toggled.nodeId), positions, sizeOf);
    return { nodeId: toggled.nodeId, version: toggled.version, reveal };
  }, [graph, positions, sizeOf, toggled]);

  return (
    <Canvas
      nodes={nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onMeasured={setMeasured}
      fitSignal={fitSignal}
      pin={pin}
      scope={scope}
      minimapColor={minimapColor}
      readOnly={readOnly}
    />
  );
}

"use client";

import { useEffect, useMemo } from "react";
import type { Node, NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapMinimapColorMode } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { buildJourneyGraph, type JourneyGraphParams } from "@/lib/utils/journey-graph";
import type { ProductScope } from "@/lib/utils/product-scope";

export interface JourneyCanvasProps extends JourneyGraphParams {
  /** The product scope the cards read platforms from. */
  scope: ProductScope;
  /** Increment to re-frame the viewport (see `Canvas`). */
  fitSignal?: number;
  minimapColor?: MapMinimapColorMode;
  /** Show only: no connect, drag, select, controls or minimap. */
  readOnly?: boolean;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
  /**
   * Called with the positioned nodes each time an ELK layout lands. The
   * Journey controller uses it to re-frame once the auto-expanded flow's
   * playlist has a computed layout; a preview passes nothing.
   */
  onLayout?: (nodes: Node[]) => void;
}

/**
 * The Journey map's presentational half: graph construction → ELK layout →
 * `Canvas`, driven by plain data. Holds no project hooks, no panel context, no
 * dialogs — `JourneyMap` owns all of that and renders this. The marketing
 * page renders it over a fixture slice of the self-map.
 *
 * `JourneyGraphParams` is spread straight into `buildJourneyGraph`, so the
 * props here are exactly the builder's inputs plus the canvas's own knobs.
 */
export function JourneyCanvas({
  scope,
  fitSignal,
  minimapColor,
  readOnly = false,
  onNodeClick,
  onConnect,
  onEdgeClick,
  onLayout,
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
  // fresh identity every render, and a graph rebuild re-runs ELK.
  const graphData = useMemo(
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

  const { nodes: layoutedNodes } = useElkLayout(graphData);

  useEffect(() => {
    onLayout?.(layoutedNodes);
  }, [layoutedNodes, onLayout]);

  return (
    <Canvas
      nodes={layoutedNodes}
      edges={graphData.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      fitSignal={fitSignal}
      scope={scope}
      minimapColor={minimapColor}
      readOnly={readOnly}
    />
  );
}

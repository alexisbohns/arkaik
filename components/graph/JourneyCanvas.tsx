"use client";

import { useEffect, useMemo, useRef } from "react";
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
  /** What a minimap node's fill encodes (docs/spec/maps.md § Display Options). */
  minimapColor?: MapMinimapColorMode;
  /**
   * Show only: no connect, drag, select, controls or minimap. Disables
   * canvas-level editing only — card-level affordances (add child, insert
   * between) come from `handlers`, so a read-only caller should pass none or
   * only the reading handlers (`onToggleFlow`, `onOpenDetails`).
   */
  readOnly?: boolean;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
  /**
   * Called with the positioned nodes once an ELK layout has landed — never
   * with the `{0,0}` placeholder positions `buildJourneyGraph` returns before
   * layout runs. The Journey controller uses it to re-frame once the
   * auto-expanded flow's playlist has a computed layout; a preview passes
   * nothing.
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
 * `handlers` must be referentially stable (memoised by the caller): it is a
 * `buildJourneyGraph` input, so a fresh object every render rebuilds the graph
 * and re-runs ELK every render.
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

  const { nodes: layoutedNodes, ready } = useElkLayout(graphData);

  // The callback is read through a ref, refreshed in an effect rather than
  // during render (a render-phase write is a side effect `react-hooks/refs`
  // rejects, and concurrent rendering may run a render more than once per
  // commit) — so an unstable parent callback cannot re-fire the layout effect.
  const onLayoutRef = useRef(onLayout);
  useEffect(() => {
    onLayoutRef.current = onLayout;
  });

  useEffect(() => {
    if (!ready) return;
    onLayoutRef.current?.(layoutedNodes);
  }, [layoutedNodes, ready]);

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

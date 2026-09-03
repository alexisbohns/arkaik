"use client";

import { useEffect, useMemo, useRef } from "react";
import type { NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapDefinition, MapMinimapColorMode, ResolvedMapDisplay } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { NodeFindingSummary } from "@/lib/utils/quality";
import { buildSystemGraph, type SystemGraphHandlers, type SystemGraphScope } from "@/lib/utils/system-graph";
import { systemLayoutOptions, type SystemLayoutMode } from "@/lib/utils/system-layout-options";

export interface SystemCanvasProps {
  definition: MapDefinition;
  dataNodes: readonly DataNode[];
  dataEdges: readonly DataEdge[];
  display: ResolvedMapDisplay;
  /** Must be referentially stable (memoised by the caller): a fresh object rebuilds the graph and re-runs ELK. */
  handlers?: SystemGraphHandlers;
  /** The ambient product scope and the graph membership is resolved on. Same stability rule as `handlers`. */
  productScope?: SystemGraphScope;
  nodeFindings?: ReadonlyMap<string, NodeFindingSummary>;
  layoutMode: SystemLayoutMode;
  /** The scope the cards read platforms from; defaults to `productScope.scope`. */
  scope?: ProductScope;
  fitSignal?: number;
  /** What a minimap node's fill encodes (docs/spec/maps.md § Display Options). */
  minimapColor?: MapMinimapColorMode;
  spotlight?: boolean;
  spotlightNodeId?: string | null;
  /** Show only: no connect, drag, select, controls or minimap. Card-level affordances come from `handlers`. */
  readOnly?: boolean;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
  /**
   * Called each time an ELK layout lands, with the running layout count
   * (never 0: the placeholder positions before the first layout are not a
   * layout). The System controller uses it to re-frame after a rendition
   * switch; a preview passes nothing.
   */
  onLayoutVersion?: (version: number) => void;
}

/**
 * The System map's presentational half — `JourneyCanvas`'s twin: subgraph →
 * ELK (tiered or organic) → `Canvas`, from plain data. `SystemMap` owns the
 * hooks, the rendition switch and the dialogs and renders this. The marketing
 * page renders it over a fixture slice of the self-map.
 */
export function SystemCanvas({
  definition,
  dataNodes,
  dataEdges,
  display,
  handlers,
  productScope,
  nodeFindings,
  layoutMode,
  scope,
  fitSignal,
  minimapColor,
  spotlight = false,
  spotlightNodeId = null,
  readOnly = false,
  onNodeClick,
  onConnect,
  onEdgeClick,
  onLayoutVersion,
}: SystemCanvasProps) {
  const graph = useMemo(
    () => buildSystemGraph(definition, dataNodes, dataEdges, handlers, display, productScope, nodeFindings),
    [dataEdges, dataNodes, definition, display, handlers, nodeFindings, productScope],
  );

  const { nodes, ready, layoutVersion } = useElkLayout(graph, systemLayoutOptions(layoutMode));

  // The callback is read through a ref, refreshed in an effect rather than
  // during render (a render-phase write is a side effect `react-hooks/refs`
  // rejects, and concurrent rendering may run a render more than once per
  // commit) — so an unstable parent callback cannot re-fire the layout effect.
  const onLayoutVersionRef = useRef(onLayoutVersion);
  useEffect(() => {
    onLayoutVersionRef.current = onLayoutVersion;
  });

  useEffect(() => {
    if (!ready) return;
    onLayoutVersionRef.current?.(layoutVersion);
  }, [layoutVersion, ready]);

  return (
    <Canvas
      nodes={nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      fitSignal={fitSignal}
      minimapColor={minimapColor}
      spotlight={spotlight}
      spotlightNodeId={spotlightNodeId}
      scope={scope ?? productScope?.scope}
      readOnly={readOnly}
    />
  );
}

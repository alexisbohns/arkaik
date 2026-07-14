"use client";

import { useEffect, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { computeElkLayout, type ElkLayoutOptions } from "@/lib/utils/elk-layout";

/**
 * Run ELK layout asynchronously whenever the graph topology (or the layout
 * options) change. Returns the positioned nodes once ready; callers render
 * `graph.nodes` (0-positioned) until then, exactly as the canvas page always
 * has. `layoutVersion` increments each time a layout result is applied so
 * callers can re-frame the viewport per rendition (`ready ≡ layoutVersion > 0`).
 */
export function useElkLayout(
  graph: { nodes: Node[]; edges: Edge[] },
  options?: ElkLayoutOptions,
): { nodes: Node[]; ready: boolean; layoutVersion: number } {
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const algorithm = options?.algorithm;
  const direction = options?.direction;
  const layoutEdgeTypes = options?.layoutEdgeTypes;
  const partitionByNodeType = options?.partitionByNodeType;

  useEffect(() => {
    let cancelled = false;

    // Empty graphs run through the same async path — ELK handles a childless
    // root — keeping the effect free of synchronous setState.
    computeElkLayout(graph.nodes, graph.edges, {
      algorithm,
      direction,
      layoutEdgeTypes,
      partitionByNodeType,
    }).then((result) => {
      if (!cancelled) {
        setLayoutedNodes(result.nodes);
        setLayoutVersion((version) => version + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [graph, algorithm, direction, layoutEdgeTypes, partitionByNodeType]);

  const ready = layoutVersion > 0;
  return { nodes: ready ? layoutedNodes : graph.nodes, ready, layoutVersion };
}

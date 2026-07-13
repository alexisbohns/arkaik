"use client";

import { useEffect, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { computeElkLayout, type ElkLayoutOptions } from "@/lib/utils/elk-layout";

/**
 * Run ELK layout asynchronously whenever the graph topology changes. Returns
 * the positioned nodes once ready; callers render `graph.nodes` (0-positioned)
 * until then, exactly as the canvas page always has.
 */
export function useElkLayout(
  graph: { nodes: Node[]; edges: Edge[] },
  options?: ElkLayoutOptions,
): { nodes: Node[]; ready: boolean } {
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const direction = options?.direction;
  const layoutEdgeTypes = options?.layoutEdgeTypes;
  const partitionByNodeType = options?.partitionByNodeType;

  useEffect(() => {
    let cancelled = false;

    // Empty graphs run through the same async path — ELK handles a childless
    // root — keeping the effect free of synchronous setState.
    computeElkLayout(graph.nodes, graph.edges, {
      direction,
      layoutEdgeTypes,
      partitionByNodeType,
    }).then((result) => {
      if (!cancelled) {
        setLayoutedNodes(result.nodes);
        setLayoutReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [graph, direction, layoutEdgeTypes, partitionByNodeType]);

  return { nodes: layoutReady ? layoutedNodes : graph.nodes, ready: layoutReady };
}

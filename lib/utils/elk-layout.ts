import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

/** Size lookup matching getNodeSize in the page — keep in sync. */
function getNodeSize(nodeType?: string): { width: number; height: number } {
  switch (nodeType) {
    case "flow":
      return { width: 240, height: 136 };
    case "view":
      return { width: 224, height: 140 };
    case "dataModel":
    case "apiEndpoint":
      return { width: 192, height: 92 };
    default:
      return { width: 180, height: 100 };
  }
}

export interface ElkLayoutOptions {
  /** Direction for the top-level layout. Default: "DOWN". */
  direction?: "DOWN" | "RIGHT";
}

/**
 * Run ELK layered layout on a flat list of React Flow nodes and edges.
 *
 * Returns a new array of nodes with updated positions.
 * Edges are returned unchanged (React Flow re-routes them).
 */
export async function computeElkLayout(
  nodes: Node[],
  edges: Edge[],
  options: ElkLayoutOptions = {},
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const direction = options.direction ?? "DOWN";

  const elkNodes: ElkNode[] = nodes.map((node) => {
    const size = getNodeSize(node.type);
    return {
      id: node.id,
      width: size.width,
      height: size.height,
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((edge) => edge.type === "compose")
    .map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "20",
      "elk.layered.spacing.nodeNodeBetweenLayers": "40",
      "elk.layered.spacing.edgeNodeBetweenLayers": "20",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: elkNodes,
    edges: elkEdges,
  };

  const layoutGraph = await elk.layout(graph);

  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of layoutGraph.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const positionedNodes = nodes.map((node) => {
    const position = positionMap.get(node.id);
    return position ? { ...node, position } : node;
  });

  return { nodes: positionedNodes, edges };
}

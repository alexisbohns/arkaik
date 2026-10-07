import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import type { Node, Edge } from "@xyflow/react";

import { getElkEngine } from "./elk-engine";
import { estimateJourneyCardSize } from "./journey-card-size";

/**
 * Size lookup matching rendered node dimensions. Flow and view cards are the
 * Journey's — `journey-card-size.ts` owns their estimate; the System map's
 * own species are fixed-size cards.
 */
function getNodeSize(node: Node): { width: number; height: number } {
  switch (node.type) {
    case "flow":
    case "view":
      return estimateJourneyCardSize(node);
    case "dataModel":
    case "apiEndpoint":
      return { width: 192, height: 92 };
    default:
      return { width: 180, height: 100 };
  }
}

export interface ElkLayoutOptions {
  /**
   * Layout algorithm. `"layered"` (default) is the hierarchical/tiered
   * rendition; `"organic"` is a force-directed two-pass pipeline
   * (stress for structure, then sporeOverlap to separate the cards —
   * spike-verified: stress alone leaves dozens of card overlaps).
   * Organic ignores `direction` and `partitionByNodeType`.
   */
  algorithm?: "layered" | "organic";
  /** Direction for the top-level layout (layered only). Default: "DOWN". */
  direction?: "DOWN" | "RIGHT";
  /** React Flow edge types included in the layout graph. Default: ["compose"] (the Journey hierarchy). */
  layoutEdgeTypes?: readonly string[];
  /**
   * Pin React Flow node types into ordered tiers via ELK partitioning
   * (e.g. `{ view: 0, apiEndpoint: 1, dataModel: 2 }` for the System map;
   * layered only). Spike-verified: requires
   * `elk.separateConnectedComponents: false` so edge-less nodes stay in
   * their tier instead of floating to a separate component layout.
   */
  partitionByNodeType?: Record<string, number>;
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
  const algorithm = options.algorithm ?? "layered";
  const direction = options.direction ?? "DOWN";
  const layoutEdgeTypes = new Set(options.layoutEdgeTypes ?? ["compose"]);
  const partitions = algorithm === "layered" ? options.partitionByNodeType : undefined;

  const elkNodes: ElkNode[] = nodes.map((node) => {
    const size = getNodeSize(node);
    const partition = partitions && node.type !== undefined ? partitions[node.type] : undefined;
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      ...(partition !== undefined
        ? { layoutOptions: { "elk.partitioning.partition": String(partition) } }
        : {}),
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((edge) => edge.type !== undefined && layoutEdgeTypes.has(edge.type))
    .map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

  // One engine per layout call, not per pass: `getElkEngine()` is memoized, so
  // this is a promise lookup after the first map of the session.
  const elk = await getElkEngine();

  let layoutedChildren: ElkNode[];

  if (algorithm === "organic") {
    // Pass 1: stress majorization for the organic structure. It ignores node
    // sizes, so cards overlap after this pass.
    const stressed = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "stress",
        "elk.stress.desiredEdgeLength": "400",
        "elk.stress.iterationLimit": "100",
      },
      children: elkNodes,
      edges: elkEdges,
    });

    // Pass 2: sporeOverlap separates the cards while preserving the
    // structure from pass 1 (its positions seed this run).
    const deoverlapped = await elk.layout({
      id: "root",
      layoutOptions: { "elk.algorithm": "sporeOverlap" },
      children: (stressed.children ?? []).map((child) => ({
        id: child.id,
        width: child.width,
        height: child.height,
        x: child.x,
        y: child.y,
      })),
      edges: elkEdges,
    });
    layoutedChildren = deoverlapped.children ?? [];
  } else {
    const layoutGraph = await elk.layout({
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
        ...(partitions
          ? { "elk.partitioning.activate": "true", "elk.separateConnectedComponents": "false" }
          : {}),
      },
      children: elkNodes,
      edges: elkEdges,
    });
    layoutedChildren = layoutGraph.children ?? [];
  }

  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of layoutedChildren) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const positionedNodes = nodes.map((node) => {
    const position = positionMap.get(node.id);
    return position ? { ...node, position } : node;
  });

  return { nodes: positionedNodes, edges };
}

import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

/** Size lookup matching rendered node dimensions — keep in sync with components. */
function getNodeSize(node: Node): { width: number; height: number } {
  switch (node.type) {
    case "flow":
      return { width: 240, height: 136 };
    case "view": {
      const data = node.data as Record<string, unknown>;
      const isLarge = data.viewCardVariant === "large";
      const platforms = (data.platforms as string[] | undefined) ?? [];
      const screenshots = data.platformScreenshots as Record<string, string> | undefined;
      const hasScreenshot = screenshots != null && Object.values(screenshots).some(Boolean);
      const hasCover = typeof data.coverUrl === "string";
      const hasImage = hasScreenshot || hasCover;

      if (isLarge) {
        // base: py-3(24) + title(28) + gap(12) + platformList(platforms*24 + gaps) + footer(36) + border(4)
        const platformListHeight = platforms.length > 0 ? platforms.length * 24 + 8 : 0;
        const imageHeight = hasImage ? 112 + 12 : 0; // h-28 + gap-3
        return { width: 260, height: 104 + platformListHeight + imageHeight };
      }
      // compact: py-3(24) + title(28) + gap(12) + spacer/screenshot + gap(12) + footer(36) + border(4)
      const screenshotHeight = hasScreenshot ? 96 : 8; // h-24 vs h-2
      return { width: 224, height: 116 + screenshotHeight };
    }
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

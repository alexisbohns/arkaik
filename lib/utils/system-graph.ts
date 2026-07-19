import type { Node, Edge } from "@xyflow/react";
import { computeMapSubgraph, type MapDefinition } from "@arkaik/schema";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { EDGE_TYPE_TO_FLOW_TYPE, SPECIES_TO_NODE_TYPE } from "@/lib/utils/graph-build";
import { addEffectiveNodeToRollup, createEmptyRollup, getEffectivePlatformStatuses, getRollupDisplayStatus } from "@/lib/utils/platform-status";

export interface SystemGraphHandlers {
  onOpenDetails?: (node: DataNode) => void;
}

/**
 * The System map's graph: a direct render of `computeMapSubgraph`
 * (docs/spec/maps.md § Built-in Maps) — every selected node as a card, every
 * surviving cross-layer edge drawn. View cards are forced compact and carry no
 * screenshot/API-popover payload: at whole-product scale (Pebbles: 137 nodes)
 * the DOM weight matters more than per-card affordances. Positions are ELK
 * placeholders; layout tiers the species via partitioning.
 */
export function buildSystemGraph(
  definition: MapDefinition,
  dataNodes: readonly DataNode[],
  dataEdges: readonly DataEdge[],
  handlers: SystemGraphHandlers = {},
): { nodes: Node[]; edges: Edge[] } {
  const subgraph = computeMapSubgraph(definition, dataNodes, dataEdges);
  const origin = { x: 0, y: 0 };

  const nodes: Node[] = subgraph.nodes.map((node) => {
    const baseData = {
      label: node.title,
      status: node.status,
      platforms: node.platforms,
      metadata: node.metadata,
    } as Record<string, unknown>;

    if (node.species === "view") {
      const viewRollup = addEffectiveNodeToRollup(createEmptyRollup(), node, dataNodes, dataEdges);
      baseData.status = getRollupDisplayStatus(viewRollup, node.status);
      baseData.platformStatuses = getEffectivePlatformStatuses(node, dataNodes, dataEdges);
      baseData.apiInbound = [];
      baseData.apiOutbound = [];
      baseData.viewCardVariant = "compact";
    }

    if (node.species === "flow") {
      baseData.platformRollup = createEmptyRollup();
      baseData.expanded = false;
    }

    if (handlers.onOpenDetails) {
      baseData.onOpenDetails = () => handlers.onOpenDetails!(node);
    }

    return {
      id: node.id,
      type: SPECIES_TO_NODE_TYPE[node.species],
      position: origin,
      data: baseData,
    };
  });

  const edges: Edge[] = subgraph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: EDGE_TYPE_TO_FLOW_TYPE[edge.edge_type] ?? "floatingDotted",
  }));

  return { nodes, edges };
}

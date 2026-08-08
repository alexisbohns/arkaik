import type { Node, Edge } from "@xyflow/react";
import { computeMapSubgraph, DEFAULT_MAP_DISPLAY, type MapDefinition, type ResolvedMapDisplay } from "@arkaik/schema";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { EDGE_TYPE_TO_FLOW_TYPE, SPECIES_TO_NODE_TYPE } from "@/lib/utils/graph-build";
import { addEffectiveNodeToRollup, createEmptyRollup, getEffectivePlatformStatuses, getRollupDisplayStatus } from "@/lib/utils/platform-status";
import { mapProductId, type ProductGraph, type ProductScope } from "@/lib/utils/product-scope";

export interface SystemGraphHandlers {
  onOpenDetails?: (node: DataNode) => void;
}

/**
 * The product restriction, both halves or neither: the scope names the product
 * and the graph resolves membership. Omitted, the map selects from every node —
 * which is what it did before products existed, and what it still does for a
 * project that declares none.
 */
export interface SystemGraphScope {
  scope: ProductScope;
  graph: ProductGraph;
}

/**
 * The System map's graph: a direct render of `computeMapSubgraph`
 * (docs/spec/maps.md § Built-in Maps) — every selected node as a card, every
 * surviving cross-layer edge drawn. View cards carry no screenshot or
 * API-popover payload: at whole-product scale (Pebbles: 137 nodes) the DOM
 * weight matters more than per-card affordances, so `display.images` has
 * nothing to show here and only the platform rendition reads across. Positions
 * are ELK placeholders; layout tiers the species via partitioning.
 *
 * `display` and `productScope` answer different questions and neither stands in
 * for the other. `display` is how this reading draws its cards — the reader's
 * per-map choice, saved against the map. `productScope` is which nodes the map
 * may *select* — the definition's own `product`, else the shell's scope
 * (`mapProductId`). A web-only product drawn with `view_platforms: "rows"`
 * gets rows, with one row; the same product drawn as chips gets one chip.
 *
 * The restriction is applied by `computeMapSubgraph` itself (issue #319), not
 * by a pre-filter here: the map's own `product` then reaches every audience,
 * and all this passes down is the *ambient* half — the shell scope a map that
 * declares no product of its own falls back to. Omitted, the definition's own
 * `product` still applies; there is no reading under which a map titled "Admin
 * systems" should draw anything else.
 *
 * The scope deliberately does not narrow what the map may *read*: the status
 * helpers below keep the whole snapshot, because an acceptance covering a view
 * is evidence about that view whichever product the reader is scoped to.
 */
export function buildSystemGraph(
  definition: MapDefinition,
  dataNodes: readonly DataNode[],
  dataEdges: readonly DataEdge[],
  handlers: SystemGraphHandlers = {},
  display: ResolvedMapDisplay = DEFAULT_MAP_DISPLAY,
  productScope?: SystemGraphScope,
): { nodes: Node[]; edges: Edge[] } {
  const subgraph = computeMapSubgraph(definition, dataNodes, dataEdges, {
    product: mapProductId(definition, productScope?.scope.productId ?? null),
    ...(productScope ? { graph: productScope.graph } : {}),
  });
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
      baseData.display = display;
    }

    if (node.species === "flow") {
      baseData.platformRollup = createEmptyRollup();
      baseData.platformDisplay = display.flow_platforms;
      baseData.viewCount = 0;
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

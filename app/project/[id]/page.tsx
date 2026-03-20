"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { type Edge, type Node } from "@xyflow/react";
import { Canvas } from "@/components/graph/Canvas";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import type { Edge as DataEdge } from "@/lib/data/types";
import type { SpeciesId } from "@/lib/config/species";

const SPECIES_TO_NODE_TYPE: Record<SpeciesId, string> = {
  product: "product",
  scenario: "scenario",
  flow: "flow",
  view: "step",
  token: "step",
  state: "step",
  component: "step",
  section: "step",
  "data-model": "dataModel",
  "api-endpoint": "apiEndpoint",
};

/** Position `count` items evenly on a circle of `radius` centred at (cx, cy). */
function radialPositions(
  cx: number,
  cy: number,
  count: number,
  radius = 280,
): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function toXYEdge(edge: DataEdge): Edge {
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: edge.edge_type === "composes" ? "compose" : undefined,
  };
}

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);

  const toggleProduct = useCallback((productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    const productDataNodes = dataNodes.filter((n) => n.species === "product");

    // Build the visible node list, starting with all product nodes
    const visibleNodes: Node[] = productDataNodes.map(
      (n): Node => ({
        id: n.id,
        type: SPECIES_TO_NODE_TYPE[n.species],
        position: { x: n.position_x, y: n.position_y },
        data: {
          label: n.title,
          status: n.status,
          platforms: n.platforms,
          expanded: expandedProducts.has(n.id),
          onToggle: () => toggleProduct(n.id),
        },
      }),
    );

    const visibleNodeIds = new Set(productDataNodes.map((n) => n.id));
    const visibleEdges: Edge[] = [];

    // For each expanded product, reveal its child scenarios with compose edges
    for (const product of productDataNodes) {
      if (!expandedProducts.has(product.id)) continue;

      const childScenarios = dataNodes.filter(
        (n) => n.species === "scenario" && n.parent_id === product.id,
      );

      const positions = radialPositions(
        product.position_x,
        product.position_y,
        childScenarios.length,
      );

      childScenarios.forEach((scenario, i) => {
        visibleNodeIds.add(scenario.id);
        visibleNodes.push({
          id: scenario.id,
          type: SPECIES_TO_NODE_TYPE[scenario.species],
          position: positions[i],
          data: {
            label: scenario.title,
            status: scenario.status,
            platforms: scenario.platforms,
          },
        });
        // Create a compose edge from the product to this scenario
        visibleEdges.push({
          id: `compose-${product.id}-${scenario.id}`,
          source: product.id,
          target: scenario.id,
          type: "compose",
        });
      });
    }

    // Include any persisted edges that connect two visible nodes (deduplicated)
    const renderedEdgePairs = new Set(visibleEdges.map((e) => `${e.source}:${e.target}`));
    for (const edge of dataEdges) {
      if (
        visibleNodeIds.has(edge.source_id) &&
        visibleNodeIds.has(edge.target_id) &&
        !renderedEdgePairs.has(`${edge.source_id}:${edge.target_id}`)
      ) {
        visibleEdges.push(toXYEdge(edge));
        renderedEdgePairs.add(`${edge.source_id}:${edge.target_id}`);
      }
    }

    return { nodes: visibleNodes, edges: visibleEdges };
  }, [dataNodes, dataEdges, expandedProducts, toggleProduct]);

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph…</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-full">
      <Canvas nodes={nodes} edges={edges} />
    </div>
  );
}

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
  condition: "condition",
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

/** Position `count` items in a horizontal line centred at (cx, cy + offset). */
const FLOW_CHILD_SPACING = 220;
const FLOW_CHILD_Y_OFFSET = 220;

function linearPositions(
  cx: number,
  cy: number,
  count: number,
  spacing = FLOW_CHILD_SPACING,
): { x: number; y: number }[] {
  if (count === 0) return [];
  const totalWidth = (count - 1) * spacing;
  const startX = cx - totalWidth / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * spacing,
    y: cy + FLOW_CHILD_Y_OFFSET,
  }));
}

function toXYEdge(edge: DataEdge): Edge {
  let type: string | undefined;
  if (edge.edge_type === "composes") type = "compose";
  else if (edge.edge_type === "branches") type = "branch";
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type,
  };
}

/** Species that can appear as direct children of a Flow (steps + branches). */
const FLOW_CHILD_SPECIES = new Set<SpeciesId>([
  "view", "component", "section", "state", "token", "condition",
]);

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());

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

  const toggleScenario = useCallback((scenarioId: string) => {
    setExpandedScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(scenarioId)) {
        next.delete(scenarioId);
      } else {
        next.add(scenarioId);
      }
      return next;
    });
  }, []);

  const toggleFlow = useCallback((flowId: string) => {
    setExpandedFlows((prev) => {
      const next = new Set(prev);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
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
            expanded: expandedScenarios.has(scenario.id),
            onToggle: () => toggleScenario(scenario.id),
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

    // For each expanded scenario, reveal its child flows with compose edges
    const visibleScenarioIds = [...visibleNodeIds].filter((id) =>
      dataNodes.find((n) => n.id === id && n.species === "scenario"),
    );

    for (const scenarioId of visibleScenarioIds) {
      if (!expandedScenarios.has(scenarioId)) continue;

      const scenario = dataNodes.find((n) => n.id === scenarioId);
      if (!scenario) continue;
      const childFlows = dataNodes.filter(
        (n) => n.species === "flow" && n.parent_id === scenarioId,
      );

      const positions = radialPositions(
        scenario.position_x,
        scenario.position_y,
        childFlows.length,
        200,
      );

      childFlows.forEach((flow, i) => {
        visibleNodeIds.add(flow.id);
        visibleNodes.push({
          id: flow.id,
          type: SPECIES_TO_NODE_TYPE[flow.species],
          position: positions[i],
          data: {
            label: flow.title,
            status: flow.status,
            platforms: flow.platforms,
            expanded: expandedFlows.has(flow.id),
            onToggle: () => toggleFlow(flow.id),
          },
        });
        // Create a compose edge from the scenario to this flow
        visibleEdges.push({
          id: `compose-${scenarioId}-${flow.id}`,
          source: scenarioId,
          target: flow.id,
          type: "compose",
        });
      });
    }

    // For each expanded flow, reveal its children (steps and conditions) in a linear layout
    const visibleFlowIds = [...visibleNodeIds].filter((nodeId) =>
      dataNodes.find((n) => n.id === nodeId && n.species === "flow"),
    );

    for (const flowId of visibleFlowIds) {
      if (!expandedFlows.has(flowId)) continue;

      const flow = dataNodes.find((n) => n.id === flowId);
      if (!flow) continue;

      const children = dataNodes.filter(
        (n) => n.parent_id === flowId && FLOW_CHILD_SPECIES.has(n.species),
      );

      const childPositions = linearPositions(flow.position_x, flow.position_y, children.length);

      children.forEach((child, i) => {
        visibleNodeIds.add(child.id);
        visibleNodes.push({
          id: child.id,
          type: SPECIES_TO_NODE_TYPE[child.species],
          position: childPositions[i],
          data: {
            label: child.title,
            status: child.status,
            platforms: child.platforms,
          },
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
  }, [dataNodes, dataEdges, expandedProducts, expandedScenarios, expandedFlows, toggleProduct, toggleScenario, toggleFlow]);

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

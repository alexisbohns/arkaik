"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { type Edge, type Node } from "@xyflow/react";
import { Canvas } from "@/components/graph/Canvas";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import type { SpeciesId } from "@/lib/config/species";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformId } from "@/lib/config/platforms";

interface BreadcrumbEntry {
  nodeId: string;
  label: string;
  species: "product" | "scenario" | "flow";
}

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

/** Species that can appear as direct children of a Flow (steps + branches). */
const FLOW_CHILD_SPECIES = new Set<SpeciesId>([
  "view", "component", "section", "state", "token", "condition",
]);

/** Step-like species eligible for per-platform split rendering. */
const STEP_SPLIT_SPECIES = new Set<SpeciesId>([
  "view", "component", "section", "state", "token",
]);

const ALL_PLATFORM_IDS = PLATFORMS.map((p) => p.id);

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);

  const toggleProduct = useCallback((productId: string, label: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
        setBreadcrumbs([]);
      } else {
        next.add(productId);
        setBreadcrumbs([{ nodeId: productId, label, species: "product" }]);
      }
      return next;
    });
  }, []);

  const toggleScenario = useCallback((scenarioId: string, label: string, parentProductId: string, parentProductLabel: string) => {
    setExpandedScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(scenarioId)) {
        next.delete(scenarioId);
        setBreadcrumbs((crumbs) => crumbs.slice(0, crumbs.findIndex((b) => b.nodeId === scenarioId)));
      } else {
        next.add(scenarioId);
        setBreadcrumbs([
          { nodeId: parentProductId, label: parentProductLabel, species: "product" },
          { nodeId: scenarioId, label, species: "scenario" },
        ]);
      }
      return next;
    });
  }, []);

  const toggleFlow = useCallback((flowId: string, label: string, parentScenarioId: string, parentScenarioLabel: string, grandparentProductId: string, grandparentProductLabel: string) => {
    setExpandedFlows((prev) => {
      const next = new Set(prev);
      if (next.has(flowId)) {
        next.delete(flowId);
        setBreadcrumbs((crumbs) => crumbs.slice(0, crumbs.findIndex((b) => b.nodeId === flowId)));
      } else {
        next.add(flowId);
        setBreadcrumbs([
          { nodeId: grandparentProductId, label: grandparentProductLabel, species: "product" },
          { nodeId: parentScenarioId, label: parentScenarioLabel, species: "scenario" },
          { nodeId: flowId, label, species: "flow" },
        ]);
      }
      return next;
    });
  }, []);

  const navigateBackTo = useCallback((index: number) => {
    setBreadcrumbs((prev) => {
      const entry = prev[index];
      if (entry?.species === "product") {
        setExpandedScenarios(new Set());
        setExpandedFlows(new Set());
      } else if (entry?.species === "scenario") {
        setExpandedFlows(new Set());
      }
      return prev.slice(0, index + 1);
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    // Tracks nodes split by platform: originalId → [splitId, …]
    const splitNodeMap = new Map<string, string[]>();

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
          onToggle: () => toggleProduct(n.id, n.title),
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
            onToggle: () => toggleScenario(scenario.id, scenario.title, product.id, product.title),
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
      const parentProduct = dataNodes.find((n) => n.id === scenario.parent_id);
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
            onToggle: () => toggleFlow(flow.id, flow.title, scenarioId, scenario.title, parentProduct?.id ?? "", parentProduct?.title ?? ""),
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

      // Build visual items: step-like nodes with a proper subset of platforms
      // are expanded into one visual node per platform; all others stay as-is.
      const visualItems: Array<{
        id: string;
        dataNode: (typeof children)[0];
        platform?: PlatformId;
      }> = [];

      for (const child of children) {
        const childPlatforms = (child.platforms ?? []) as PlatformId[];
        const childIsAllPlatforms = ALL_PLATFORM_IDS.every((p) =>
          childPlatforms.includes(p),
        );
        const shouldSplit =
          STEP_SPLIT_SPECIES.has(child.species) &&
          childPlatforms.length >= 2 &&
          !childIsAllPlatforms;

        if (shouldSplit) {
          const splitIds = childPlatforms.map((p) => `${child.id}__${p}`);
          splitNodeMap.set(child.id, splitIds);
          for (const platform of childPlatforms) {
            visualItems.push({ id: `${child.id}__${platform}`, dataNode: child, platform });
          }
        } else {
          visualItems.push({ id: child.id, dataNode: child });
        }
      }

      const childPositions = linearPositions(flow.position_x, flow.position_y, visualItems.length);

      for (const [i, item] of visualItems.entries()) {
        visibleNodeIds.add(item.id);
        visibleNodes.push({
          id: item.id,
          type: SPECIES_TO_NODE_TYPE[item.dataNode.species],
          position: childPositions[i],
          data: {
            label: item.dataNode.title,
            status: item.dataNode.status,
            platforms: item.platform ? [item.platform] : item.dataNode.platforms,
          },
        });
      }
    }

    // Include any persisted edges that connect two visible nodes (deduplicated).
    // When a node was split into per-platform variants, fan the edge out to all
    // applicable split IDs.
    const renderedEdgePairs = new Set(visibleEdges.map((e) => `${e.source}:${e.target}`));
    for (const edge of dataEdges) {
      const sourceIds =
        splitNodeMap.get(edge.source_id) ??
        (visibleNodeIds.has(edge.source_id) ? [edge.source_id] : []);
      const targetIds =
        splitNodeMap.get(edge.target_id) ??
        (visibleNodeIds.has(edge.target_id) ? [edge.target_id] : []);

      const xyType =
        edge.edge_type === "composes"
          ? "compose"
          : edge.edge_type === "branches"
          ? "branch"
          : undefined;

      for (const srcId of sourceIds) {
        for (const tgtId of targetIds) {
          const pairKey = `${srcId}:${tgtId}`;
          if (!renderedEdgePairs.has(pairKey)) {
            visibleEdges.push({
              id: `${edge.id}--${srcId}--${tgtId}`,
              source: srcId,
              target: tgtId,
              type: xyType,
            });
            renderedEdgePairs.add(pairKey);
          }
        }
      }
    }

    return { nodes: visibleNodes, edges: visibleEdges };
  }, [dataNodes, dataEdges, expandedProducts, expandedScenarios, expandedFlows, toggleProduct, toggleScenario, toggleFlow]);

  const breadcrumbSegments = breadcrumbs.map((crumb, index) => ({
    label: crumb.label,
    onClick: index < breadcrumbs.length - 1 ? () => navigateBackTo(index) : undefined,
  }));

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph…</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col">
      {breadcrumbs.length > 0 && (
        <header className="flex items-center border-b px-4 py-2 bg-background shrink-0">
          <Breadcrumb segments={breadcrumbSegments} />
        </header>
      )}
      <div className="flex-1 min-h-0">
        <Canvas nodes={nodes} edges={edges} />
      </div>
    </div>
  );
}

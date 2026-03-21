"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { type Edge, type Node, type NodeMouseHandler, type Connection, type EdgeMouseHandler } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { Button } from "@/components/ui/button";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import type { SpeciesId } from "@/lib/config/species";
import { getChildSpecies } from "@/lib/config/species";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformId } from "@/lib/config/platforms";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import type { EdgeTypeId } from "@/lib/config/edge-types";

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

const COLLISION_PADDING = 24;
const MAX_COLLISION_ITERATIONS = 30;

interface LayoutSize {
  width: number;
  height: number;
}

interface LayoutRule {
  fixed?: boolean;
  axis?: "both" | "x" | "y";
  clampX?: [number, number];
  clampY?: [number, number];
}

function getNodeSize(nodeType?: string): LayoutSize {
  switch (nodeType) {
    case "product":
      return { width: 160, height: 160 };
    case "scenario":
      return { width: 224, height: 112 };
    case "flow":
      return { width: 192, height: 104 };
    case "step":
      return { width: 184, height: 96 };
    case "condition":
      return { width: 120, height: 120 };
    case "dataModel":
    case "apiEndpoint":
      return { width: 192, height: 92 };
    default:
      return { width: 180, height: 100 };
  }
}

function resolveNodeCollisions(nodes: Node[], rules: Map<string, LayoutRule>): Node[] {
  if (nodes.length < 2) return nodes;

  const positions = new Map(nodes.map((node) => [node.id, { ...node.position }]));
  const sizes = new Map(nodes.map((node) => [node.id, getNodeSize(node.type)]));
  const orderedIds = [...nodes].map((node) => node.id).sort((a, b) => a.localeCompare(b));

  const applyAxis = (axis: LayoutRule["axis"], x: number, y: number) => {
    if (axis === "x") return { x, y: 0 };
    if (axis === "y") return { x: 0, y };
    return { x, y };
  };

  const clampPosition = (id: string) => {
    const rule = rules.get(id);
    const pos = positions.get(id);
    if (!rule || !pos) return;

    if (rule.clampX) {
      pos.x = Math.max(rule.clampX[0], Math.min(rule.clampX[1], pos.x));
    }
    if (rule.clampY) {
      pos.y = Math.max(rule.clampY[0], Math.min(rule.clampY[1], pos.y));
    }
  };

  for (let i = 0; i < MAX_COLLISION_ITERATIONS; i += 1) {
    let hadCollision = false;

    for (let aIndex = 0; aIndex < orderedIds.length; aIndex += 1) {
      const aId = orderedIds[aIndex];
      const aPos = positions.get(aId);
      const aSize = sizes.get(aId);
      if (!aPos || !aSize) continue;

      for (let bIndex = aIndex + 1; bIndex < orderedIds.length; bIndex += 1) {
        const bId = orderedIds[bIndex];
        const bPos = positions.get(bId);
        const bSize = sizes.get(bId);
        if (!bPos || !bSize) continue;

        const ax = aPos.x + aSize.width / 2;
        const ay = aPos.y + aSize.height / 2;
        const bx = bPos.x + bSize.width / 2;
        const by = bPos.y + bSize.height / 2;

        const dx = bx - ax;
        const dy = by - ay;
        const overlapX = (aSize.width + bSize.width) / 2 + COLLISION_PADDING - Math.abs(dx);
        const overlapY = (aSize.height + bSize.height) / 2 + COLLISION_PADDING - Math.abs(dy);

        if (overlapX <= 0 || overlapY <= 0) continue;
        hadCollision = true;

        const aRule = rules.get(aId) ?? {};
        const bRule = rules.get(bId) ?? {};
        const aFixed = Boolean(aRule.fixed);
        const bFixed = Boolean(bRule.fixed);

        const moveX = overlapX <= overlapY;
        const directionX = dx >= 0 ? 1 : -1;
        const directionY = dy >= 0 ? 1 : -1;
        const pushX = moveX ? (overlapX / (aFixed || bFixed ? 1 : 2)) * directionX : 0;
        const pushY = !moveX ? (overlapY / (aFixed || bFixed ? 1 : 2)) * directionY : 0;

        if (!aFixed) {
          const delta = applyAxis(aRule.axis, -pushX, -pushY);
          aPos.x += delta.x;
          aPos.y += delta.y;
          clampPosition(aId);
        }
        if (!bFixed) {
          const delta = applyAxis(bRule.axis, pushX, pushY);
          bPos.x += delta.x;
          bPos.y += delta.y;
          clampPosition(bId);
        }
      }
    }

    if (!hadCollision) break;
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);
  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [newNodePreset, setNewNodePreset] = useState<{ parent_id: string; species: SpeciesId } | null>(null);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(id);

  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);

  // ── Delete node ──────────────────────────────────────────────────────────
  const [deleteNodeTarget, setDeleteNodeTarget] = useState<DataNode | null>(null);
  const [deleteNodeDialogOpen, setDeleteNodeDialogOpen] = useState(false);
  const [deleteNodeCascade, setDeleteNodeCascade] = useState(false);

  /** Collect all descendant node IDs (breadth-first). */
  const getDescendantIds = useCallback(
    (nodeId: string): string[] => {
      const result: string[] = [];
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = dataNodes.filter((n) => n.parent_id === current);
        for (const child of children) {
          result.push(child.id);
          queue.push(child.id);
        }
      }
      return result;
    },
    [dataNodes],
  );

  const handleDeleteNodeRequest = useCallback((nodeId: string) => {
    const node = dataNodes.find((n) => n.id === nodeId);
    if (!node) return;
    setDeleteNodeTarget(node);
    setDeleteNodeCascade(false);
    setDeleteNodeDialogOpen(true);
  }, [dataNodes]);

  const handleDeleteNodeConfirm = useCallback(async () => {
    if (!deleteNodeTarget) return;
    const idsToDelete = deleteNodeCascade
      ? [deleteNodeTarget.id, ...getDescendantIds(deleteNodeTarget.id)]
      : [deleteNodeTarget.id];
    await removeNodes(idsToDelete);
    setDeleteNodeDialogOpen(false);
    setDeleteNodeTarget(null);
    setPanelOpen(false);
    setSelectedNode(null);
  }, [deleteNodeTarget, deleteNodeCascade, getDescendantIds, removeNodes]);

  // ── Delete edge ──────────────────────────────────────────────────────────
  const [deleteEdgeTarget, setDeleteEdgeTarget] = useState<DataEdge | null>(null);
  const [deleteEdgeDialogOpen, setDeleteEdgeDialogOpen] = useState(false);

  /** Pre-computed descendant count for the delete node dialog cascade checkbox. */
  const deleteNodeDescendantCount = useMemo(
    () => (deleteNodeTarget ? getDescendantIds(deleteNodeTarget.id).length : 0),
    [deleteNodeTarget, getDescendantIds],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>((_event, xyEdge) => {
    // Canvas edge IDs for persisted edges are `${edge.id}--${srcId}--${tgtId}`.
    // Compose edges use `compose-${parentId}-${childId}` and are not persisted.
    if (xyEdge.id.startsWith("compose-")) return;
    const edgeId = xyEdge.id.split("--")[0];
    const edge = dataEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    setDeleteEdgeTarget(edge);
    setDeleteEdgeDialogOpen(true);
  }, [dataEdges]);

  const handleDeleteEdgeConfirm = useCallback(async () => {
    if (!deleteEdgeTarget) return;
    await removeEdge(deleteEdgeTarget.id);
    setDeleteEdgeDialogOpen(false);
    setDeleteEdgeTarget(null);
  }, [deleteEdgeTarget, removeEdge]);

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
    if (expandedScenarios.has(scenarioId)) {
      setExpandedScenarios((prev) => {
        const next = new Set(prev);
        next.delete(scenarioId);
        return next;
      });
      const flowsUnderScenario = new Set(
        dataNodes.filter((n) => n.parent_id === scenarioId && n.species === "flow").map((n) => n.id),
      );
      setExpandedFlows((prev) => {
        const next = new Set(prev);
        flowsUnderScenario.forEach((id) => next.delete(id));
        return next;
      });
      setBreadcrumbs((crumbs) => crumbs.slice(0, crumbs.findIndex((b) => b.nodeId === scenarioId)));
    } else {
      // Enforce one open scenario per product: close sibling scenarios and their child flows
      const siblingIds = new Set(
        dataNodes
          .filter((n) => n.species === "scenario" && n.parent_id === parentProductId && n.id !== scenarioId)
          .map((n) => n.id),
      );
      const siblingFlowIds = new Set(
        dataNodes
          .filter((n) => n.species === "flow" && n.parent_id != null && siblingIds.has(n.parent_id))
          .map((n) => n.id),
      );
      setExpandedScenarios((prev) => {
        const next = new Set(prev);
        siblingIds.forEach((id) => next.delete(id));
        next.add(scenarioId);
        return next;
      });
      setExpandedFlows((prev) => {
        const next = new Set(prev);
        siblingFlowIds.forEach((id) => next.delete(id));
        return next;
      });
      setBreadcrumbs([
        { nodeId: parentProductId, label: parentProductLabel, species: "product" },
        { nodeId: scenarioId, label, species: "scenario" },
      ]);
    }
  }, [expandedScenarios, dataNodes]);

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

  const handleNodeUpdate = useCallback(
    async (nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) => {
      const updated = await updateNode(nodeId, patch);
      setSelectedNode(updated);
    },
    [updateNode],
  );

  const handleNavigate = useCallback((targetNode: DataNode) => {
    setSelectedNode(targetNode);
  }, []);

  const handleAddChildNode = useCallback((parentId: string, childSpecies: SpeciesId) => {
    setNewNodePreset({ parent_id: parentId, species: childSpecies });
    setNewNodeOpen(true);
  }, []);

  const handleNewNodeOpenChange = useCallback((open: boolean) => {
    setNewNodeOpen(open);
    if (!open) setNewNodePreset(null);
  }, []);

  const handleAddNode = useCallback(
    async (data: NewNodeFormData) => {
      let position_x = 400;
      let position_y = 400;

      if (data.parent_id) {
        const parent = dataNodes.find((n) => n.id === data.parent_id);
        if (parent) {
          position_x = parent.position_x;
          position_y = parent.position_y;
        }
      } else {
        const products = dataNodes.filter((n) => n.species === "product");
        if (products.length > 0) {
          const maxX = Math.max(...products.map((n) => n.position_x));
          position_x = maxX + 300;
        }
      }

      await addNode({
        id: crypto.randomUUID(),
        project_id: id,
        title: data.title,
        species: data.species,
        status: data.status,
        platforms: data.platforms,
        parent_id: data.parent_id,
        position_x,
        position_y,
      });
      setNewNodeOpen(false);
    },
    [dataNodes, addNode, id],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, xyNode) => {
    const dataNode = dataNodes.find((n) => n.id === xyNode.id);
    if (dataNode) {
      setSelectedNode(dataNode);
      setPanelOpen(true);
    }
  }, [dataNodes]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setPendingConnection(connection);
    setEdgeDialogOpen(true);
  }, []);

  const handleEdgeTypeSelect = useCallback(async (edgeType: EdgeTypeId) => {
    if (!pendingConnection?.source || !pendingConnection?.target) return;
    await addEdge({
      id: crypto.randomUUID(),
      project_id: id,
      source_id: pendingConnection.source,
      target_id: pendingConnection.target,
      edge_type: edgeType,
    });
    setEdgeDialogOpen(false);
    setPendingConnection(null);
  }, [pendingConnection, addEdge, id]);

  const { nodes, edges } = useMemo(() => {
    const layoutRules = new Map<string, LayoutRule>();

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
          onOpenDetails: () => {
            setSelectedNode(n);
            setPanelOpen(true);
          },
          onAddChild: (() => {
            const child = getChildSpecies(n.species);
            return child ? () => handleAddChildNode(n.id, child) : undefined;
          })(),
        },
      }),
    );

    for (const n of productDataNodes) {
      layoutRules.set(n.id, { fixed: true, axis: "both" });
    }

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
        const scenarioPos = positions[i];
        visibleNodeIds.add(scenario.id);
        visibleNodes.push({
          id: scenario.id,
          type: SPECIES_TO_NODE_TYPE[scenario.species],
          position: scenarioPos,
          data: {
            label: scenario.title,
            status: scenario.status,
            platforms: scenario.platforms,
            expanded: expandedScenarios.has(scenario.id),
            onToggle: () => toggleScenario(scenario.id, scenario.title, product.id, product.title),
            onOpenDetails: () => {
              setSelectedNode(scenario);
              setPanelOpen(true);
            },
            onAddChild: (() => {
              const child = getChildSpecies(scenario.species);
              return child ? () => handleAddChildNode(scenario.id, child) : undefined;
            })(),
          },
        });
        layoutRules.set(scenario.id, {
          axis: "both",
          clampX: [product.position_x - 460, product.position_x + 460],
          clampY: [product.position_y - 460, product.position_y + 460],
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
        const flowPos = positions[i];
        visibleNodeIds.add(flow.id);
        visibleNodes.push({
          id: flow.id,
          type: SPECIES_TO_NODE_TYPE[flow.species],
          position: flowPos,
          data: {
            label: flow.title,
            status: flow.status,
            platforms: flow.platforms,
            expanded: expandedFlows.has(flow.id),
            onToggle: () => toggleFlow(flow.id, flow.title, scenarioId, scenario.title, parentProduct?.id ?? "", parentProduct?.title ?? ""),
            onOpenDetails: () => {
              setSelectedNode(flow);
              setPanelOpen(true);
            },
            onAddChild: getChildSpecies(flow.species)
              ? () => handleAddChildNode(flow.id, getChildSpecies(flow.species)!)
              : undefined,
          },
        });
        layoutRules.set(flow.id, {
          axis: "both",
          clampX: [scenario.position_x - 340, scenario.position_x + 340],
          clampY: [scenario.position_y - 340, scenario.position_y + 340],
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
      const maxSpreadX = Math.max(320, children.length * 110);

      for (const [i, child] of children.entries()) {
        const childPosition = childPositions[i];
        visibleNodeIds.add(child.id);
        visibleNodes.push({
          id: child.id,
          type: SPECIES_TO_NODE_TYPE[child.species],
          position: childPosition,
          data: {
            label: child.title,
            status: child.status,
            platforms: child.platforms,
          },
        });
        layoutRules.set(child.id, {
          axis: "both",
          clampX: [flow.position_x - maxSpreadX, flow.position_x + maxSpreadX],
          clampY: [flow.position_y + FLOW_CHILD_Y_OFFSET - 80, flow.position_y + FLOW_CHILD_Y_OFFSET + 80],
        });
      }
    }

    // Include any persisted edges that connect two visible nodes.
    const renderedEdgePairs = new Set(visibleEdges.map((e) => `${e.source}:${e.target}`));
    const EDGE_TYPE_MAP: Record<string, string> = {
      composes: "compose",
      branches: "branch",
      calls: "calls",
      displays: "displays",
      queries: "queries",
    };

    for (const edge of dataEdges) {
      if (!visibleNodeIds.has(edge.source_id) || !visibleNodeIds.has(edge.target_id)) continue;

      const pairKey = `${edge.source_id}:${edge.target_id}`;
      if (renderedEdgePairs.has(pairKey)) continue;

      const xyType = EDGE_TYPE_MAP[edge.edge_type];
      visibleEdges.push({
        id: `${edge.id}--${edge.source_id}--${edge.target_id}`,
        source: edge.source_id,
        target: edge.target_id,
        type: xyType,
      });
      renderedEdgePairs.add(pairKey);
    }

    const collisionFreeNodes = resolveNodeCollisions(visibleNodes, layoutRules);

    return { nodes: collisionFreeNodes, edges: visibleEdges };
  }, [dataNodes, dataEdges, expandedProducts, expandedScenarios, expandedFlows, toggleProduct, toggleScenario, toggleFlow, handleAddChildNode]);

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
        <header className="flex items-center gap-3 border-b bg-background px-4 py-2 shrink-0">
          <Link href="/" aria-label="Go to home" className="inline-flex items-center">
            <ArkaikLogo className="w-16 shrink-0" />
          </Link>
          <Breadcrumb segments={breadcrumbSegments} />
        </header>
      )}
      <div className="flex-1 min-h-0 relative">
        <Canvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onConnect={handleConnect} onEdgeClick={handleEdgeClick} />
        <div className="absolute bottom-4 right-4 z-10">
          <Button size="sm" onClick={() => { setNewNodePreset(null); setNewNodeOpen(true); }}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </div>
      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleNodeUpdate}
        onDelete={handleDeleteNodeRequest}
        allNodes={dataNodes}
        allEdges={dataEdges}
        onNavigate={handleNavigate}
      />
      <NewNodeForm
        key={newNodePreset ? `preset-${newNodePreset.parent_id}-${newNodePreset.species}` : "default"}
        open={newNodeOpen}
        onOpenChange={handleNewNodeOpenChange}
        onSubmit={handleAddNode}
        nodes={dataNodes}
        defaultValues={newNodePreset ?? undefined}
      />
      <EdgeTypeDialog
        open={edgeDialogOpen}
        onOpenChange={(open) => {
          setEdgeDialogOpen(open);
          if (!open) setPendingConnection(null);
        }}
        onSelect={handleEdgeTypeSelect}
      />
      <DeleteConfirmDialog
        open={deleteNodeDialogOpen}
        onOpenChange={(open) => {
          setDeleteNodeDialogOpen(open);
          if (!open) setDeleteNodeTarget(null);
        }}
        title={`Delete "${deleteNodeTarget?.title ?? "node"}"?`}
        description="This will permanently delete the node and all its connected edges. This action cannot be undone."
        cascadeLabel={
          deleteNodeDescendantCount > 0
            ? `Also delete ${deleteNodeDescendantCount} child node(s)`
            : undefined
        }
        cascadeChecked={deleteNodeCascade}
        onCascadeChange={setDeleteNodeCascade}
        onConfirm={handleDeleteNodeConfirm}
      />
      <DeleteConfirmDialog
        open={deleteEdgeDialogOpen}
        onOpenChange={(open) => {
          setDeleteEdgeDialogOpen(open);
          if (!open) setDeleteEdgeTarget(null);
        }}
        title="Delete this edge?"
        description="This will permanently remove the connection between these two nodes. This action cannot be undone."
        onConfirm={handleDeleteEdgeConfirm}
      />
    </div>
  );
}

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

/** Step-like species eligible for per-platform split rendering. */
const STEP_SPLIT_SPECIES = new Set<SpeciesId>([
  "view", "component", "section", "state", "token",
]);

const ALL_PLATFORM_IDS = PLATFORMS.map((p) => p.id);

/** Delimiter used to build per-platform split node IDs: `${nodeId}${SPLIT_SEP}${platformId}`. */
const SPLIT_SEP = "__";

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
    // Split nodes have IDs like `${nodeId}${SPLIT_SEP}${platform}` — strip the suffix to find the source data node
    const baseId = xyNode.id.includes(SPLIT_SEP) ? xyNode.id.split(SPLIT_SEP)[0] : xyNode.id;
    const dataNode = dataNodes.find((n) => n.id === baseId);
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
    // Resolve base node IDs in case the source/target are split (platform) nodes
    const sourceBaseId = pendingConnection.source.includes(SPLIT_SEP)
      ? pendingConnection.source.split(SPLIT_SEP)[0]
      : pendingConnection.source;
    const targetBaseId = pendingConnection.target.includes(SPLIT_SEP)
      ? pendingConnection.target.split(SPLIT_SEP)[0]
      : pendingConnection.target;
    await addEdge({
      id: crypto.randomUUID(),
      project_id: id,
      source_id: sourceBaseId,
      target_id: targetBaseId,
      edge_type: edgeType,
    });
    setEdgeDialogOpen(false);
    setPendingConnection(null);
  }, [pendingConnection, addEdge, id]);

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
            onOpenDetails: () => {
              setSelectedNode(flow);
              setPanelOpen(true);
            },
            onAddChild: getChildSpecies(flow.species)
              ? () => handleAddChildNode(flow.id, getChildSpecies(flow.species)!)
              : undefined,
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
          const splitIds = childPlatforms.map((p) => `${child.id}${SPLIT_SEP}${p}`);
          splitNodeMap.set(child.id, splitIds);
          for (const platform of childPlatforms) {
            visualItems.push({ id: `${child.id}${SPLIT_SEP}${platform}`, dataNode: child, platform });
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

      const EDGE_TYPE_MAP: Record<string, string> = {
        composes: "compose",
        branches: "branch",
        calls: "calls",
        displays: "displays",
        queries: "queries",
      };
      const xyType = EDGE_TYPE_MAP[edge.edge_type];

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

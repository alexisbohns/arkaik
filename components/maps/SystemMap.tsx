"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Connection, type EdgeMouseHandler, type NodeMouseHandler } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { buildProductUsageIndex, type MapDefinition } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { NodeDetailStack } from "@/components/panels/NodeDetailStack";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { useEdges } from "@/lib/hooks/useEdges";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodePanels } from "@/lib/hooks/useNodePanels";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { generateNodeId, edgeId } from "@/lib/utils/id";
import type { ProductGraph } from "@/lib/utils/product-scope";
import { buildSystemGraph } from "@/lib/utils/system-graph";
import type { ElkLayoutOptions } from "@/lib/utils/elk-layout";

interface SystemMapProps {
  projectId: string;
  definition: MapDefinition;
}

// Tiered: views feed APIs feed data models — pin the tiers regardless of edge
// shape (spike-verified partitioning; orphans stay in their tier).
const SYSTEM_TIERED_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "layered",
  direction: "DOWN",
  layoutEdgeTypes: ["calls", "displays", "queries"],
  partitionByNodeType: { view: 0, apiEndpoint: 1, dataModel: 2 },
};

// Organic: force-directed structure with overlap removal — at whole-product
// scale the tiered rendition degenerates into an unreadably wide ribbon
// (docs/spec/maps.md § MapDefinition, layout.algorithm).
const SYSTEM_ORGANIC_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "organic",
  layoutEdgeTypes: ["calls", "displays", "queries"],
};

type SystemLayoutMode = "tiered" | "organic";

/**
 * The System map: the model-centered reading — views, API endpoints, and data
 * models joined by cross-layer edges (docs/spec/maps.md § Built-in Maps).
 * Two renditions: organic (default — cluster/structure reading) and tiered
 * (species tiers — didactic reading), plus a hover/pin neighborhood spotlight
 * for tracing one node's relations inside the dense whole-product picture.
 * Connect-to-create and edge deletion work exactly as on the Journey map;
 * there is no expansion state.
 */
export function SystemMap({ projectId, definition }: SystemMapProps) {
  const { openNode, topNodeId } = useNodePanels();
  // Session-local rendition choice, seeded from the definition's layout hint
  // (organic is the system kind's default — docs/spec/maps.md).
  const [layoutMode, setLayoutMode] = useState<SystemLayoutMode>(() =>
    definition.layout?.algorithm === "layered" ? "tiered" : "organic",
  );
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);
  const [deleteEdgeTarget, setDeleteEdgeTarget] = useState<DataEdge | null>(null);
  const [deleteEdgeDialogOpen, setDeleteEdgeDialogOpen] = useState(false);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(projectId);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(projectId);
  const { project: projectBundle } = useProject(projectId);
  // The shell's scope (§ Decision 2), passed down to the canvas cards and to
  // every panel this map opens — never read from a global by the cards
  // themselves. It is also the map's *default* product: `mapScopedNodes` lets
  // the definition's own `product` override it (docs/spec/maps.md § Product Scope).
  const scope = useEffectiveProduct(projectId, projectBundle);
  const { journal } = useJournal(projectId);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  // Built once per snapshot — `buildProductUsageIndex` is a graph traversal and
  // must never run per node. The canvas renders nothing until `edgesLoading` is
  // false (the early return below), so no reader ever sees the empty-edge
  // answer that would misplace every data model and endpoint for one frame.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataEdges, dataNodes]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const graph = useMemo(
    () =>
      buildSystemGraph(
        definition,
        dataNodes,
        dataEdges,
        { onOpenDetails: (node) => openNode({ nodeId: node.id }) },
        { scope, graph: productGraph },
      ),
    [dataEdges, dataNodes, definition, openNode, productGraph, scope],
  );

  const { nodes, layoutVersion } = useElkLayout(
    graph,
    layoutMode === "tiered" ? SYSTEM_TIERED_LAYOUT_OPTIONS : SYSTEM_ORGANIC_LAYOUT_OPTIONS,
  );

  // Re-frame the viewport when a layout the user asked for lands: armed at
  // mount (ReactFlow's one-time fitView fires while nodes still sit at the
  // origin) and re-armed on each rendition switch. Data-edit relayouts leave
  // the ref unarmed so they never yank the viewport while someone works.
  const pendingFitRef = useRef(true);
  const [fitSignal, setFitSignal] = useState(0);

  useEffect(() => {
    if (layoutVersion === 0 || !pendingFitRef.current) return;
    // Consume the flag inside the frame callback: if a second layout lands
    // before the frame fires (StrictMode's doubled effects), the cleanup
    // cancels this frame and the still-armed ref re-schedules — exactly one fit.
    const frame = requestAnimationFrame(() => {
      pendingFitRef.current = false;
      setFitSignal((value) => value + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutVersion]);

  // The canvas is a grid cell now: opening a panel narrows it and closing one
  // gives the room back, so re-frame rather than leave the map half off-cell.
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);

  const handleLayoutModeChange = useCallback((value: string) => {
    pendingFitRef.current = true;
    setLayoutMode(value === "tiered" ? "tiered" : "organic");
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, xyNode) => {
      const dataNode = nodesById.get(xyNode.id);
      if (dataNode) openNode({ nodeId: dataNode.id });
    },
    [nodesById, openNode],
  );

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setPendingConnection(connection);
    setEdgeDialogOpen(true);
  }, []);

  const handleEdgeTypeSelect = useCallback(
    async (edgeType: EdgeTypeId) => {
      if (!pendingConnection?.source || !pendingConnection?.target) return;
      await addEdge({
        id: edgeId(pendingConnection.source, pendingConnection.target),
        project_id: projectId,
        source_id: pendingConnection.source,
        target_id: pendingConnection.target,
        edge_type: edgeType,
      });
      setEdgeDialogOpen(false);
      setPendingConnection(null);
    },
    [addEdge, pendingConnection, projectId],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, xyEdge) => {
      const edge = dataEdges.find((candidate) => candidate.id === xyEdge.id);
      if (!edge) return;
      setDeleteEdgeTarget(edge);
      setDeleteEdgeDialogOpen(true);
    },
    [dataEdges],
  );

  const handleDeleteEdgeConfirm = useCallback(async () => {
    if (!deleteEdgeTarget) return;
    await removeEdge(deleteEdgeTarget.id);
    setDeleteEdgeDialogOpen(false);
    setDeleteEdgeTarget(null);
  }, [deleteEdgeTarget, removeEdge]);

  const handleNodeUpdate = useCallback(
    async (nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) => {
      await updateNode(nodeId, patch);
    },
    [updateNode],
  );

  const handleCreateNodeFromPanel = useCallback(
    async (species: "flow" | "view", title: string) =>
      addNode({
        id: generateNodeId(species, title, nodesById.keys()),
        project_id: projectId,
        title,
        species,
        status: "idea",
        platforms: [],
      }),
    [addNode, nodesById, projectId],
  );

  const handleCreateNode = useCallback(
    async (data: NewNodeFormData) => {
      await addNode({
        id: generateNodeId(data.species, data.title, nodesById.keys()),
        project_id: projectId,
        title: data.title,
        species: data.species,
        status: data.status,
        platforms: data.platforms,
        metadata: data.metadata,
      });
      setNewNodeOpen(false);
    },
    [addNode, nodesById, projectId],
  );

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {projectBundle?.project.title ?? "Untitled project"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {definition.id !== "system" ? `Maps · ${definition.title}` : "Maps · System"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Select value={layoutMode} onValueChange={handleLayoutModeChange}>
            <SelectTrigger className="h-8 w-[120px]" aria-label="Layout algorithm">
              <SelectValue placeholder="Layout" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organic">Organic</SelectItem>
              <SelectItem value="tiered">Tiered</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </header>
      <NodeDetailStack
        rootLabel={definition.id !== "system" ? `Maps · ${definition.title}` : "Maps · System"}
        onLayoutChange={reframe}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
        onCreateNode={handleCreateNodeFromPanel}
      >
        <Canvas
          nodes={nodes}
          edges={graph.edges}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          fitSignal={fitSignal}
          spotlight
          spotlightNodeId={topNodeId}
          scope={scope}
        />
      </NodeDetailStack>
      <NewNodeForm open={newNodeOpen} onOpenChange={setNewNodeOpen} onSubmit={handleCreateNode} />
      <EdgeTypeDialog
        open={edgeDialogOpen}
        onOpenChange={(open) => {
          setEdgeDialogOpen(open);
          if (!open) setPendingConnection(null);
        }}
        onSelect={handleEdgeTypeSelect}
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

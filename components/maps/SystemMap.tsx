"use client";

import { useCallback, useMemo, useState } from "react";
import { type Connection, type EdgeMouseHandler, type NodeMouseHandler } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import type { MapDefinition } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { useEdges } from "@/lib/hooks/useEdges";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { generateNodeId, edgeId } from "@/lib/utils/id";
import { buildSystemGraph } from "@/lib/utils/system-graph";
import type { ElkLayoutOptions } from "@/lib/utils/elk-layout";

interface SystemMapProps {
  projectId: string;
  definition: MapDefinition;
}

// Views feed APIs feed data models — pin the tiers regardless of edge shape
// (spike-verified partitioning; orphans stay in their tier).
const SYSTEM_LAYOUT_OPTIONS: ElkLayoutOptions = {
  direction: "DOWN",
  layoutEdgeTypes: ["calls", "displays", "queries"],
  partitionByNodeType: { view: 0, apiEndpoint: 1, dataModel: 2 },
};

/**
 * The System map: the model-centered reading — views, API endpoints, and data
 * models joined by cross-layer edges, ELK-layered into species tiers
 * (docs/spec/maps.md § Built-in Maps). Connect-to-create and edge deletion
 * work exactly as on the Journey map; there is no expansion state.
 */
export function SystemMap({ projectId, definition }: SystemMapProps) {
  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);
  const [deleteEdgeTarget, setDeleteEdgeTarget] = useState<DataEdge | null>(null);
  const [deleteEdgeDialogOpen, setDeleteEdgeDialogOpen] = useState(false);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(projectId);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(projectId);
  const { project: projectBundle } = useProject(projectId);
  const { journal } = useJournal(projectId);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const graph = useMemo(
    () =>
      buildSystemGraph(definition, dataNodes, dataEdges, {
        onOpenDetails: (node) => {
          setSelectedNode(node);
          setPanelOpen(true);
        },
      }),
    [dataEdges, dataNodes, definition],
  );

  const { nodes, ready } = useElkLayout(graph, SYSTEM_LAYOUT_OPTIONS);

  // ReactFlow's one-time fitView fires while nodes still sit at the origin.
  // `ready` flips exactly once when the first ELK layout lands (large graphs
  // take seconds), so deriving the signal re-frames the viewport right then.
  const fitSignal = ready ? 1 : 0;

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, xyNode) => {
      const dataNode = nodesById.get(xyNode.id);
      if (dataNode) {
        setSelectedNode(dataNode);
        setPanelOpen(true);
      }
    },
    [nodesById],
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
      const updated = await updateNode(nodeId, patch);
      setSelectedNode(updated);
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
          <Button size="sm" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 relative">
        <Canvas
          nodes={nodes}
          edges={graph.edges}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          fitSignal={fitSignal}
        />
      </div>
      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleNodeUpdate}
        allNodes={dataNodes}
        allEdges={dataEdges}
        journal={journal}
        onNavigate={setSelectedNode}
        onCreateNode={handleCreateNodeFromPanel}
      />
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

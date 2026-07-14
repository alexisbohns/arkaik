"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { type Node, type NodeMouseHandler, type Connection, type EdgeMouseHandler } from "@xyflow/react";
import { Code2Icon, DownloadIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { MapDefinition } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { RawBundleSheet } from "@/components/panels/RawBundleSheet";
import { ShotPreviewDialog } from "@/components/panels/ShotPreviewDialog";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { InsertBetweenDialog, type InsertEntryType } from "@/components/panels/InsertBetweenDialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { downloadJson, exportProject } from "@/lib/utils/export";
import { generateNodeId, edgeId } from "@/lib/utils/id";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { SpeciesId } from "@/lib/config/species";
import type { PlatformId } from "@/lib/config/platforms";
import type { Node as DataNode, Edge as DataEdge, PlaylistEntry } from "@/lib/data/types";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import {
  VISUAL_NODE_ID_SEPARATOR,
  collectReferencedNodeIds,
  createPlaylistEntryForSpecies,
  getBaseNodeId,
  getPlaylistEntries,
} from "@/lib/utils/graph-build";
import {
  buildJourneyGraph,
  computeComposeClosure,
  computeViewApiRelations,
  type ViewCardVariant,
} from "@/lib/utils/journey-graph";

interface JourneyMapProps {
  projectId: string;
  /** The map being rendered — a scoped journey overrides the anchor via `root_node_id`. */
  definition?: MapDefinition;
}

/**
 * The Journey map: the navigation-centered compose/playlist drill-down canvas
 * with full editing (vision.md § Core Product). Extracted from the former
 * canvas page; graph construction lives in lib/utils/journey-graph.ts.
 */
export function JourneyMap({ projectId, definition }: JourneyMapProps) {
  const id = projectId;

  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [zoomNode, setZoomNode] = useState<DataNode | null>(null);
  const [zoomPlatform, setZoomPlatform] = useState<PlatformId | undefined>(undefined);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [newNodePreset, setNewNodePreset] = useState<{ parentId: string; species: SpeciesId; insertBeforeId?: string } | null>(null);
  const [insertBetweenOpen, setInsertBetweenOpen] = useState(false);
  const [insertBetweenType, setInsertBetweenType] = useState<InsertEntryType>("view");
  const [insertBetweenContext, setInsertBetweenContext] = useState<{
    parentId: string;
    insertBeforeId: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNode, removeNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(id);
  const { project: projectBundle, loading: projectLoading, updateProject } = useProject(id);
  const { journal } = useJournal(id);

  const viewCardVariant: ViewCardVariant = projectBundle?.project.metadata?.view_card_variant === "large"
    ? "large"
    : "compact";

  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );

  const composeChildIdsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of dataEdges) {
      if (edge.edge_type !== "composes") continue;
      const children = map.get(edge.source_id) ?? [];
      children.push(edge.target_id);
      map.set(edge.source_id, children);
    }
    return map;
  }, [dataEdges]);

  const composeParentByChild = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of dataEdges) {
      if (edge.edge_type !== "composes") continue;
      if (!map.has(edge.target_id)) {
        map.set(edge.target_id, edge.source_id);
      }
    }
    return map;
  }, [dataEdges]);

  const explicitRootNode = useMemo(() => {
    const rootNodeId = definition?.root_node_id ?? projectBundle?.project.root_node_id;
    if (!rootNodeId) return null;
    return nodesById.get(rootNodeId) ?? null;
  }, [definition?.root_node_id, nodesById, projectBundle?.project.root_node_id]);

  const composeClosure = useMemo(
    () => computeComposeClosure(explicitRootNode, composeChildIdsByParent, nodesById),
    [composeChildIdsByParent, explicitRootNode, nodesById],
  );

  const topLevelFlowIds = useMemo(() => {
    if (explicitRootNode) {
      return composeClosure.flowIds;
    }

    return new Set(
      dataNodes
        .filter((node) => node.species === "flow" && !composeParentByChild.has(node.id))
        .map((node) => node.id),
    );
  }, [composeClosure, composeParentByChild, dataNodes, explicitRootNode]);

  const allFlowIds = useMemo(
    () => new Set(dataNodes.filter((node) => node.species === "flow").map((node) => node.id)),
    [dataNodes],
  );

  const viewApiRelationsByViewId = useMemo(
    () => computeViewApiRelations(dataEdges, nodesById),
    [dataEdges, nodesById],
  );

  const getPlaylist = useCallback((nodeId: string): string[] => {
    return collectReferencedNodeIds(getPlaylistEntries(nodesById, nodeId));
  }, [nodesById]);

  // Prune expansion entries whose flow no longer exists.
  useEffect(() => {
    setExpandedFlows((prev) => {
      const next = new Set<string>();

      for (const flowId of prev) {
        if (allFlowIds.has(flowId)) {
          next.add(flowId);
        }
      }

      if (next.size === prev.size) {
        return prev;
      }

      return next;
    });
  }, [allFlowIds]);

  // Expand the first top-level flow once on initial load so a fresh project
  // opens on a real map instead of a bare root. Gated on all three sources:
  // nodes/edges resolve before the project bundle, and during that window the
  // top-level set is computed without the explicit root (orphan flows only).
  // The decision also lives outside the state updater (updaters must stay
  // pure — StrictMode double-invokes them).
  const autoExpandedRef = useRef(false);
  const pendingFitFlowRef = useRef<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  useEffect(() => {
    if (autoExpandedRef.current || nodesLoading || edgesLoading || projectLoading) return;
    if (topLevelFlowIds.size === 0) return;
    autoExpandedRef.current = true;

    const [firstTopLevelFlowId] = topLevelFlowIds;
    pendingFitFlowRef.current = firstTopLevelFlowId;
    setExpandedFlows((prev) => (prev.size === 0 ? new Set([firstTopLevelFlowId]) : prev));
  }, [edgesLoading, nodesLoading, projectLoading, topLevelFlowIds]);

  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);

  const [deleteNodeTarget, setDeleteNodeTarget] = useState<DataNode | null>(null);
  const [deleteNodeDialogOpen, setDeleteNodeDialogOpen] = useState(false);
  const [deleteNodeCascade, setDeleteNodeCascade] = useState(false);

  const getDescendantIds = useCallback(
    (nodeId: string): string[] => {
      const result: string[] = [];
      const visited = new Set<string>();
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const composedChildren = composeChildIdsByParent.get(current) ?? [];
        const playlistChildren = getPlaylist(current);
        const children = [...new Set([...composedChildren, ...playlistChildren])]
          .map((childId) => nodesById.get(childId))
          .filter((child): child is DataNode => Boolean(child));
        for (const child of children) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          result.push(child.id);
          queue.push(child.id);
        }
      }
      return result;
    },
    [composeChildIdsByParent, getPlaylist, nodesById],
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

  const [deleteEdgeTarget, setDeleteEdgeTarget] = useState<DataEdge | null>(null);
  const [deleteEdgeDialogOpen, setDeleteEdgeDialogOpen] = useState(false);

  const deleteNodeDescendantCount = useMemo(
    () => (deleteNodeTarget ? getDescendantIds(deleteNodeTarget.id).length : 0),
    [deleteNodeTarget, getDescendantIds],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>((_event, xyEdge) => {
    if (xyEdge.id.startsWith("compose-")) return;
    const edgeIdPart = xyEdge.id.split("--")[0];
    const edge = dataEdges.find((e) => e.id === edgeIdPart);
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

  const toggleFlow = useCallback((flowId: string) => {
    setExpandedFlows((prev) => {
      if (topLevelFlowIds.has(flowId)) {
        if (prev.has(flowId)) {
          const next = new Set(prev);
          next.delete(flowId);
          return next;
        }

        const next = new Set(prev);
        for (const topLevelFlowId of topLevelFlowIds) {
          next.delete(topLevelFlowId);
        }
        next.add(flowId);
        return next;
      }

      const next = new Set(prev);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
      }
      return next;
    });
  }, [topLevelFlowIds]);

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

  const handleCreateNodeFromPanel = useCallback(
    async (species: "flow" | "view", title: string) => {
      const createdNode = await addNode({
        id: generateNodeId(species, title, nodesById.keys()),
        project_id: id,
        title,
        species,
        status: "idea",
        platforms: [],
      });

      return createdNode;
    },
    [addNode, id, nodesById],
  );

  const handleInsertPlaylistEntry = useCallback(
    async (parentId: string, entry: PlaylistEntry, insertBeforeId: string) => {
      const parentNode = nodesById.get(parentId);
      if (!parentNode || parentNode.species !== "flow") return false;

      if (entry.type === "view" || entry.type === "flow") {
        const nodeId = entry.type === "view" ? entry.view_id : entry.flow_id;

        if (entry.type === "flow") {
          if (wouldCreateCycle(parentNode.id, nodeId, dataNodes)) {
            setPlaylistError(`Cannot add Flow ${nodeId}: it would create a circular reference.`);
            return false;
          }
        }

        const hasComposeEdge = dataEdges.some(
          (edge) => edge.edge_type === "composes" && edge.source_id === parentId && edge.target_id === nodeId,
        );

        if (!hasComposeEdge) {
          await addEdge({
            id: edgeId(parentId, nodeId),
            project_id: id,
            source_id: parentId,
            target_id: nodeId,
            edge_type: "composes",
          });
        }
      }

      const existingEntries = Array.isArray(parentNode.metadata?.playlist?.entries)
        ? [...parentNode.metadata.playlist.entries]
        : [];

      const existingPlaylistIds = collectReferencedNodeIds(existingEntries);
      const insertIndex = existingPlaylistIds.indexOf(insertBeforeId);

      if (insertIndex >= 0) {
        existingEntries.splice(insertIndex, 0, entry);
      } else {
        existingEntries.push(entry);
      }

      await updateNode(parentNode.id, {
        metadata: {
          ...parentNode.metadata,
          playlist: {
            entries: existingEntries,
          },
        },
      });
      return true;
    },
    [addEdge, dataEdges, dataNodes, id, nodesById, updateNode],
  );

  const handleAddChildNode = useCallback((parentId: string, childSpecies: SpeciesId) => {
    setNewNodePreset({ parentId, species: childSpecies });
    setNewNodeOpen(true);
  }, []);

  const handleInsertBetween = useCallback((parentFlowVisualId: string, targetEntryVisualId: string) => {
    const parentId = getBaseNodeId(parentFlowVisualId);
    const insertBeforeId = getBaseNodeId(targetEntryVisualId);
    const parentNode = nodesById.get(parentId);
    if (!parentNode || parentNode.species !== "flow") return;
    setInsertBetweenType("view");
    setInsertBetweenContext({ parentId, insertBeforeId });
    setInsertBetweenOpen(true);
  }, [nodesById]);

  const handleInsertBetweenSelect = useCallback(async (nodeId: string) => {
    if (!insertBetweenContext) return;
    if (insertBetweenType !== "view" && insertBetweenType !== "flow") return;
    const entry = createPlaylistEntryForSpecies(insertBetweenType, nodeId);
    if (!entry) return;
    setPlaylistError(null);
    const inserted = await handleInsertPlaylistEntry(
      insertBetweenContext.parentId,
      entry,
      insertBetweenContext.insertBeforeId,
    );
    if (inserted) {
      setInsertBetweenOpen(false);
      setInsertBetweenContext(null);
    }
  }, [handleInsertPlaylistEntry, insertBetweenContext, insertBetweenType]);

  const handleInsertBetweenCreate = useCallback(async (title: string) => {
    if (!insertBetweenContext) return;
    if (insertBetweenType !== "view" && insertBetweenType !== "flow") return;
    setPlaylistError(null);
    const createdNode = await handleCreateNodeFromPanel(insertBetweenType, title);
    const entry = createPlaylistEntryForSpecies(insertBetweenType, createdNode.id);
    if (!entry) return;
    const inserted = await handleInsertPlaylistEntry(
      insertBetweenContext.parentId,
      entry,
      insertBetweenContext.insertBeforeId,
    );
    if (inserted) {
      setInsertBetweenOpen(false);
      setInsertBetweenContext(null);
    }
  }, [handleCreateNodeFromPanel, handleInsertPlaylistEntry, insertBetweenContext, insertBetweenType]);

  const handleInsertBetweenStructured = useCallback(async (label: string) => {
    if (!insertBetweenContext) return;
    if (insertBetweenType !== "condition" && insertBetweenType !== "junction") return;

    const entry: PlaylistEntry = insertBetweenType === "condition"
      ? {
          type: "condition",
          label: label.trim() || "Condition",
          if_true: [],
          if_false: [],
        }
      : {
          type: "junction",
          label: label.trim() || "Junction",
          cases: [{ label: "Case 1", entries: [] }],
        };

    setPlaylistError(null);
    const inserted = await handleInsertPlaylistEntry(
      insertBetweenContext.parentId,
      entry,
      insertBetweenContext.insertBeforeId,
    );

    if (inserted) {
      setInsertBetweenOpen(false);
      setInsertBetweenContext(null);
    }
  }, [handleInsertPlaylistEntry, insertBetweenContext, insertBetweenType]);

  const handleNewNodeOpenChange = useCallback((open: boolean) => {
    setNewNodeOpen(open);
    if (!open) setNewNodePreset(null);
  }, []);

  const handleAddNode = useCallback(
    async (data: NewNodeFormData) => {
      const preset = newNodePreset;
      const parentId = preset?.parentId;
      const insertBeforeId = preset?.insertBeforeId;
      const newNodeId = generateNodeId(data.species, data.title, nodesById.keys());

      setPlaylistError(null);

      const createdNode = await addNode({
        id: newNodeId,
        project_id: id,
        title: data.title,
        species: data.species,
        status: data.status,
        platforms: data.platforms,
        metadata: data.metadata,
      });

      if (parentId) {
        const parentNode = nodesById.get(parentId);
        if (parentNode && parentNode.species === "flow" && data.species === "flow") {
          const nodesForValidation = [
            ...dataNodes.filter((node) => node.id !== createdNode.id),
            createdNode,
          ];

          if (wouldCreateCycle(parentNode.id, createdNode.id, nodesForValidation)) {
            await removeNode(createdNode.id);
            setPlaylistError(`Cannot add Flow ${createdNode.id}: it would create a circular reference.`);
            return;
          }
        }

        await addEdge({
          id: edgeId(parentId, newNodeId),
          project_id: id,
          source_id: parentId,
          target_id: newNodeId,
          edge_type: "composes",
        });

        if (parentNode) {
          const existingEntries = Array.isArray(parentNode.metadata?.playlist?.entries)
            ? [...parentNode.metadata.playlist.entries]
            : [];
          const newEntry = createPlaylistEntryForSpecies(data.species, newNodeId);

          if (newEntry) {
            const existingPlaylistIds = collectReferencedNodeIds(existingEntries);
            const insertIndex = insertBeforeId ? existingPlaylistIds.indexOf(insertBeforeId) : -1;

            if (insertIndex >= 0) {
              existingEntries.splice(insertIndex, 0, newEntry);
            } else {
              existingEntries.push(newEntry);
            }
          }

          await updateNode(parentNode.id, {
            metadata: {
              ...parentNode.metadata,
              playlist: {
                entries: existingEntries,
              },
            },
          });
        }
      }

      setNewNodePreset(null);
      setNewNodeOpen(false);
    },
    [addEdge, addNode, dataNodes, id, newNodePreset, nodesById, removeNode, updateNode],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, xyNode) => {
    const dataNodeId = getBaseNodeId(xyNode.id);
    const dataNode = dataNodes.find((n) => n.id === dataNodeId);
    if (dataNode) {
      setSelectedNode(dataNode);
      setPanelOpen(true);
    }
  }, [dataNodes]);

  const handleViewCardVariantChange = useCallback(
    async (variant: ViewCardVariant) => {
      if (!projectBundle) return;

      try {
        await updateProject({
          metadata: {
            ...(projectBundle.project.metadata ?? {}),
            view_card_variant: variant,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown settings save error";
        toast.error(`Unable to save card preference: ${message}`);
      }
    },
    [projectBundle, updateProject],
  );

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setPendingConnection(connection);
    setEdgeDialogOpen(true);
  }, []);

  const handleEdgeTypeSelect = useCallback(async (edgeType: EdgeTypeId) => {
    if (!pendingConnection?.source || !pendingConnection?.target) return;
    const sourceId = getBaseNodeId(pendingConnection.source);
    const targetId = getBaseNodeId(pendingConnection.target);
    await addEdge({
      id: edgeId(sourceId, targetId),
      project_id: id,
      source_id: sourceId,
      target_id: targetId,
      edge_type: edgeType,
    });
    setEdgeDialogOpen(false);
    setPendingConnection(null);
  }, [pendingConnection, addEdge, id]);

  const handleExport = useCallback(async () => {
    if (!id) {
      setExportError("Unable to export: missing project id.");
      return;
    }

    setExporting(true);
    setExportError(null);
    setExportWarning(null);
    try {
      const bundle = await exportProject(id);
      const result = downloadJson(bundle);
      setExportWarning(result.warning);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export error";
      setExportError(`Unable to export project: ${message}`);
      setExportWarning(null);
    } finally {
      setExporting(false);
    }
  }, [id]);

  useKeyboardShortcuts({
    onEscape: () => {
      if (!panelOpen) return;
      setPanelOpen(false);
    },
    onDelete: () => {
      if (deleteNodeDialogOpen || deleteEdgeDialogOpen || newNodeOpen || insertBetweenOpen || edgeDialogOpen) return;
      if (!selectedNode) return;
      handleDeleteNodeRequest(selectedNode.id);
    },
    onExport: () => {
      if (exporting) return;
      void handleExport();
    },
  });

  // Build graph topology - ELK will compute positions asynchronously.
  const graphData = useMemo(
    () =>
      buildJourneyGraph({
        dataNodes,
        dataEdges,
        nodesById,
        composeParentByChild,
        explicitRootNode,
        composeClosure,
        expandedFlows,
        viewCardVariant,
        viewApiRelationsByViewId,
        handlers: {
          onToggleFlow: toggleFlow,
          onAddChild: (flowId) => handleAddChildNode(flowId, "view"),
          onOpenDetails: (node) => {
            setSelectedNode(node);
            setPanelOpen(true);
          },
          onZoomShot: (node) => {
            setZoomNode(node);
            setZoomPlatform(undefined);
          },
          onInsertBetween: handleInsertBetween,
        },
      }),
    [
      composeClosure,
      composeParentByChild,
      dataEdges,
      dataNodes,
      expandedFlows,
      explicitRootNode,
      handleAddChildNode,
      handleInsertBetween,
      nodesById,
      toggleFlow,
      viewApiRelationsByViewId,
      viewCardVariant,
    ],
  );

  const { nodes: layoutedNodes } = useElkLayout(graphData);

  // The one-time ReactFlow fitView frames the pre-expansion layout; once the
  // auto-expanded flow's playlist nodes land in a computed layout, re-frame.
  useEffect(() => {
    const flowId = pendingFitFlowRef.current;
    if (!flowId) return;

    const marker = `${VISUAL_NODE_ID_SEPARATOR}${flowId}:`;
    if (!layoutedNodes.some((node: Node) => node.id.includes(marker))) return;

    pendingFitFlowRef.current = null;
    setFitSignal((value) => value + 1);
  }, [layoutedNodes]);

  const nodes = layoutedNodes;
  const edges = graphData.edges;

  if (nodesLoading || edgesLoading || projectLoading) {
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
            {definition && definition.id !== "journey" ? `Maps · ${definition.title}` : "Maps · Journey"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {exportWarning && (
            <span className="text-xs text-amber-700" role="status" aria-live="polite">
              {exportWarning}
            </span>
          )}
          {exportError && (
            <span className="text-xs text-destructive" role="status" aria-live="polite">
              {exportError}
            </span>
          )}
          {playlistError && (
            <span className="text-xs text-destructive" role="status" aria-live="polite">
              {playlistError}
            </span>
          )}
          <Select value={viewCardVariant} onValueChange={(value) => void handleViewCardVariantChange(value as ViewCardVariant)}>
            <SelectTrigger className="h-8 w-[160px]" aria-label="View card variant">
              <SelectValue placeholder="Card style" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">Compact cards</SelectItem>
              <SelectItem value="large">Large cards</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setRawOpen(true)}>
            <Code2Icon className="size-4" />
            Raw
          </Button>
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={handleExport} disabled={exporting}>
            <DownloadIcon className="size-4" />
            {exporting ? "Exporting..." : "Export JSON"}
          </Button>
          <Button size="sm" className="cursor-pointer" onClick={() => { setNewNodePreset(null); setNewNodeOpen(true); }}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 relative">
        <Canvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onConnect={handleConnect} onEdgeClick={handleEdgeClick} fitSignal={fitSignal} />
      </div>
      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleNodeUpdate}
        onDelete={handleDeleteNodeRequest}
        allNodes={dataNodes}
        allEdges={dataEdges}
        journal={journal}
        onNavigate={handleNavigate}
        onCreateNode={handleCreateNodeFromPanel}
        onZoomShot={(node, platform) => {
          setZoomNode(node);
          setZoomPlatform(platform);
        }}
      />
      <ShotPreviewDialog
        open={zoomNode !== null}
        onOpenChange={(open) => { if (!open) setZoomNode(null); }}
        node={zoomNode ?? undefined}
        initialPlatform={zoomPlatform}
      />
      <RawBundleSheet key={rawOpen ? "raw-open" : "raw-closed"} projectId={id} open={rawOpen} onOpenChange={setRawOpen} />
      <NewNodeForm
        key={newNodePreset ? `preset-${newNodePreset.parentId}-${newNodePreset.species}` : "default"}
        open={newNodeOpen}
        onOpenChange={handleNewNodeOpenChange}
        onSubmit={handleAddNode}
        defaultValues={newNodePreset ?? undefined}
      />
      <InsertBetweenDialog
        open={insertBetweenOpen}
        onOpenChange={(open) => {
          setInsertBetweenOpen(open);
          if (!open) setInsertBetweenContext(null);
        }}
        entryType={insertBetweenType}
        onEntryTypeChange={setInsertBetweenType}
        allNodes={dataNodes}
        onSelectNode={handleInsertBetweenSelect}
        onCreateNode={handleInsertBetweenCreate}
        onInsertStructured={handleInsertBetweenStructured}
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

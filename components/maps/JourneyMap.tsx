"use client";

import Link from "next/link";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { type Node, type Edge, type NodeMouseHandler, type Connection, type EdgeMouseHandler } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import {
  buildProductUsageIndex,
  resolveMapDisplay,
  type MapDefinition,
  type MapDisplayOptions,
} from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { MapDisplayPopover } from "@/components/maps/MapDisplayPopover";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { PageShell } from "@/components/layout/PageShell";
import { ShotPreviewDialog } from "@/components/panels/ShotPreviewDialog";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { InsertBetweenDialog, type InsertEntryType } from "@/components/panels/InsertBetweenDialog";
import { Button } from "@/components/ui/button";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProject } from "@/lib/hooks/useProject";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { generateNodeId, edgeId } from "@/lib/utils/id";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { ProductGraph } from "@/lib/utils/product-scope";
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
  computeViewApiRelations,
  resolveJourneySelection,
} from "@/lib/utils/journey-graph";

/** Stable identity, so the empty branch never re-triggers the layout effect. */
const EMPTY_GRAPH: { nodes: Node[]; edges: Edge[] } = { nodes: [], edges: [] };

interface JourneyMapProps {
  projectId: string;
  /** The map being rendered — a scoped journey overrides the anchor via `root_node_id`. */
  definition?: MapDefinition;
}

/**
 * The Journey map: the navigation-centered compose/playlist drill-down canvas
 * with full editing (vision.md § Core Product). Extracted from the former
 * canvas page; graph construction lives in lib/utils/journey-graph.ts.
 *
 * A journey is product-scoped exactly as the System map is — the anchor **and**
 * a membership filter over the candidate nodes, both resolved once by
 * `resolveJourneySelection` (docs/spec/maps.md § Product Scope). When the
 * anchor does not resolve inside the scoped product, the canvas is replaced by
 * an empty state that names the reason; drawing another product's graph under
 * this one's platform menu is the bug that shape exists to prevent.
 */
export function JourneyMap({ projectId, definition }: JourneyMapProps) {
  const id = projectId;

  const { openNode, topPanelNodeId } = useProjectPanels();

  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
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
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNode, removeNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(id);
  const { project: projectBundle, loading: projectLoading, updateProject } = useProject(id);
  // The shell's scope (§ Decision 2), passed down to the canvas cards and to
  // every panel this map opens — never read from a global by the cards
  // themselves. It is also this journey's default product, and so reaches the
  // anchor chain below.
  const scope = useEffectiveProduct(id, projectBundle);
  const { journal } = useJournal(id);

  // Built-in maps have no stored definition to carry a `display`, so the id is
  // what the override record is keyed by — the anonymous mount is the Journey.
  const mapId = definition?.id ?? "journey";
  const display = useMemo(
    () => resolveMapDisplay({ id: mapId, display: definition?.display }, projectBundle?.project),
    [definition?.display, mapId, projectBundle?.project],
  );

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

  // Built once per snapshot — `buildProductUsageIndex` is a graph traversal and
  // must never run per node. The canvas renders nothing until `edgesLoading` is
  // false, so no reader sees the empty-edge answer.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataEdges, dataNodes]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  // The membership restriction, the anchor chain, and the compose closure — one
  // function, shared with the maps index and the Overview's Maps card so a card
  // cannot advertise a count this canvas does not draw (docs/spec/maps.md
  // § Product Scope).
  const selection = useMemo(
    () =>
      resolveJourneySelection({
        definition,
        dataNodes,
        dataEdges,
        project: projectBundle?.project,
        scope,
        graph: productGraph,
      }),
    [dataEdges, dataNodes, definition, productGraph, projectBundle?.project, scope],
  );

  const { anchorNode: explicitRootNode, composeClosure } = selection;

  const topLevelFlowIds = useMemo(() => {
    if (explicitRootNode) {
      return composeClosure.flowIds;
    }

    return new Set(
      selection.nodes
        .filter((node) => node.species === "flow" && !selection.composeParentByChild.has(node.id))
        .map((node) => node.id),
    );
  }, [composeClosure, explicitRootNode, selection]);

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
  //
  // These three effects were invisible to `set-state-in-effect` until this file
  // stopped holding an export handler — that handler made the compiler bail on
  // the whole component, which took its diagnostics with it. They are all
  // convergent by construction rather than cascading: this one returns `prev`
  // untouched when there is nothing to prune, so it settles in one pass.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // The canvas is a grid cell now: opening a panel narrows it and closing one
  // gives the room back, so re-frame rather than leave the map half off-cell.
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);
  useEffect(() => {
    if (autoExpandedRef.current || nodesLoading || edgesLoading || projectLoading) return;
    if (topLevelFlowIds.size === 0) return;
    autoExpandedRef.current = true;

    const [firstTopLevelFlowId] = topLevelFlowIds;
    pendingFitFlowRef.current = firstTopLevelFlowId;
    // Latched by `autoExpandedRef` above — it runs at most once per mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Panels for the deleted nodes close themselves — the stack resolves its
    // entries against `dataNodes` and drops the ones that no longer resolve.
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
      await updateNode(nodeId, patch);
    },
    [updateNode],
  );

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
    if (dataNode) openNode({ nodeId: dataNode.id });
  }, [dataNodes, openNode]);

  /**
   * Display lives per map, not per project: the patch merges into
   * `metadata.map_display[mapId]` so this map's Journey and its Recording Loop
   * keep their own answers (docs/spec/maps.md § Display Options).
   */
  const handleDisplayChange = useCallback(
    async (patch: MapDisplayOptions) => {
      if (!projectBundle) return;

      const metadata = projectBundle.project.metadata ?? {};
      const currentOverrides = metadata.map_display ?? {};

      try {
        await updateProject({
          metadata: {
            ...metadata,
            map_display: {
              ...currentOverrides,
              [mapId]: { ...currentOverrides[mapId], ...patch },
            },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown settings save error";
        toast.error(`Unable to save display preference: ${message}`);
      }
    },
    [mapId, projectBundle, updateProject],
  );

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setPendingConnection(connection);
    setEdgeDialogOpen(true);
  }, []);

  // The dialog offers only the relationships this ordered pair admits (#317).
  // Playlist expansion duplicates a node into several visual ids, so resolve
  // back to the base node before asking what its species is.
  const pendingSpecies = useMemo(
    () => ({
      source: pendingConnection?.source
        ? nodesById.get(getBaseNodeId(pendingConnection.source))?.species ?? null
        : null,
      target: pendingConnection?.target
        ? nodesById.get(getBaseNodeId(pendingConnection.target))?.species ?? null
        : null,
    }),
    [nodesById, pendingConnection],
  );

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

  // Escape belongs to the panel stack while it is non-empty (PanelStack owns it).
  // Export is not here: it acts on the project, so it is registered once in the
  // project layout and works on every page, not only on this canvas.
  useKeyboardShortcuts({
    onDelete: () => {
      if (deleteNodeDialogOpen || deleteEdgeDialogOpen || newNodeOpen || insertBetweenOpen || edgeDialogOpen) return;
      // The panel you can see, not the one the URL names — with a non-node
      // panel on top there is nothing on screen to delete, and this no-ops.
      if (!topPanelNodeId) return;
      handleDeleteNodeRequest(topPanelNodeId);
    },
  });

  // Build graph topology - ELK will compute positions asynchronously. Skipped
  // outright when the selection has nothing to draw: the render below shows the
  // empty state instead, and laying out a graph nobody sees is a real ELK pass.
  const graphData = useMemo(
    () =>
      selection.emptyReason !== null
        ? EMPTY_GRAPH
        : buildJourneyGraph({
            dataNodes: selection.nodes,
            dataEdges,
            nodesById: selection.nodesById,
            composeParentByChild: selection.composeParentByChild,
            explicitRootNode,
            composeClosure,
            expandedFlows,
            display,
            viewApiRelationsByViewId,
            handlers: {
              onToggleFlow: toggleFlow,
              onAddChild: (flowId) => handleAddChildNode(flowId, "view"),
              onOpenDetails: (node) => openNode({ nodeId: node.id }),
              onZoomShot: (node) => {
                setZoomNode(node);
                setZoomPlatform(undefined);
              },
              onInsertBetween: handleInsertBetween,
            },
          }),
    [
      composeClosure,
      dataEdges,
      display,
      expandedFlows,
      explicitRootNode,
      handleAddChildNode,
      handleInsertBetween,
      openNode,
      selection,
      toggleFlow,
      viewApiRelationsByViewId,
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
    // The ref is cleared first, so the re-render this causes takes the early
    // return above rather than bumping the signal again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFitSignal((value) => value + 1);
  }, [layoutedNodes]);

  const nodes = layoutedNodes;
  const edges = graphData.edges;

  // The product this journey reads through, as a reader would name it. Falls
  // back to the id for a scope pointing at a product the project no longer
  // declares, exactly as the selector and the Library badges do.
  const productLabel =
    selection.productId === null
      ? null
      : scope.productsById.get(selection.productId)?.title?.trim() || selection.productId;

  if (nodesLoading || edgesLoading || projectLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph...</span>
      </div>
    );
  }

  return (
    <>
      {/* The title is the map's own name: the sidebar's Maps group already says
          which section this is, so a `Maps ·` prefix would only repeat it. */}
      <PageShell
        title={definition?.title ?? "Journey"}
        action={{
          label: "New node",
          icon: PlusIcon,
          onClick: () => { setNewNodePreset(null); setNewNodeOpen(true); },
        }}
        headerExtra={
          <>
            {playlistError && (
              <span className="text-xs text-destructive" role="status" aria-live="polite">
                {playlistError}
              </span>
            )}
            <MapDisplayPopover
              value={display}
              onChange={(patch) => void handleDisplayChange(patch)}
              mapTitle={definition?.title ?? "Journey"}
            />
          </>
        }
        surfaceCard
        onLayoutChange={reframe}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
        onDelete={handleDeleteNodeRequest}
        onCreateNode={handleCreateNodeFromPanel}
        onZoomShot={(node, platform) => {
          setZoomNode(node);
          setZoomPlatform(platform);
        }}
      >
        {selection.emptyReason !== null ? (
          /* An unresolved anchor under a named product is answered in words,
             never with the unanchored parentless-roots render: that fallback
             would draw whatever this product happens to own with no explanation
             of why the journey is not the journey (docs/spec/maps.md
             § Subgraph Algorithm, rule 4). */
          <div className="h-full w-full flex items-center justify-center p-6">
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {selection.emptyReason === "no-anchor"
                  ? `${productLabel} has no journey anchor yet — give it a root node in Settings, or read it on the System map.`
                  : `This map is anchored on ${selection.anchorId}, which is not part of ${productLabel} — switch products, or read ${productLabel} on the System map.`}
              </p>
              <Button asChild size="sm" variant="outline" className="mt-4 cursor-pointer">
                <Link href={`/project/${id}/maps/system`}>Open the System map</Link>
              </Button>
            </div>
          </div>
        ) : (
          <Canvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onConnect={handleConnect} onEdgeClick={handleEdgeClick} fitSignal={fitSignal} scope={scope} />
        )}
      </PageShell>
      <ShotPreviewDialog
        open={zoomNode !== null}
        onOpenChange={(open) => { if (!open) setZoomNode(null); }}
        node={zoomNode ?? undefined}
        initialPlatform={zoomPlatform}
      />
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
        sourceSpecies={pendingSpecies.source}
        targetSpecies={pendingSpecies.target}
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
    </>
  );
}

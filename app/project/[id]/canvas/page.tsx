"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useMemo, useEffect } from "react";
import { type Edge, type Node, type NodeMouseHandler, type Connection, type EdgeMouseHandler } from "@xyflow/react";
import { Code2Icon, CopyIcon, DownloadIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { InsertBetweenDialog, type InsertEntryType } from "@/components/panels/InsertBetweenDialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProject } from "@/lib/hooks/useProject";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { assertProjectBundleShape, downloadJson, exportProject, importProject, normalizeProjectTimestamps } from "@/lib/utils/export";
import { generateNodeId } from "@/lib/utils/id";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { SpeciesId } from "@/lib/config/species";
import type { Node as DataNode, Edge as DataEdge, PlaylistEntry, ProjectBundle } from "@/lib/data/types";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  addNodeToRollup,
  computePlaylistRollup,
  createEmptyRollup,
  getEditablePlatformStatuses,
  getRollupDisplayStatus,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";
import { computeElkLayout } from "@/lib/utils/elk-layout";

const SPECIES_TO_NODE_TYPE: Record<SpeciesId, string> = {
  flow: "flow",
  view: "view",
  "data-model": "dataModel",
  "api-endpoint": "apiEndpoint",
};

const FLOW_CHILD_SPECIES = new Set<SpeciesId>(["flow", "view"]);

interface RenderSequenceResult {
  startIds: string[];
  endIds: string[];
  entryNodeId?: string;
}

type ViewCardVariant = "compact" | "large";

interface ViewApiRelation {
  apiId: string;
  title: string;
  status: DataNode["status"];
  edgeType: EdgeTypeId;
}

const VISUAL_NODE_ID_SEPARATOR = "@";

function createVisualNodeId(nodeId: string, parentFlowId: string, entryIndex: number): string {
  return `${nodeId}${VISUAL_NODE_ID_SEPARATOR}${parentFlowId}:${entryIndex}`;
}

function getBaseNodeId(nodeId: string): string {
  const separatorIndex = nodeId.indexOf(VISUAL_NODE_ID_SEPARATOR);
  return separatorIndex >= 0 ? nodeId.slice(0, separatorIndex) : nodeId;
}

function collectReferencedNodeIds(entries: PlaylistEntry[]): string[] {
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.type === "view") {
      result.push(entry.view_id);
      continue;
    }

    if (entry.type === "flow") {
      result.push(entry.flow_id);
      continue;
    }

    if (entry.type === "condition") {
      result.push(...collectReferencedNodeIds(entry.if_true));
      result.push(...collectReferencedNodeIds(entry.if_false));
      continue;
    }

    for (const playlistCase of entry.cases) {
      result.push(...collectReferencedNodeIds(playlistCase.entries));
    }
  }

  return result;
}

function createPlaylistEntryForSpecies(species: SpeciesId, nodeId: string): PlaylistEntry | null {
  if (species === "view") {
    return { type: "view", view_id: nodeId };
  }

  if (species === "flow") {
    return { type: "flow", flow_id: nodeId };
  }

  return null;
}

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const [rawMode, setRawMode] = useState<"view" | "edit">("view");
  const [rawFormat, setRawFormat] = useState<"json" | "yaml">("json");
  const [rawBundle, setRawBundle] = useState<ProjectBundle | null>(null);
  const [rawDraftJson, setRawDraftJson] = useState("");
  const [rawDraftYaml, setRawDraftYaml] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawCopied, setRawCopied] = useState(false);
  const [rawConfirmEnterEditOpen, setRawConfirmEnterEditOpen] = useState(false);
  const [rawConfirmCancelOpen, setRawConfirmCancelOpen] = useState(false);
  const [rawConfirmSaveOpen, setRawConfirmSaveOpen] = useState(false);
  const [rawPendingClose, setRawPendingClose] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNode, removeNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(id);
  const { project: projectBundle, loading: projectLoading, updateProject } = useProject(id);

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
    const rootNodeId = projectBundle?.project.root_node_id;
    if (!rootNodeId) return null;
    return nodesById.get(rootNodeId) ?? null;
  }, [nodesById, projectBundle?.project.root_node_id]);

  const topLevelFlowIds = useMemo(() => {
    if (explicitRootNode) {
      const ids = new Set<string>();

      if (explicitRootNode.species === "flow") {
        ids.add(explicitRootNode.id);
      }

      const rootChildFlowIds = (composeChildIdsByParent.get(explicitRootNode.id) ?? [])
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is DataNode => Boolean(node))
        .filter((node) => node.species === "flow")
        .map((node) => node.id);

      for (const flowId of rootChildFlowIds) {
        ids.add(flowId);
      }

      return ids;
    }

    return new Set(
      dataNodes
        .filter((node) => node.species === "flow" && !composeParentByChild.has(node.id))
        .map((node) => node.id),
    );
  }, [composeChildIdsByParent, composeParentByChild, dataNodes, explicitRootNode, nodesById]);

  const allFlowIds = useMemo(
    () => new Set(dataNodes.filter((node) => node.species === "flow").map((node) => node.id)),
    [dataNodes],
  );

  const viewApiRelationsByViewId = useMemo(() => {
    const map = new Map<string, { inbound: ViewApiRelation[]; outbound: ViewApiRelation[] }>();

    for (const edge of dataEdges) {
      if (edge.edge_type !== "calls") continue;

      const sourceNode = nodesById.get(edge.source_id);
      const targetNode = nodesById.get(edge.target_id);
      if (!sourceNode || !targetNode) continue;

      if (sourceNode.species === "api-endpoint" && targetNode.species === "view") {
        const current = map.get(targetNode.id) ?? { inbound: [], outbound: [] };
        if (!current.inbound.some((relation) => relation.apiId === sourceNode.id)) {
          current.inbound.push({
            apiId: sourceNode.id,
            title: sourceNode.title,
            status: sourceNode.status,
            edgeType: edge.edge_type,
          });
          map.set(targetNode.id, current);
        }
        continue;
      }

      if (sourceNode.species === "view" && targetNode.species === "api-endpoint") {
        const current = map.get(sourceNode.id) ?? { inbound: [], outbound: [] };
        if (!current.outbound.some((relation) => relation.apiId === targetNode.id)) {
          current.outbound.push({
            apiId: targetNode.id,
            title: targetNode.title,
            status: targetNode.status,
            edgeType: edge.edge_type,
          });
          map.set(sourceNode.id, current);
        }
      }
    }

    return map;
  }, [dataEdges, nodesById]);

  const getPlaylistEntries = useCallback((nodeId: string): PlaylistEntry[] => {
    const entries = nodesById.get(nodeId)?.metadata?.playlist?.entries;
    return Array.isArray(entries) ? entries : [];
  }, [nodesById]);

  const getPlaylist = useCallback((nodeId: string): string[] => {
    return collectReferencedNodeIds(getPlaylistEntries(nodeId));
  }, [getPlaylistEntries]);

  // Auto-expand root flows on initial load.
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
        id: generateNodeId(species),
        project_id: id,
        title,
        species,
        status: "idea",
        platforms: [],
      });

      return createdNode;
    },
    [addNode, id],
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
            id: crypto.randomUUID(),
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
      const newNodeId = generateNodeId(data.species);

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
          id: crypto.randomUUID(),
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
    await addEdge({
      id: crypto.randomUUID(),
      project_id: id,
      source_id: getBaseNodeId(pendingConnection.source),
      target_id: getBaseNodeId(pendingConnection.target),
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

  const rawBaseText = useMemo(() => {
    if (!rawBundle) return "";
    return rawFormat === "json" ? JSON.stringify(rawBundle, null, 2) : stringifyYaml(rawBundle);
  }, [rawBundle, rawFormat]);

  const rawInitialTexts = useMemo(() => {
    if (!rawBundle) {
      return { json: "", yaml: "" };
    }

    return {
      json: JSON.stringify(rawBundle, null, 2),
      yaml: stringifyYaml(rawBundle),
    };
  }, [rawBundle]);

  const rawDraftText = rawFormat === "json" ? rawDraftJson : rawDraftYaml;
  const rawViewportText = rawMode === "edit" ? rawDraftText : rawBaseText;
  const rawHasUnsavedChanges = rawDraftJson !== rawInitialTexts.json || rawDraftYaml !== rawInitialTexts.yaml;

  const syncRawDrafts = useCallback((bundle: ProjectBundle) => {
    setRawDraftJson(JSON.stringify(bundle, null, 2));
    setRawDraftYaml(stringifyYaml(bundle));
  }, []);

  const parseDraftToBundle = useCallback((text: string, format: "json" | "yaml"): ProjectBundle => {
    let parsed: unknown;

    try {
      parsed = format === "json" ? JSON.parse(text) : parseYaml(text);
    } catch {
      throw new Error(format === "json" ? "Invalid JSON syntax." : "Invalid YAML syntax.");
    }

    assertProjectBundleShape(parsed);

    return {
      ...parsed,
      project: normalizeProjectTimestamps(parsed.project),
    };
  }, []);

  const scopeBundleToCurrentProject = useCallback((bundle: ProjectBundle): ProjectBundle => {
    return {
      ...bundle,
      project: {
        ...bundle.project,
        id,
      },
      nodes: bundle.nodes.map((node) => ({
        ...node,
        project_id: id,
      })),
      edges: bundle.edges.map((edge) => ({
        ...edge,
        project_id: id,
      })),
    };
  }, [id]);

  const handleOpenRaw = useCallback(async () => {
    if (!id) {
      setRawError("Unable to load raw export: missing project id.");
      return;
    }

    setRawLoading(true);
    setRawError(null);
    try {
      const bundle = await exportProject(id);
      setRawBundle(bundle);
      syncRawDrafts(bundle);
      setRawCopied(false);
      setRawMode("view");
      setRawOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown raw export error";
      setRawError(`Unable to load raw export: ${message}`);
    } finally {
      setRawLoading(false);
    }
  }, [id, syncRawDrafts]);

  const handleRawOpenChange = useCallback((open: boolean) => {
    if (open) {
      setRawOpen(true);
      return;
    }

    if (rawMode === "edit" && rawHasUnsavedChanges) {
      setRawPendingClose(true);
      setRawConfirmCancelOpen(true);
      return;
    }

    setRawOpen(false);
    setRawMode("view");
  }, [rawHasUnsavedChanges, rawMode]);

  const handleRawFormatChange = useCallback((nextFormat: "json" | "yaml") => {
    if (nextFormat === rawFormat) return;

    if (rawMode !== "edit") {
      setRawFormat(nextFormat);
      return;
    }

    try {
      const parsed = parseDraftToBundle(rawDraftText, rawFormat);
      setRawDraftJson(JSON.stringify(parsed, null, 2));
      setRawDraftYaml(stringifyYaml(parsed));
      setRawFormat(nextFormat);
      setRawError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid raw draft.";
      toast.error(`Cannot switch format while editing: ${message}`);
    }
  }, [parseDraftToBundle, rawDraftText, rawFormat, rawMode]);

  const handleCopyRaw = useCallback(async () => {
    if (!rawViewportText) return;

    setRawError(null);
    try {
      await navigator.clipboard.writeText(rawViewportText);
      setRawCopied(true);
    } catch {
      setRawError("Unable to copy raw export to clipboard.");
    }
  }, [rawViewportText]);

  const handleRequestRawEdit = useCallback(() => {
    setRawConfirmEnterEditOpen(true);
  }, []);

  const handleConfirmRawEnterEdit = useCallback(() => {
    if (!rawBundle) return;
    syncRawDrafts(rawBundle);
    setRawMode("edit");
    setRawConfirmEnterEditOpen(false);
  }, [rawBundle, syncRawDrafts]);

  const handleRequestRawCancel = useCallback(() => {
    if (!rawHasUnsavedChanges) {
      setRawMode("view");
      return;
    }
    setRawConfirmCancelOpen(true);
  }, [rawHasUnsavedChanges]);

  const handleConfirmRawCancel = useCallback(() => {
    if (rawBundle) {
      syncRawDrafts(rawBundle);
    }

    setRawMode("view");
    setRawConfirmCancelOpen(false);

    if (rawPendingClose) {
      setRawOpen(false);
      setRawPendingClose(false);
    }
  }, [rawBundle, rawPendingClose, syncRawDrafts]);

  const handleRequestRawSave = useCallback(() => {
    setRawConfirmSaveOpen(true);
  }, []);

  const handleConfirmRawSave = useCallback(async () => {
    if (!id) {
      toast.error("Unable to save raw bundle: missing project id.");
      setRawConfirmSaveOpen(false);
      return;
    }

    try {
      const parsedBundle = parseDraftToBundle(rawDraftText, rawFormat);
      const scopedBundle = scopeBundleToCurrentProject(parsedBundle);
      await importProject(scopedBundle);
      const refreshedBundle = await exportProject(id);
      setRawBundle(refreshedBundle);
      syncRawDrafts(refreshedBundle);
      setRawMode("view");
      setRawConfirmSaveOpen(false);
      setRawError(null);
      toast.success("Raw bundle saved successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown save error";
      toast.error(`Raw bundle save failed: ${message}`);
      setRawMode("edit");
      setRawConfirmSaveOpen(false);
    }
  }, [id, parseDraftToBundle, rawDraftText, rawFormat, scopeBundleToCurrentProject, syncRawDrafts]);

  useEffect(() => {
    if (!rawCopied) return;
    const timeoutId = window.setTimeout(() => {
      setRawCopied(false);
    }, 1200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [rawCopied]);

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

  // Build graph topology - ELK will compute positions asynchronously
  const graphData = useMemo(() => {
    const origin = { x: 0, y: 0 };
    const visibleNodes: Node[] = [];
    const visibleEdges: Edge[] = [];
    const visibleNodeIds = new Set<string>();
    const visibleDataNodeIds = new Set<string>();
    const visibleNodeIdsByDataId = new Map<string, string[]>();
    const derivedEdgePairs = new Set<string>();
    const renderedExpandedFlows = new Set<string>();

    const flowRollupCache = new Map<string, PlatformStatusRollup>();

    const computeFlowRollup = (flowNodeId: string): PlatformStatusRollup => {
      const cached = flowRollupCache.get(flowNodeId);
      if (cached) return cached;

      const entries = getPlaylistEntries(flowNodeId);
      const rollup = computePlaylistRollup(entries, nodesById);
      flowRollupCache.set(flowNodeId, rollup);
      return rollup;
    };

    const addDataNode = (node: DataNode, visualNodeId = node.id) => {
      if (visibleNodeIds.has(visualNodeId)) return;

      const baseData = {
        label: node.title,
        status: node.status,
        platforms: node.platforms,
        metadata: node.metadata,
      } as Record<string, unknown>;

      if (node.species === "flow") {
        const flowRollup = computeFlowRollup(node.id);
        baseData.status = getRollupDisplayStatus(flowRollup, node.status);
        baseData.platformRollup = flowRollup;
        baseData.expanded = expandedFlows.has(node.id);
        baseData.onToggle = () => toggleFlow(node.id);
        baseData.onAddChild = () => handleAddChildNode(node.id, "view");
        baseData.onOpenDetails = () => {
          setSelectedNode(node);
          setPanelOpen(true);
        };
      }

      if (node.species === "view") {
        const viewRollup = addNodeToRollup(createEmptyRollup(), node);
        const apiRelations = viewApiRelationsByViewId.get(node.id) ?? { inbound: [], outbound: [] };
        const metadata = (node.metadata ?? {}) as Record<string, unknown>;
        const coverUrl = typeof metadata.cover_url === "string"
          ? metadata.cover_url
          : typeof metadata.coverUrl === "string"
            ? metadata.coverUrl
            : typeof metadata.cover === "string"
              ? metadata.cover
              : undefined;

        baseData.status = getRollupDisplayStatus(viewRollup, node.status);
        baseData.platformStatuses = getEditablePlatformStatuses(node);
        baseData.apiInbound = apiRelations.inbound;
        baseData.apiOutbound = apiRelations.outbound;
        baseData.viewCardVariant = viewCardVariant;
        baseData.coverUrl = coverUrl;
        baseData.onOpenDetails = () => {
          setSelectedNode(node);
          setPanelOpen(true);
        };
      }

      visibleNodes.push({
        id: visualNodeId,
        type: SPECIES_TO_NODE_TYPE[node.species],
        position: origin,
        data: baseData,
      });
      visibleNodeIds.add(visualNodeId);
      visibleDataNodeIds.add(node.id);
      visibleNodeIdsByDataId.set(node.id, [...(visibleNodeIdsByDataId.get(node.id) ?? []), visualNodeId]);
    };

    const addSyntheticBranchNode = (
      syntheticId: string,
      label: string,
      kind: "condition" | "junction",
      summary: string,
    ) => {
      if (visibleNodeIds.has(syntheticId)) return;

      visibleNodes.push({
        id: syntheticId,
        type: "flow",
        position: origin,
        data: {
          label,
          status: "idea",
          platforms: [],
          platformRollup: createEmptyRollup(),
          renderVariant: "branch",
          branchKind: kind,
          branchSummary: summary,
        },
      });
      visibleNodeIds.add(syntheticId);
    };

    const uniqueIds = (ids: string[]) => [...new Set(ids)];

    const addComposeEdge = (
      source: string,
      target: string,
      data?: Record<string, unknown>,
    ) => {
      if (source === target) return;

      const pairKey = `${source}:${target}`;
      if (derivedEdgePairs.has(pairKey)) return;
      derivedEdgePairs.add(pairKey);

      visibleEdges.push({
        id: `compose-${source}-${target}-${visibleEdges.length}`,
        source,
        target,
        type: "compose",
        data,
      });
    };

    const connectIds = (
      sourceIds: string[],
      targetIds: string[],
      data?: Record<string, unknown>,
    ) => {
      for (const sourceId of uniqueIds(sourceIds)) {
        for (const targetId of uniqueIds(targetIds)) {
          addComposeEdge(sourceId, targetId, data);
        }
      }
    };

    const renderSequence = (
      entries: PlaylistEntry[],
      depth: number,
      flowTrail: Set<string>,
      contextKey: string,
      parentFlowVisualId: string,
    ): RenderSequenceResult => {
      if (entries.length === 0) {
        return { startIds: [], endIds: [] };
      }

      let sequenceStartIds: string[] = [];
      let previousResult: RenderSequenceResult | null = null;

      const renderEntry = (
        entry: PlaylistEntry,
        entryIndex: number,
        entryContextKey: string,
      ): RenderSequenceResult => {
        if (entry.type === "view") {
          const viewNode = nodesById.get(entry.view_id);
          if (!viewNode) return { startIds: [], endIds: [] };

          const viewVisualId = createVisualNodeId(viewNode.id, parentFlowVisualId, entryIndex);
          addDataNode(viewNode, viewVisualId);
          return { startIds: [viewVisualId], endIds: [viewVisualId], entryNodeId: viewVisualId };
        }

        if (entry.type === "flow") {
          const flowNode = nodesById.get(entry.flow_id);
          if (!flowNode) return { startIds: [], endIds: [] };

          const flowVisualId = createVisualNodeId(flowNode.id, parentFlowVisualId, entryIndex);
          addDataNode(flowNode, flowVisualId);

          let flowEndIds = [flowVisualId];

          if (expandedFlows.has(flowNode.id) && !renderedExpandedFlows.has(flowVisualId) && !flowTrail.has(flowNode.id)) {
            renderedExpandedFlows.add(flowVisualId);
            const nextTrail = new Set(flowTrail);
            nextTrail.add(flowNode.id);
            const flowEntries = getPlaylistEntries(flowNode.id);
            const childSequence = renderSequence(flowEntries, depth + 1, nextTrail, `${entryContextKey}:flow`, flowVisualId);
            connectIds([flowVisualId], childSequence.startIds);
            if (childSequence.endIds.length > 0) {
              flowEndIds = childSequence.endIds;
            }
          }

          return { startIds: [flowVisualId], endIds: flowEndIds, entryNodeId: flowVisualId };
        }

        const branchId = `branch-${entryContextKey}`;
        const branches = entry.type === "condition"
          ? [
              { label: "Yes", entries: entry.if_true },
              { label: "No", entries: entry.if_false },
            ]
          : entry.cases.map((playlistCase) => ({ label: playlistCase.label, entries: playlistCase.entries }));

        addSyntheticBranchNode(
          branchId,
          entry.label,
          entry.type,
          branches.map((branch) => branch.label).join(" / "),
        );

        const branchEndIds: string[] = [];

        branches.forEach((branch, index) => {
          if (branch.entries.length === 0) {
            branchEndIds.push(branchId);
            return;
          }

          const branchSequence = renderSequence(
            branch.entries,
            depth + 1,
            flowTrail,
            `${entryContextKey}:${index}`,
            parentFlowVisualId,
          );

          if (branchSequence.startIds.length > 0) {
            const branchEdgeData: Record<string, unknown> = { label: branch.label };
            if (entry.type === "condition") {
              branchEdgeData.edgeColor = branch.label === "Yes" ? "green" : "yellow";
            }
            connectIds([branchId], branchSequence.startIds, branchEdgeData);
            branchEndIds.push(...branchSequence.endIds);
          } else {
            branchEndIds.push(branchId);
          }
        });

        return {
          startIds: [branchId],
          endIds: uniqueIds(branchEndIds.length > 0 ? branchEndIds : [branchId]),
        };
      };

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const entryResult = renderEntry(entry, index, `${contextKey}:${index}`);
        if (entryResult.startIds.length === 0) {
          continue;
        }

        if (sequenceStartIds.length === 0) {
          sequenceStartIds = [...entryResult.startIds];
        }

        if (previousResult) {
          const priorResult = previousResult;
          const edgeData = priorResult.entryNodeId && entryResult.entryNodeId
            ? {
                insertLabel: "Insert",
                onInsert: () => handleInsertBetween(parentFlowVisualId, entryResult.entryNodeId!),
              }
            : undefined;
          connectIds(priorResult.endIds, entryResult.startIds, edgeData);
        }

        previousResult = entryResult;
      }

      const terminalIds = previousResult ? previousResult.endIds : sequenceStartIds;

      return {
        startIds: uniqueIds(sequenceStartIds),
        endIds: uniqueIds(terminalIds),
      };
    };

    if (explicitRootNode) {
      addDataNode(explicitRootNode);

      const rootChildren = (composeChildIdsByParent.get(explicitRootNode.id) ?? [])
        .map((childId) => nodesById.get(childId))
        .filter((child): child is DataNode => Boolean(child))
        .filter((child) => child.species === "flow");

      rootChildren.forEach((child) => {
        addDataNode(child);
        addComposeEdge(explicitRootNode.id, child.id);

        if (expandedFlows.has(child.id)) {
          renderedExpandedFlows.add(child.id);
          const childSequence = renderSequence(
            getPlaylistEntries(child.id),
            2,
            new Set([child.id]),
            `root:${child.id}`,
            child.id,
          );
          connectIds([child.id], childSequence.startIds);
        }
      });

      if (explicitRootNode.species === "flow" && expandedFlows.has(explicitRootNode.id) && rootChildren.length === 0) {
        renderedExpandedFlows.add(explicitRootNode.id);
        const rootSequence = renderSequence(
          getPlaylistEntries(explicitRootNode.id),
          2,
          new Set([explicitRootNode.id]),
          `root-self:${explicitRootNode.id}`,
          explicitRootNode.id,
        );
        connectIds([explicitRootNode.id], rootSequence.startIds);
      }
    } else {
      const rootNodes = dataNodes.filter((node) => !composeParentByChild.has(node.id) && FLOW_CHILD_SPECIES.has(node.species));

      rootNodes.forEach((rootNode) => {
        addDataNode(rootNode);

        if (rootNode.species === "flow" && expandedFlows.has(rootNode.id)) {
          renderedExpandedFlows.add(rootNode.id);
          const rootSequence = renderSequence(
            getPlaylistEntries(rootNode.id),
            2,
            new Set([rootNode.id]),
            `fallback:${rootNode.id}`,
            rootNode.id,
          );
          connectIds([rootNode.id], rootSequence.startIds);
        }
      });
    }

    // Cross-layer edges (calls, displays, queries)
    const renderedEdgePairs = new Set(visibleEdges.map((edge) => `${edge.source}:${edge.target}`));
    const EDGE_TYPE_MAP: Record<string, string> = {
      composes: "compose",
      calls: "calls",
      displays: "displays",
      queries: "queries",
    };

    for (const edge of dataEdges) {
      if (edge.edge_type === "composes") continue;
      if (!visibleDataNodeIds.has(edge.source_id) || !visibleDataNodeIds.has(edge.target_id)) continue;

      const sourceVisualIds = visibleNodeIdsByDataId.get(edge.source_id) ?? [];
      const targetVisualIds = visibleNodeIdsByDataId.get(edge.target_id) ?? [];

      for (const sourceVisualId of sourceVisualIds) {
        for (const targetVisualId of targetVisualIds) {
          const pairKey = `${sourceVisualId}:${targetVisualId}`;
          if (renderedEdgePairs.has(pairKey)) continue;

          visibleEdges.push({
            id: `${edge.id}--${sourceVisualId}--${targetVisualId}`,
            source: sourceVisualId,
            target: targetVisualId,
            type: EDGE_TYPE_MAP[edge.edge_type],
          });
          renderedEdgePairs.add(pairKey);
        }
      }
    }

    return { nodes: visibleNodes, edges: visibleEdges };
  }, [
    explicitRootNode,
    composeChildIdsByParent,
    composeParentByChild,
    dataEdges,
    dataNodes,
    expandedFlows,
    getPlaylistEntries,
    handleAddChildNode,
    handleInsertBetween,
    nodesById,
    toggleFlow,
    viewApiRelationsByViewId,
    viewCardVariant,
  ]);

  // Run ELK layout asynchronously whenever the graph topology changes
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    if (graphData.nodes.length === 0) {
      setLayoutedNodes([]);
      setLayoutReady(true);
      return;
    }

    let cancelled = false;

    computeElkLayout(graphData.nodes, graphData.edges).then((result) => {
      if (!cancelled) {
        setLayoutedNodes(result.nodes);
        setLayoutReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [graphData]);

  const nodes = layoutReady ? layoutedNodes : graphData.nodes;
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
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {projectBundle?.project.title ?? "Untitled project"}
          </p>
          <p className="truncate text-xs text-muted-foreground">Canvas</p>
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
          {rawError && (
            <span className="text-xs text-destructive" role="status" aria-live="polite">
              {rawError}
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
          <Button size="sm" variant="outline" onClick={() => void handleOpenRaw()} disabled={rawLoading}>
            <Code2Icon className="size-4" />
            {rawLoading ? "Loading raw..." : "Raw"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            <DownloadIcon className="size-4" />
            {exporting ? "Exporting..." : "Export JSON"}
          </Button>
          <Button size="sm" onClick={() => { setNewNodePreset(null); setNewNodeOpen(true); }}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 relative">
        <Canvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onConnect={handleConnect} onEdgeClick={handleEdgeClick} />
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
        onCreateNode={handleCreateNodeFromPanel}
      />
      <Sheet open={rawOpen} onOpenChange={handleRawOpenChange}>
        <SheetContent className="w-full sm:max-w-3xl">
          <SheetHeader className="pr-12">
            <SheetTitle>Raw project bundle</SheetTitle>
            <SheetDescription>Inspect the full export as JSON or YAML.</SheetDescription>
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant={rawFormat === "json" ? "default" : "outline"} onClick={() => handleRawFormatChange("json")}>
                  JSON
                </Button>
                <Button size="sm" variant={rawFormat === "yaml" ? "default" : "outline"} onClick={() => handleRawFormatChange("yaml")}>
                  YAML
                </Button>
              </div>
              {rawMode === "view" ? (
                <Button size="sm" variant="outline" onClick={handleRequestRawEdit} disabled={!rawBundle}>
                  Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleRequestRawCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleRequestRawSave}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 px-6 pb-6">
            <div className="group relative h-full">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCopyRaw()}
                disabled={!rawViewportText}
                className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <CopyIcon className="size-4" />
                {rawCopied ? "Copied" : "Copy"}
              </Button>
              {rawMode === "edit" ? (
                <textarea
                  value={rawDraftText}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (rawFormat === "json") {
                      setRawDraftJson(value);
                    } else {
                      setRawDraftYaml(value);
                    }
                  }}
                  spellCheck={false}
                  className="h-full w-full resize-none overflow-auto rounded-md border bg-muted/30 p-3 pr-24 font-mono text-xs leading-relaxed outline-none"
                />
              ) : (
                <pre className="h-full overflow-auto rounded-md border bg-muted/30 p-3 pr-24 text-xs leading-relaxed">
                  <code>{rawBaseText || "No export available yet."}</code>
                </pre>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
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
      <DeleteConfirmDialog
        open={rawConfirmEnterEditOpen}
        onOpenChange={setRawConfirmEnterEditOpen}
        title="Enable raw edit mode?"
        description="You are about to edit the full project payload directly. Saving runs validation for syntax and basic schema issues, but it cannot protect against unintended destructive changes to valid data."
        confirmLabel="Edit"
        onConfirm={handleConfirmRawEnterEdit}
      />
      <DeleteConfirmDialog
        open={rawConfirmCancelOpen}
        onOpenChange={(open) => {
          setRawConfirmCancelOpen(open);
          if (!open) setRawPendingClose(false);
        }}
        title="Discard unsaved raw changes?"
        description="You have unsaved edits. Discarding now will permanently lose those changes."
        confirmLabel="Discard"
        onConfirm={handleConfirmRawCancel}
      />
      <DeleteConfirmDialog
        open={rawConfirmSaveOpen}
        onOpenChange={setRawConfirmSaveOpen}
        title="Apply raw changes to this project?"
        description="This will replace the current graph data for this project and cannot be undone. Validation checks syntax and bundle shape, but valid edits can still remove or overwrite data unintentionally."
        confirmLabel="Save"
        onConfirm={() => {
          void handleConfirmRawSave();
        }}
      />
    </div>
  );
}

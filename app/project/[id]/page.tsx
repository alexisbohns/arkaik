"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback, useMemo, useEffect } from "react";
import { type Edge, type Node, type NodeMouseHandler, type Connection, type EdgeMouseHandler } from "@xyflow/react";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { Canvas } from "@/components/graph/Canvas";
import { EdgeTypeDialog } from "@/components/graph/EdgeTypeDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { Button } from "@/components/ui/button";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProject } from "@/lib/hooks/useProject";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { downloadJson, exportProject } from "@/lib/utils/export";
import { generateNodeId } from "@/lib/utils/id";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { SpeciesId } from "@/lib/config/species";
import type { Node as DataNode, Edge as DataEdge, PlaylistEntry } from "@/lib/data/types";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import {
  addNodeToRollup,
  computePlaylistRollup,
  createEmptyRollup,
  getEditablePlatformStatuses,
  getRollupDisplayStatus,
  mergeRollups,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";

const SPECIES_TO_NODE_TYPE: Record<SpeciesId, string> = {
  flow: "flow",
  view: "view",
  "data-model": "dataModel",
  "api-endpoint": "apiEndpoint",
};

const FLOW_CHILD_SPECIES = new Set<SpeciesId>(["flow", "view"]);
const ROOT_FLOW_SPACING = 360;
const ROOT_ANCHOR_Y = 270;
const FLOW_CHILD_Y_SPACING = 180;
const PLAYLIST_DOWN_OFFSET = 240;
const PLAYLIST_RIGHT_OFFSET = 420;
const PLAYLIST_HORIZONTAL_SPACING = 320;

const COLLISION_PADDING = 24;
const MAX_COLLISION_ITERATIONS = 30;

interface RenderSequenceResult {
  startIds: string[];
  endIds: string[];
  entryNodeId?: string;
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

function horizontalPositions(
  cx: number,
  cy: number,
  count: number,
  spacing: number,
): { x: number; y: number }[] {
  if (count === 0) return [];
  const totalWidth = (count - 1) * spacing;
  const startX = cx - totalWidth / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * spacing,
    y: cy,
  }));
}

function verticalPositions(
  cx: number,
  cy: number,
  count: number,
  spacing = FLOW_CHILD_Y_SPACING,
): { x: number; y: number }[] {
  if (count === 0) return [];
  const totalHeight = (count - 1) * spacing;
  const startY = cy - totalHeight / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: cx,
    y: startY + i * spacing,
  }));
}

function getNodeSize(nodeType?: string): LayoutSize {
  switch (nodeType) {
    case "flow":
      return { width: 240, height: 136 };
    case "view":
      return { width: 224, height: 140 };
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

  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [newNodePreset, setNewNodePreset] = useState<{ parentId: string; species: SpeciesId; insertBeforeId?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNode, removeNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, addEdge, removeEdge } = useEdges(id);
  const { project: projectBundle, loading: projectLoading } = useProject(id);

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

  const getPlaylistEntries = useCallback((nodeId: string): PlaylistEntry[] => {
    const entries = nodesById.get(nodeId)?.metadata?.playlist?.entries;
    return Array.isArray(entries) ? entries : [];
  }, [nodesById]);

  const getPlaylist = useCallback((nodeId: string): string[] => {
    return collectReferencedNodeIds(getPlaylistEntries(nodeId));
  }, [getPlaylistEntries]);

  const getOrderedChildren = useCallback((parentId: string): DataNode[] => {
    const edgeChildIds = composeChildIdsByParent.get(parentId) ?? [];
    const playlist = getPlaylist(parentId);

    const orderedIds = [
      ...playlist,
      ...edgeChildIds.filter((childId) => !playlist.includes(childId)),
    ];

    return orderedIds
      .map((childId) => nodesById.get(childId))
      .filter((child): child is DataNode => Boolean(child));
  }, [composeChildIdsByParent, getPlaylist, nodesById]);

  // Auto-expand root flows on initial load.
  useEffect(() => {
    if (nodesLoading) return;
    setExpandedFlows((prev) => {
      if (prev.size > 0) return prev;
      const rootFlowIds = explicitRootNode
        ? [
            ...(explicitRootNode.species === "flow" ? [explicitRootNode.id] : []),
            ...(composeChildIdsByParent.get(explicitRootNode.id) ?? [])
              .map((nodeId) => nodesById.get(nodeId))
              .filter((node): node is DataNode => Boolean(node))
              .filter((node) => node.species === "flow")
              .map((node) => node.id),
          ]
        : dataNodes
            .filter((node) => node.species === "flow" && !composeParentByChild.has(node.id))
            .map((node) => node.id);
      return new Set(rootFlowIds);
    });
  }, [nodesLoading, composeChildIdsByParent, composeParentByChild, dataNodes, explicitRootNode, nodesById]);

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
      const next = new Set(prev);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
      }
      return next;
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

  const handleAddChildNode = useCallback((parentId: string, childSpecies: SpeciesId) => {
    setNewNodePreset({ parentId, species: childSpecies });
    setNewNodeOpen(true);
  }, []);

  const handleInsertBetween = useCallback((sourceId: string, targetId: string, species: SpeciesId) => {
    const sourceNodeId = getBaseNodeId(sourceId);
    const targetNodeId = getBaseNodeId(targetId);
    const srcParentId = composeParentByChild.get(sourceNodeId);
    const tgtParentId = composeParentByChild.get(targetNodeId);
    if (!srcParentId || srcParentId !== tgtParentId) return;
    setNewNodePreset({ parentId: srcParentId, species, insertBeforeId: targetNodeId });
    setNewNodeOpen(true);
  }, [composeParentByChild]);

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

  useKeyboardShortcuts({
    onEscape: () => {
      if (!panelOpen) return;
      setPanelOpen(false);
    },
    onDelete: () => {
      if (deleteNodeDialogOpen || deleteEdgeDialogOpen || newNodeOpen || edgeDialogOpen) return;
      if (!selectedNode) return;
      handleDeleteNodeRequest(selectedNode.id);
    },
    onExport: () => {
      if (exporting) return;
      void handleExport();
    },
  });

  const { nodes, edges } = useMemo(() => {
    const layoutRules = new Map<string, LayoutRule>();
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

    const addDataNode = (node: DataNode, position: { x: number; y: number }, visualNodeId = node.id) => {
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
        baseData.status = getRollupDisplayStatus(viewRollup, node.status);
        baseData.platformStatuses = getEditablePlatformStatuses(node);
      }

      visibleNodes.push({
        id: visualNodeId,
        type: SPECIES_TO_NODE_TYPE[node.species],
        position,
        data: baseData,
      });
      visibleNodeIds.add(visualNodeId);
      visibleDataNodeIds.add(node.id);
      visibleNodeIdsByDataId.set(node.id, [...(visibleNodeIdsByDataId.get(node.id) ?? []), visualNodeId]);
    };

    const addSyntheticBranchNode = (
      syntheticId: string,
      label: string,
      position: { x: number; y: number },
      kind: "condition" | "junction",
      summary: string,
    ) => {
      if (visibleNodeIds.has(syntheticId)) return;

      visibleNodes.push({
        id: syntheticId,
        type: "flow",
        position,
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
      layoutRules.set(syntheticId, { axis: "both" });
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

    const getChildAnchor = (position: { x: number; y: number }, childDepth: number) => {
      if (childDepth <= 2 || childDepth % 2 === 0) {
        return { x: position.x, y: position.y + PLAYLIST_DOWN_OFFSET };
      }

      return { x: position.x + PLAYLIST_RIGHT_OFFSET, y: position.y };
    };

    const getSequencePositions = (
      anchor: { x: number; y: number },
      depth: number,
      count: number,
    ) => {
      if (depth % 2 === 1) {
        return horizontalPositions(
          anchor.x,
          anchor.y,
          count,
          depth === 1 ? ROOT_FLOW_SPACING : PLAYLIST_HORIZONTAL_SPACING,
        );
      }

      return verticalPositions(anchor.x, anchor.y, count, FLOW_CHILD_Y_SPACING);
    };

    const renderSequence = (
      entries: PlaylistEntry[],
      anchor: { x: number; y: number },
      depth: number,
      flowTrail: Set<string>,
      contextKey: string,
      parentFlowVisualId: string,
    ): RenderSequenceResult => {
      if (entries.length === 0) {
        return { startIds: [], endIds: [] };
      }

      const positions = getSequencePositions(anchor, depth, entries.length);
      let sequenceStartIds: string[] = [];
      let previousResult: RenderSequenceResult | null = null;

      const renderEntry = (
        entry: PlaylistEntry,
        position: { x: number; y: number },
        entryIndex: number,
        entryContextKey: string,
      ): RenderSequenceResult => {
        if (entry.type === "view") {
          const viewNode = nodesById.get(entry.view_id);
          if (!viewNode) return { startIds: [], endIds: [] };

          const viewVisualId = createVisualNodeId(viewNode.id, parentFlowVisualId, entryIndex);
          addDataNode(viewNode, position, viewVisualId);
          layoutRules.set(viewVisualId, { axis: "both" });
          return { startIds: [viewVisualId], endIds: [viewVisualId], entryNodeId: viewVisualId };
        }

        if (entry.type === "flow") {
          const flowNode = nodesById.get(entry.flow_id);
          if (!flowNode) return { startIds: [], endIds: [] };

          const flowVisualId = createVisualNodeId(flowNode.id, parentFlowVisualId, entryIndex);
          addDataNode(flowNode, position, flowVisualId);
          layoutRules.set(flowVisualId, { axis: "both" });

          if (expandedFlows.has(flowNode.id) && !renderedExpandedFlows.has(flowVisualId) && !flowTrail.has(flowNode.id)) {
            renderedExpandedFlows.add(flowVisualId);
            const nextTrail = new Set(flowTrail);
            nextTrail.add(flowNode.id);
            const flowEntries = getPlaylistEntries(flowNode.id);
            const childAnchor = getChildAnchor(position, depth + 1);
            const childSequence = renderSequence(flowEntries, childAnchor, depth + 1, nextTrail, `${entryContextKey}:flow`, flowVisualId);
            connectIds([flowVisualId], childSequence.startIds);
          }

          return { startIds: [flowVisualId], endIds: [flowVisualId], entryNodeId: flowVisualId };
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
          position,
          entry.type,
          branches.map((branch) => branch.label).join(" / "),
        );

        const branchAnchor = getChildAnchor(position, depth + 1);
        const branchPositions = getSequencePositions(branchAnchor, depth + 1, branches.length);
        const branchEndIds: string[] = [];

        branches.forEach((branch, index) => {
          if (branch.entries.length === 0) {
            branchEndIds.push(branchId);
            return;
          }

          const branchSequence = renderSequence(
            branch.entries,
            branchPositions[index] ?? branchAnchor,
            depth + 1,
            flowTrail,
            `${entryContextKey}:${index}`,
            parentFlowVisualId,
          );

          if (branchSequence.startIds.length > 0) {
            connectIds([branchId], branchSequence.startIds, { label: branch.label });
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
        const entryResult = renderEntry(entry, positions[index] ?? anchor, index, `${contextKey}:${index}`);
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
                insertLabel: "Insert a View",
                onInsert: () => handleInsertBetween(priorResult.entryNodeId!, entryResult.entryNodeId!, "view"),
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

    const dataLayerNodes = dataNodes.filter((node) => node.species === "data-model" || node.species === "api-endpoint");
    const dataLayerPositions = verticalPositions(160, 760, dataLayerNodes.length, 120);
    dataLayerNodes.forEach((node, index) => {
      addDataNode(node, dataLayerPositions[index] ?? { x: 160, y: 760 + index * 120 });
      layoutRules.set(node.id, { axis: "both" });
    });

    if (explicitRootNode) {
      const rootPosition = { x: 900, y: ROOT_ANCHOR_Y };
      addDataNode(explicitRootNode, rootPosition);
      layoutRules.set(explicitRootNode.id, { axis: "both", fixed: true });

      const rootChildren = (composeChildIdsByParent.get(explicitRootNode.id) ?? [])
        .map((childId) => nodesById.get(childId))
        .filter((child): child is DataNode => Boolean(child))
        .filter((child) => child.species === "flow");
      const rootAnchor = getChildAnchor(rootPosition, 1);
      const rootChildPositions = getSequencePositions(rootAnchor, 1, rootChildren.length);

      rootChildren.forEach((child, index) => {
        const childPosition = rootChildPositions[index] ?? rootAnchor;
        addDataNode(child, childPosition);
        layoutRules.set(child.id, { axis: "both" });
        addComposeEdge(explicitRootNode.id, child.id);

        if (expandedFlows.has(child.id)) {
          renderedExpandedFlows.add(child.id);
          const childSequence = renderSequence(
            getPlaylistEntries(child.id),
            getChildAnchor(childPosition, 2),
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
          getChildAnchor(rootPosition, 2),
          2,
          new Set([explicitRootNode.id]),
          `root-self:${explicitRootNode.id}`,
          explicitRootNode.id,
        );
        connectIds([explicitRootNode.id], rootSequence.startIds);
      }
    } else {
      const rootNodes = dataNodes.filter((node) => !composeParentByChild.has(node.id) && FLOW_CHILD_SPECIES.has(node.species));
      const rootAnchor = { x: 900, y: ROOT_ANCHOR_Y };
      const rootPositions = getSequencePositions(getChildAnchor(rootAnchor, 1), 1, rootNodes.length);

      rootNodes.forEach((rootNode, index) => {
        const position = rootPositions[index] ?? rootAnchor;
        addDataNode(rootNode, position);
        layoutRules.set(rootNode.id, { axis: "both" });

        if (rootNode.species === "flow" && expandedFlows.has(rootNode.id)) {
          renderedExpandedFlows.add(rootNode.id);
          const rootSequence = renderSequence(
            getPlaylistEntries(rootNode.id),
            getChildAnchor(position, 2),
            2,
            new Set([rootNode.id]),
            `fallback:${rootNode.id}`,
            rootNode.id,
          );
          connectIds([rootNode.id], rootSequence.startIds);
        }
      });
    }

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

    const collisionFreeNodes = resolveNodeCollisions(visibleNodes, layoutRules);
    return { nodes: collisionFreeNodes, edges: visibleEdges };
  }, [
    explicitRootNode,
    composeChildIdsByParent,
    composeParentByChild,
    dataEdges,
    dataNodes,
    expandedFlows,
    getPlaylistEntries,
    getOrderedChildren,
    handleAddChildNode,
    handleInsertBetween,
    nodesById,
    toggleFlow,
  ]);

  if (nodesLoading || edgesLoading || projectLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph…</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-2 shrink-0">
        <Link href="/" aria-label="Go to home" className="inline-flex items-center">
          <ArkaikLogo className="w-16 shrink-0" />
        </Link>
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
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            <DownloadIcon className="size-4" />
            {exporting ? "Exporting..." : "Export JSON"}
          </Button>
        </div>
      </header>
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
        onCreateNode={handleCreateNodeFromPanel}
      />
      <NewNodeForm
        key={newNodePreset ? `preset-${newNodePreset.parentId}-${newNodePreset.species}` : "default"}
        open={newNodeOpen}
        onOpenChange={handleNewNodeOpenChange}
        onSubmit={handleAddNode}
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

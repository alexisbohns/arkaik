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
import type { SpeciesId } from "@/lib/config/species";
import type { Node as DataNode, Edge as DataEdge, PlaylistEntry } from "@/lib/data/types";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import {
  addNodeToRollup,
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
const ROOT_FLOW_Y = 120;
const ROOT_VIEW_SPACING = 300;
const ROOT_VIEW_Y = 420;
const ROOT_ANCHOR_Y = 270;
const FLOW_CHILD_X_OFFSET = 320;
const FLOW_CHILD_Y_SPACING = 180;

const COLLISION_PADDING = 24;
const MAX_COLLISION_ITERATIONS = 30;

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

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, removeNodes } = useNodes(id);
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

  const getPlaylist = useCallback((nodeId: string): string[] => {
    const entries = nodesById.get(nodeId)?.metadata?.playlist?.entries;
    if (!Array.isArray(entries)) return [];
    return collectReferencedNodeIds(entries);
  }, [nodesById]);

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
        ? [explicitRootNode].filter((node) => node.species === "flow").map((node) => node.id)
        : dataNodes
            .filter((node) => node.species === "flow" && !composeParentByChild.has(node.id))
            .map((node) => node.id);
      return new Set(rootFlowIds);
    });
  }, [nodesLoading, dataNodes, composeParentByChild, explicitRootNode]);

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

  const handleAddChildNode = useCallback((parentId: string, childSpecies: SpeciesId) => {
    setNewNodePreset({ parentId, species: childSpecies });
    setNewNodeOpen(true);
  }, []);

  const handleInsertBetween = useCallback((sourceId: string, targetId: string, species: SpeciesId) => {
    const srcParentId = composeParentByChild.get(sourceId);
    const tgtParentId = composeParentByChild.get(targetId);
    if (!srcParentId || srcParentId !== tgtParentId) return;
    setNewNodePreset({ parentId: srcParentId, species, insertBeforeId: targetId });
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

      await addNode({
        id: newNodeId,
        project_id: id,
        title: data.title,
        species: data.species,
        status: data.status,
        platforms: data.platforms,
        metadata: data.metadata,
      });

      if (parentId) {
        await addEdge({
          id: crypto.randomUUID(),
          project_id: id,
          source_id: parentId,
          target_id: newNodeId,
          edge_type: "composes",
        });

        const parentNode = nodesById.get(parentId);
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
    [addEdge, addNode, id, newNodePreset, nodesById, updateNode],
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

    const flowRollupCache = new Map<string, PlatformStatusRollup>();

    const computeFlowRollup = (flowNodeId: string, visited: Set<string>): PlatformStatusRollup => {
      const cached = flowRollupCache.get(flowNodeId);
      if (cached) return cached;
      if (visited.has(flowNodeId)) return createEmptyRollup();

      visited.add(flowNodeId);
      const children = getOrderedChildren(flowNodeId);
      const directViewRollup = children
        .filter((child) => child.species === "view")
        .reduce((rollup, child) => addNodeToRollup(rollup, child), createEmptyRollup());
      const nestedFlowRollup = mergeRollups(
        ...children
          .filter((child) => child.species === "flow")
          .map((child) => computeFlowRollup(child.id, visited)),
      );
      visited.delete(flowNodeId);

      const combined = mergeRollups(directViewRollup, nestedFlowRollup);
      flowRollupCache.set(flowNodeId, combined);
      return combined;
    };

    const addDataNode = (node: DataNode, position: { x: number; y: number }) => {
      if (visibleNodeIds.has(node.id)) return;

      const baseData = {
        label: node.title,
        status: node.status,
        platforms: node.platforms,
        metadata: node.metadata,
      } as Record<string, unknown>;

      if (node.species === "flow") {
        const flowRollup = computeFlowRollup(node.id, new Set<string>());
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
        id: node.id,
        type: SPECIES_TO_NODE_TYPE[node.species],
        position,
        data: baseData,
      });
      visibleNodeIds.add(node.id);
    };

    const dataLayerNodes = dataNodes.filter((node) => node.species === "data-model" || node.species === "api-endpoint");
    const dataLayerPositions = verticalPositions(160, 760, dataLayerNodes.length, 120);
    dataLayerNodes.forEach((node, index) => {
      addDataNode(node, dataLayerPositions[index] ?? { x: 160, y: 760 + index * 120 });
      layoutRules.set(node.id, { axis: "both" });
    });

    const queue: string[] = [];
    const visitedFlowIds = new Set<string>();

    if (explicitRootNode) {
      const rootPosition = { x: 900, y: ROOT_ANCHOR_Y };
      addDataNode(explicitRootNode, rootPosition);
      layoutRules.set(explicitRootNode.id, { axis: "both", fixed: true });

      const rootChildren = getOrderedChildren(explicitRootNode.id).filter((child) => FLOW_CHILD_SPECIES.has(child.species));
      const rootChildPositions = verticalPositions(
        rootPosition.x + FLOW_CHILD_X_OFFSET,
        rootPosition.y,
        rootChildren.length,
      );

      rootChildren.forEach((child, index) => {
        const childPosition = rootChildPositions[index] ?? {
          x: rootPosition.x + FLOW_CHILD_X_OFFSET,
          y: rootPosition.y,
        };
        addDataNode(child, childPosition);
        layoutRules.set(child.id, {
          axis: "both",
          clampX: [rootPosition.x + FLOW_CHILD_X_OFFSET - 50, rootPosition.x + FLOW_CHILD_X_OFFSET + 260],
          clampY: [rootPosition.y - 280, rootPosition.y + 280],
        });

        visibleEdges.push({
          id: `compose-${explicitRootNode.id}-${child.id}`,
          source: explicitRootNode.id,
          target: child.id,
          type: "compose",
        });

        if (child.species === "flow") {
          queue.push(child.id);
        }
      });

      const rootChildViews = rootChildren.filter((child) => child.species === "view");
      for (let index = 1; index < rootChildViews.length; index += 1) {
        const prev = rootChildViews[index - 1];
        const curr = rootChildViews[index];
        visibleEdges.push({
          id: `compose-${prev.id}-${curr.id}`,
          source: prev.id,
          target: curr.id,
          type: "compose",
          data: {
            insertLabel: "Insert a View",
            onInsert: () => handleInsertBetween(prev.id, curr.id, "view"),
          },
        });
      }

      if (explicitRootNode.species === "flow") {
        visitedFlowIds.add(explicitRootNode.id);
      }
    } else {
      const rootNodes = dataNodes.filter((node) => !composeParentByChild.has(node.id));
      const rootFlows = rootNodes.filter((node) => node.species === "flow");
      const rootViews = rootNodes.filter((node) => node.species === "view");

      const rootFlowPositions = horizontalPositions(900, ROOT_FLOW_Y, rootFlows.length, ROOT_FLOW_SPACING);
      const rootViewPositions = horizontalPositions(900, ROOT_VIEW_Y, rootViews.length, ROOT_VIEW_SPACING);

      rootFlows.forEach((flow, index) => {
        addDataNode(flow, rootFlowPositions[index] ?? { x: 900, y: ROOT_FLOW_Y });
        layoutRules.set(flow.id, { axis: "both", fixed: true });
      });

      rootViews.forEach((view, index) => {
        addDataNode(view, rootViewPositions[index] ?? { x: 900, y: ROOT_VIEW_Y });
        layoutRules.set(view.id, { axis: "both", fixed: true });
      });

      queue.push(...rootFlows.map((flow) => flow.id));
    }

    while (queue.length > 0) {
      const flowId = queue.shift()!;
      if (visitedFlowIds.has(flowId)) continue;
      visitedFlowIds.add(flowId);

      if (!expandedFlows.has(flowId)) continue;
      const parentNode = visibleNodes.find((node) => node.id === flowId);
      if (!parentNode) continue;

      const children = getOrderedChildren(flowId).filter((child) => FLOW_CHILD_SPECIES.has(child.species));
      const childPositions = verticalPositions(
        parentNode.position.x + FLOW_CHILD_X_OFFSET,
        parentNode.position.y,
        children.length,
      );

      children.forEach((child, index) => {
        const pos = childPositions[index] ?? {
          x: parentNode.position.x + FLOW_CHILD_X_OFFSET,
          y: parentNode.position.y,
        };

        addDataNode(child, pos);
        layoutRules.set(child.id, {
          axis: "both",
          clampX: [parentNode.position.x + FLOW_CHILD_X_OFFSET - 50, parentNode.position.x + FLOW_CHILD_X_OFFSET + 260],
          clampY: [parentNode.position.y - 280, parentNode.position.y + 280],
        });

        visibleEdges.push({
          id: `compose-${flowId}-${child.id}`,
          source: flowId,
          target: child.id,
          type: "compose",
        });

        if (child.species === "flow") {
          queue.push(child.id);
        }
      });

      const childViews = children.filter((child) => child.species === "view");
      for (let index = 1; index < childViews.length; index += 1) {
        const prev = childViews[index - 1];
        const curr = childViews[index];
        visibleEdges.push({
          id: `compose-${prev.id}-${curr.id}`,
          source: prev.id,
          target: curr.id,
          type: "compose",
          data: {
            insertLabel: "Insert a View",
            onInsert: () => handleInsertBetween(prev.id, curr.id, "view"),
          },
        });
      }
    }

    const renderedEdgePairs = new Set(visibleEdges.map((edge) => `${edge.source}:${edge.target}`));
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

      visibleEdges.push({
        id: `${edge.id}--${edge.source_id}--${edge.target_id}`,
        source: edge.source_id,
        target: edge.target_id,
        type: EDGE_TYPE_MAP[edge.edge_type],
      });
      renderedEdgePairs.add(pairKey);
    }

    const collisionFreeNodes = resolveNodeCollisions(visibleNodes, layoutRules);
    return { nodes: collisionFreeNodes, edges: visibleEdges };
  }, [
    explicitRootNode,
    composeParentByChild,
    dataEdges,
    dataNodes,
    expandedFlows,
    getOrderedChildren,
    handleAddChildNode,
    handleInsertBetween,
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

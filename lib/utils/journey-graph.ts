import type { Node, Edge } from "@xyflow/react";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import type { Node as DataNode, Edge as DataEdge, PlaylistEntry } from "@/lib/data/types";
import {
  EDGE_TYPE_TO_FLOW_TYPE,
  SPECIES_TO_NODE_TYPE,
  createVisualNodeId,
  getPlaylistEntries,
} from "@/lib/utils/graph-build";
import {
  addEffectiveNodeToRollup,
  computeFlowPlatformRollup,
  createEmptyRollup,
  getEffectivePlatformStatuses,
  getRollupDisplayStatus,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";

/**
 * The Journey map's graph construction (docs/spec/maps.md § Built-in Maps) —
 * extracted from the canvas page so it is pure, golden-testable, and reusable
 * by any surface that renders a journey. Playlist expansion with visual node
 * duplication is *renderer* logic over the map definition, which is why this
 * lives beside the UI rather than in @arkaik/schema.
 */

export const FLOW_CHILD_SPECIES = new Set<DataNode["species"]>(["flow", "view"]);

export type ViewCardVariant = "compact" | "large";

export interface ViewApiRelation {
  apiId: string;
  title: string;
  status: DataNode["status"];
  edgeType: EdgeTypeId;
}

export interface ViewApiRelations {
  inbound: ViewApiRelation[];
  outbound: ViewApiRelation[];
}

/** `calls` edges projected onto view cards as inbound/outbound API affordances. */
export function computeViewApiRelations(
  dataEdges: readonly DataEdge[],
  nodesById: ReadonlyMap<string, DataNode>,
): Map<string, ViewApiRelations> {
  const map = new Map<string, ViewApiRelations>();

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
}

export interface ComposeClosure {
  pairs: Array<{ parentId: string; child: DataNode }>;
  flowIds: Set<string>;
}

/**
 * Compose closure from the explicit root: views chain the walk onward, flows
 * are surfaced as collapsed cards whose interiors stay behind playlist
 * expansion (walking into a flow's compose children would double-render its
 * playlist). Pairs are in BFS discovery order; `flowIds` are the top-level
 * flows (reached without passing through another flow).
 */
export function computeComposeClosure(
  explicitRootNode: DataNode | null,
  composeChildIdsByParent: ReadonlyMap<string, string[]>,
  nodesById: ReadonlyMap<string, DataNode>,
): ComposeClosure {
  const pairs: Array<{ parentId: string; child: DataNode }> = [];
  const flowIds = new Set<string>();

  if (!explicitRootNode) return { pairs, flowIds };

  if (explicitRootNode.species === "flow") {
    flowIds.add(explicitRootNode.id);
    return { pairs, flowIds };
  }

  const visited = new Set<string>([explicitRootNode.id]);
  const queue: DataNode[] = [explicitRootNode];

  while (queue.length > 0) {
    const parent = queue.shift()!;

    for (const childId of composeChildIdsByParent.get(parent.id) ?? []) {
      if (visited.has(childId)) continue;
      const child = nodesById.get(childId);
      if (!child || !FLOW_CHILD_SPECIES.has(child.species)) continue;

      visited.add(childId);
      pairs.push({ parentId: parent.id, child });

      if (child.species === "flow") {
        flowIds.add(child.id);
      } else {
        queue.push(child);
      }
    }
  }

  return { pairs, flowIds };
}

interface RenderSequenceResult {
  startIds: string[];
  endIds: string[];
  entryNodeId?: string;
}

/** All handlers are optional — a headless build (tests, counts) passes none. */
export interface JourneyGraphHandlers {
  onToggleFlow?: (flowId: string) => void;
  onAddChild?: (flowId: string) => void;
  onOpenDetails?: (node: DataNode) => void;
  onZoomShot?: (node: DataNode) => void;
  onInsertBetween?: (parentFlowVisualId: string, targetEntryVisualId: string) => void;
}

export interface JourneyGraphParams {
  dataNodes: readonly DataNode[];
  dataEdges: readonly DataEdge[];
  nodesById: ReadonlyMap<string, DataNode>;
  composeParentByChild: ReadonlyMap<string, string>;
  explicitRootNode: DataNode | null;
  composeClosure: ComposeClosure;
  expandedFlows: ReadonlySet<string>;
  viewCardVariant: ViewCardVariant;
  viewApiRelationsByViewId: ReadonlyMap<string, ViewApiRelations>;
  handlers?: JourneyGraphHandlers;
}

/**
 * Build the Journey map's React Flow nodes and edges: the compose closure from
 * the root (or parentless flow/view roots when no explicit root exists), flows
 * expanded into their playlist sequences per `expandedFlows` — with visual
 * node duplication for reuse and synthetic branch nodes for condition/junction
 * entries — plus every cross-layer edge whose endpoints are both visible.
 * Pure: positions are `{0,0}` placeholders for ELK.
 */
export function buildJourneyGraph(params: JourneyGraphParams): { nodes: Node[]; edges: Edge[] } {
  const {
    dataNodes,
    dataEdges,
    nodesById,
    composeParentByChild,
    explicitRootNode,
    composeClosure,
    expandedFlows,
    viewCardVariant,
    viewApiRelationsByViewId,
    handlers = {},
  } = params;

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

    const flowNode = nodesById.get(flowNodeId);
    const rollup = flowNode
      ? computeFlowPlatformRollup(flowNode, nodesById, dataNodes, dataEdges)
      : createEmptyRollup();
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
      if (handlers.onToggleFlow) baseData.onToggle = () => handlers.onToggleFlow!(node.id);
      if (handlers.onAddChild) baseData.onAddChild = () => handlers.onAddChild!(node.id);
      if (handlers.onOpenDetails) baseData.onOpenDetails = () => handlers.onOpenDetails!(node);
    }

    if (node.species === "view") {
      const viewRollup = addEffectiveNodeToRollup(createEmptyRollup(), node, dataNodes, dataEdges);
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
      baseData.platformStatuses = getEffectivePlatformStatuses(node, dataNodes, dataEdges);
      baseData.apiInbound = apiRelations.inbound;
      baseData.apiOutbound = apiRelations.outbound;
      baseData.viewCardVariant = viewCardVariant;
      baseData.coverUrl = coverUrl;
      baseData.platformScreenshots = metadata.platformScreenshots;
      if (handlers.onOpenDetails) baseData.onOpenDetails = () => handlers.onOpenDetails!(node);
      if (handlers.onZoomShot) baseData.onZoomShot = () => handlers.onZoomShot!(node);
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

  const addComposeEdge = (source: string, target: string, data?: Record<string, unknown>) => {
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

  const connectIds = (sourceIds: string[], targetIds: string[], data?: Record<string, unknown>) => {
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
          const flowEntries = getPlaylistEntries(nodesById, flowNode.id);
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
        const edgeData = priorResult.entryNodeId && entryResult.entryNodeId && handlers.onInsertBetween
          ? {
              insertLabel: "Insert",
              onInsert: () => handlers.onInsertBetween!(parentFlowVisualId, entryResult.entryNodeId!),
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

    composeClosure.pairs.forEach(({ parentId, child }) => {
      addDataNode(child);
      addComposeEdge(parentId, child.id);

      if (child.species === "flow" && expandedFlows.has(child.id)) {
        renderedExpandedFlows.add(child.id);
        const childSequence = renderSequence(
          getPlaylistEntries(nodesById, child.id),
          2,
          new Set([child.id]),
          `root:${child.id}`,
          child.id,
        );
        connectIds([child.id], childSequence.startIds);
      }
    });

    if (explicitRootNode.species === "flow" && expandedFlows.has(explicitRootNode.id) && composeClosure.pairs.length === 0) {
      renderedExpandedFlows.add(explicitRootNode.id);
      const rootSequence = renderSequence(
        getPlaylistEntries(nodesById, explicitRootNode.id),
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
          getPlaylistEntries(nodesById, rootNode.id),
          2,
          new Set([rootNode.id]),
          `fallback:${rootNode.id}`,
          rootNode.id,
        );
        connectIds([rootNode.id], rootSequence.startIds);
      }
    });
  }

  // Cross-layer edges (calls, displays, queries) between visible nodes.
  const renderedEdgePairs = new Set(visibleEdges.map((edge) => `${edge.source}:${edge.target}`));

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
          type: EDGE_TYPE_TO_FLOW_TYPE[edge.edge_type],
        });
        renderedEdgePairs.add(pairKey);
      }
    }
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}

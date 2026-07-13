import type { SpeciesId } from "@/lib/config/species";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import type { Node as DataNode, PlaylistEntry } from "@/lib/data/types";

/** Species → React Flow node type registered in components/graph/Canvas.tsx. */
export const SPECIES_TO_NODE_TYPE: Record<SpeciesId, string> = {
  flow: "flow",
  view: "view",
  "data-model": "dataModel",
  "api-endpoint": "apiEndpoint",
};

/** Domain edge type → React Flow edge type registered in Canvas.tsx. */
export const EDGE_TYPE_TO_FLOW_TYPE: Record<EdgeTypeId, string> = {
  composes: "compose",
  calls: "calls",
  displays: "displays",
  queries: "queries",
};

/**
 * A reused node renders once per playlist occurrence as a *visual* node:
 * `{nodeId}@{parentFlowVisualId}:{entryIndex}`. `getBaseNodeId` maps any
 * visual id back to the underlying data node.
 */
export const VISUAL_NODE_ID_SEPARATOR = "@";

export function createVisualNodeId(nodeId: string, parentFlowId: string, entryIndex: number): string {
  return `${nodeId}${VISUAL_NODE_ID_SEPARATOR}${parentFlowId}:${entryIndex}`;
}

export function getBaseNodeId(nodeId: string): string {
  const separatorIndex = nodeId.indexOf(VISUAL_NODE_ID_SEPARATOR);
  return separatorIndex >= 0 ? nodeId.slice(0, separatorIndex) : nodeId;
}

/** Every node id a playlist references, recursing through branch entries. */
export function collectReferencedNodeIds(entries: PlaylistEntry[]): string[] {
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

export function createPlaylistEntryForSpecies(species: SpeciesId, nodeId: string): PlaylistEntry | null {
  if (species === "view") {
    return { type: "view", view_id: nodeId };
  }

  if (species === "flow") {
    return { type: "flow", flow_id: nodeId };
  }

  return null;
}

/** Ordered playlist entries of a flow node, `[]` when absent. */
export function getPlaylistEntries(nodesById: ReadonlyMap<string, DataNode>, nodeId: string): PlaylistEntry[] {
  const entries = nodesById.get(nodeId)?.metadata?.playlist?.entries;
  return Array.isArray(entries) ? entries : [];
}

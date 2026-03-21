import type { Node, PlaylistEntry } from "@/lib/data/types";

function referencesNode(entries: PlaylistEntry[], targetId: string): boolean {
  for (const entry of entries) {
    if (entry.type === "view" && entry.view_id === targetId) return true;
    if (entry.type === "flow" && entry.flow_id === targetId) return true;
    if (entry.type === "condition") {
      if (referencesNode(entry.if_true, targetId) || referencesNode(entry.if_false, targetId)) return true;
    }
    if (entry.type === "junction") {
      for (const c of entry.cases) {
        if (referencesNode(c.entries, targetId)) return true;
      }
    }
  }
  return false;
}

/**
 * Returns all Flow nodes whose playlist references the given node id,
 * including references nested inside condition branches and junction cases.
 */
export function findWhereUsed(nodeId: string, allNodes: Node[]): Node[] {
  return allNodes.filter((node) => {
    if (node.species !== "flow") return false;
    const entries = node.metadata?.playlist?.entries;
    if (!Array.isArray(entries)) return false;
    return referencesNode(entries, nodeId);
  });
}

import type { Node, PlaylistEntry } from "@/lib/data/types";

function collectReferencedFlowIds(entries: PlaylistEntry[]): string[] {
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.type === "flow") {
      result.push(entry.flow_id);
      continue;
    }

    if (entry.type === "condition") {
      result.push(...collectReferencedFlowIds(entry.if_true));
      result.push(...collectReferencedFlowIds(entry.if_false));
      continue;
    }

    if (entry.type === "junction") {
      for (const playlistCase of entry.cases) {
        result.push(...collectReferencedFlowIds(playlistCase.entries));
      }
    }
  }

  return result;
}

/**
 * Returns true if adding `candidateId` to `flowId`'s playlist would create a cycle.
 */
export function wouldCreateCycle(
  flowId: string,
  candidateId: string,
  allNodes: Node[],
): boolean {
  if (candidateId === flowId) return true;

  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  const candidate = nodesById.get(candidateId);
  if (!candidate || candidate.species !== "flow") return false;

  const visited = new Set<string>();
  const stack = [candidateId];

  while (stack.length > 0) {
    const currentFlowId = stack.pop();
    if (!currentFlowId) continue;
    if (visited.has(currentFlowId)) continue;
    visited.add(currentFlowId);

    const currentFlow = nodesById.get(currentFlowId);
    if (!currentFlow || currentFlow.species !== "flow") continue;

    const entries = currentFlow.metadata?.playlist?.entries;
    if (!Array.isArray(entries)) continue;

    const referencedFlowIds = collectReferencedFlowIds(entries);
    if (referencedFlowIds.includes(flowId)) return true;

    for (const referencedFlowId of referencedFlowIds) {
      if (!visited.has(referencedFlowId)) {
        stack.push(referencedFlowId);
      }
    }
  }

  return false;
}

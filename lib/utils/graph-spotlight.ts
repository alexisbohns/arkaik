import type { Node, Edge } from "@xyflow/react";

/**
 * Neighborhood spotlight — the legibility multiplier for dense maps: dim
 * everything except an anchor node, its direct neighbors, and the edges
 * incident to the anchor. Pure and identity-preserving: lit elements keep
 * their object identity (React Flow's memoized wrappers skip them entirely);
 * only dimmed elements get a new object carrying the dim class.
 */

export const SPOTLIGHT_DIM_CLASS = "arkaik-dim";

export interface SpotlightIndex {
  /** Undirected adjacency: node id → its direct neighbors. */
  neighborsByNodeId: Map<string, Set<string>>;
  /** Edge ids incident to each node. */
  edgeIdsByNodeId: Map<string, Set<string>>;
}

export function buildSpotlightIndex(edges: readonly Edge[]): SpotlightIndex {
  const neighborsByNodeId = new Map<string, Set<string>>();
  const edgeIdsByNodeId = new Map<string, Set<string>>();

  const addNeighbor = (from: string, to: string) => {
    const set = neighborsByNodeId.get(from);
    if (set) set.add(to);
    else neighborsByNodeId.set(from, new Set([to]));
  };
  const addEdge = (nodeId: string, edgeId: string) => {
    const set = edgeIdsByNodeId.get(nodeId);
    if (set) set.add(edgeId);
    else edgeIdsByNodeId.set(nodeId, new Set([edgeId]));
  };

  for (const edge of edges) {
    addNeighbor(edge.source, edge.target);
    addNeighbor(edge.target, edge.source);
    addEdge(edge.source, edge.id);
    addEdge(edge.target, edge.id);
  }

  return { neighborsByNodeId, edgeIdsByNodeId };
}

function withDimClass(className: string | undefined): string {
  return className ? `${className} ${SPOTLIGHT_DIM_CLASS}` : SPOTLIGHT_DIM_CLASS;
}

/**
 * Dim everything outside the anchor's neighborhood. The anchor, its direct
 * neighbors, and the edges incident to the anchor stay untouched (same object
 * identity); neighbor-to-neighbor edges are dimmed too, which keeps the
 * spotlight a readable star. An anchor that is not in `nodes` (deleted under
 * the cursor) returns the inputs untouched.
 */
export function applySpotlight(
  nodes: Node[],
  edges: Edge[],
  anchorId: string,
  index: SpotlightIndex,
): { nodes: Node[]; edges: Edge[] } {
  if (!nodes.some((node) => node.id === anchorId)) {
    return { nodes, edges };
  }

  const neighbors = index.neighborsByNodeId.get(anchorId) ?? new Set<string>();
  const litEdgeIds = index.edgeIdsByNodeId.get(anchorId) ?? new Set<string>();

  const spotlitNodes = nodes.map((node) => {
    if (node.id === anchorId || neighbors.has(node.id)) return node;
    return { ...node, className: withDimClass(node.className) };
  });

  const spotlitEdges = edges.map((edge) => {
    if (litEdgeIds.has(edge.id)) return edge;
    return { ...edge, className: withDimClass(edge.className) };
  });

  return { nodes: spotlitNodes, edges: spotlitEdges };
}

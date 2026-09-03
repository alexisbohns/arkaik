import type { ProjectBundle, JournalEvent } from "@/lib/data/types";

/**
 * The induced sub-bundle over `nodeIds`: those nodes, every edge with both ends
 * inside, and the journal events that speak about them — plus every event
 * that names no node at all (`release.tagged`, `idea.proposed` without a
 * node), because a changelog excerpt needs its release boundaries. The
 * project record is reused, not cloned: a preview reads it, never writes.
 */
export function sliceBundle(bundle: ProjectBundle, nodeIds: readonly string[]): ProjectBundle {
  const keep = new Set(nodeIds);
  const nodes = bundle.nodes.filter((node) => keep.has(node.id));
  const edges = bundle.edges.filter((edge) => keep.has(edge.source_id) && keep.has(edge.target_id));
  const journal = (bundle.journal ?? []).filter((event) => {
    const nodeId = (event as JournalEvent & { node_id?: unknown }).node_id;
    return typeof nodeId !== "string" || keep.has(nodeId);
  });
  return { ...bundle, nodes, edges, journal };
}

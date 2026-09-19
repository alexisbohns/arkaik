// A rule this module keeps, not a description of some loader that exists: every
// import here stays type-only. `loadUtil` (tests/app/load-panel-utils.js)
// transpiles a file in place without rewriting module resolution, so a VALUE
// import of `@/lib/data/types` would become a runtime require of a path Node
// cannot resolve, and this module would stop being loadable by the suite that
// covers it (tests/app/project-panels.test.js). Types erase; values do not.
import type { Node, Edge, PlaylistEntry } from "@/lib/data/types";

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
export function findWhereUsed(nodeId: string, allNodes: readonly Node[]): Node[] {
  return allNodes.filter((node) => {
    if (node.species !== "flow") return false;
    const entries = node.metadata?.playlist?.entries;
    if (!Array.isArray(entries)) return false;
    return referencesNode(entries, nodeId);
  });
}

/**
 * The views and flows an acceptance covers, resolved to nodes — the rows
 * `CoversSection` lists, and the anchors `AcceptanceMembershipField` counts for
 * its Product hint (and `AcceptanceAuthoredFields` for the split dialog's).
 *
 * Shared rather than written out again in each because all three are the same
 * question asked by components that no longer render inside one another, and a
 * derivation copied into each is a derivation that drifts. Resolved, not merely
 * counted: a `covers` edge pointing at a node this snapshot does not hold is
 * dropped, which is what `productsOfAcceptance` does too — so a hint that says
 * "the 2 nodes it covers" never counts an anchor the panel cannot show.
 */
export function coveredAnchorsOf(
  node: Node,
  allNodes: readonly Node[],
  allEdges: readonly Edge[],
): Node[] {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  return allEdges
    .filter((e) => e.edge_type === "covers" && e.source_id === node.id)
    .map((e) => nodesById.get(e.target_id))
    .filter((n): n is Node => Boolean(n));
}

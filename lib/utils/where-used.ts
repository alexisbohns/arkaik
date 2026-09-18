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
 * The data models, API endpoints and decisions this node is wired to — the rows
 * `ConnectionsSection` lists, lifted out of it so `RelationsGroup` can ask
 * whether there are any without walking the edges a second time.
 *
 * `composes` is excluded because it is the playlist's own edge — what a flow is
 * made of, which `PlaylistEditor` lists in full — and was never part of this
 * list. A decision's own decision-typed edges are excluded for the
 * reason the section always excluded them: `DecisionEditor` lists both
 * directions already, and a decision node would otherwise double-list them.
 *
 * That exclusion, as `ConnectionsSection` recorded it when the walk lived inside
 * it — the comment travels with the code rather than being left behind at the
 * call site, so the rule and its reason cannot drift apart:
 *
 * > DecisionEditor owns decision-typed edges (supersedes/generates/impacts) for
 * > a decision node itself — its "Decision links" section already lists both
 * > directions (supersedes/supersededBy/generates/impacts). This section shows
 * > them only from the OTHER endpoint's side, so a non-decision node can see
 * > which decisions impact/generate it ("decided by") without a decision node
 * > double-listing its own edges.
 */
export function crossLayerConnections(
  node: Node,
  allNodes: readonly Node[],
  allEdges: readonly Edge[],
): Node[] {
  const isDecisionEdge = (e: Edge) =>
    e.edge_type === "supersedes" || e.edge_type === "generates" || e.edge_type === "impacts";

  const reached = allEdges
    .filter((e) => e.edge_type !== "composes" && (e.source_id === node.id || e.target_id === node.id))
    .filter((e) => !(node.species === "decision" && isDecisionEdge(e)))
    .map((e) => {
      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
      return allNodes.find((n) => n.id === otherId);
    })
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint" || n.species === "decision"));

  return [...new Map(reached.map((n) => [n.id, n])).values()];
}

/**
 * The views and flows an acceptance covers, resolved to nodes — the rows
 * `CoversSection` lists, and the anchors `AcceptanceEditor` counts for its
 * Product hint.
 *
 * Shared rather than written twice because those two are the same question
 * asked by two components that no longer render inside one another, and a
 * derivation copied into both is a derivation that drifts. Resolved, not merely
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

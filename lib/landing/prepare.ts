import { computeMapSubgraph } from "@arkaik/schema";
import { FIXTURES } from "@/components/landing/fixtures";
import { JOURNEY_DEFINITION, SYSTEM_DEFINITION } from "@/components/landing/previews/definitions";
import type { PreviewId } from "@/components/landing/previews/ids";
import type { ProjectBundle } from "@/lib/data/types";
import { sliceBundle } from "@/lib/landing/slice";

/**
 * The bundle a preview actually needs, computed on the server before the
 * element crosses to the client. The two canvas previews are client components
 * and the matrix hands a whole `nodesById` to a client leaf, so all three would
 * otherwise carry an entire seed; they get the induced sub-bundle over the
 * nodes they draw. Every other id gets the bundle unchanged, since a server
 * preview already hands its leaf only rendered props.
 */
export function prepareBundle(id: PreviewId, bundle: ProjectBundle): ProjectBundle {
  switch (id) {
    case "journey-map":
      return sliceBundle(bundle, journeyClosureIds(bundle));
    case "system-map": {
      const subgraph = computeMapSubgraph(SYSTEM_DEFINITION, bundle.nodes, bundle.edges);
      return sliceBundle(bundle, subgraph.nodes.map((node) => node.id));
    }
    case "acceptance-matrix":
      return sliceBundle(bundle, matrixIds(bundle));
    case "self-map-journey":
      // Every flow and view, nothing else: the top-level cards render collapsed
      // and read status from the views, so the graph's other species would
      // only add payload (flows + views ≈ 45 KB raw against 200 KB for all).
      return sliceBundle(bundle, bundle.nodes.filter((n) => n.species === "flow" || n.species === "view").map((n) => n.id));
    default:
      return bundle;
  }
}

/**
 * The journey's closure: the root flow and everything reachable *downward*
 * through `composes` edges among flows and views — the playlist, synthesised
 * into edges at write time, and the sub-flows and views it opens onto. This is
 * what `computeComposeClosure` plus playlist expansion draws from an expanded
 * root; `computeMapSubgraph` is not used for the journey because its BFS is
 * undirected and would walk up out of the flow into the whole product.
 *
 * Plus one hop over `calls` edges from or to those views: `ViewNode` draws its
 * inbound/outbound API popovers from `computeViewApiRelations` over the sliced
 * edges, and that function keeps a `calls` edge only when *both* ends resolve
 * in `nodesById` — so the endpoints have to come along or every view card
 * loses its API affordances.
 */
function journeyClosureIds(bundle: ProjectBundle): string[] {
  const rootId = JOURNEY_DEFINITION.root_node_id!;
  const speciesById = new Map(bundle.nodes.map((node) => [node.id, node.species]));
  const childrenByParent = new Map<string, string[]>();
  for (const edge of bundle.edges) {
    if (edge.edge_type !== "composes") continue;
    const species = speciesById.get(edge.target_id);
    if (species !== "flow" && species !== "view") continue;
    const children = childrenByParent.get(edge.source_id) ?? [];
    children.push(edge.target_id);
    childrenByParent.set(edge.source_id, children);
  }
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const childId of childrenByParent.get(parent) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
    }
  }
  const endpoints = new Set<string>();
  for (const edge of bundle.edges) {
    if (edge.edge_type !== "calls") continue;
    if (visited.has(edge.source_id) && speciesById.get(edge.target_id) === "api-endpoint") endpoints.add(edge.target_id);
    if (visited.has(edge.target_id) && speciesById.get(edge.source_id) === "api-endpoint") endpoints.add(edge.source_id);
  }
  return [...visited, ...endpoints];
}

/**
 * The matrix's rows and their anchors: every acceptance, every node it
 * `covers` (the grouping key `groupAcceptancesByAnchor` resolves through
 * `nodesById`), and the pinned ids.
 */
function matrixIds(bundle: ProjectBundle): string[] {
  const keep = new Set<string>(FIXTURES["acceptance-matrix"].nodeIds!);
  for (const node of bundle.nodes) if (node.species === "acceptance") keep.add(node.id);
  for (const edge of bundle.edges) if (edge.edge_type === "covers" && keep.has(edge.source_id)) keep.add(edge.target_id);
  return [...keep];
}

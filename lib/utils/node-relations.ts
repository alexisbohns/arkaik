/**
 * Writing a node's relations from its panel, as pure functions over plain data.
 *
 * Every operation returns **mutation ops** rather than performing itself, for
 * the reason `acceptance-intake.ts` and `product-editing.ts` do: creating a
 * counterpart and linking it in the same gesture is two writes that must commit
 * as one, and a rule living inside a component is a rule this repo has no
 * runner to assert.
 *
 * **`covers` does not come through here.** Both covers lines keep the intake
 * write path (`useAcceptanceIntake`), because a covers edge is not just an
 * edge: attaching one can empty an acceptance's derived product membership —
 * which the surface has to announce — and a node created in that gesture
 * inherits the acceptance's product. A generic edge write knows none of that,
 * and two writers for one edge type is two chances to disagree about what
 * attaching means. The boundary: **covers edges are intake's, every other edge
 * is this module's.**
 *
 * `composes` does not come through here either; see `PANEL_EXCLUDED_EDGE_TYPES`.
 *
 * Deliberately React-free and provider-free.
 */

import {
  deriveNodeId,
  edgeId,
  isValidEdgeSemantic,
  type MutationOp,
  type SpeciesId,
} from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import { relationRows, type RelationLineSpec } from "@/lib/utils/relation-lines";

/** The minimum shape these rules need of a node — never the whole thing. */
type NodeLike = Pick<Node, "id" | "species">;

/**
 * Which way round the edge goes.
 *
 * The one piece of arithmetic in this module and the one worth naming: an
 * inbound line writes `counterpart → node`, and getting it backwards produces
 * an edge that renders on the wrong line and fails the next import.
 */
export function relationEndpoints(
  node: NodeLike,
  counterpart: NodeLike,
  line: RelationLineSpec,
): { source: NodeLike; target: NodeLike } {
  return line.direction === "out"
    ? { source: node, target: counterpart }
    : { source: counterpart, target: node };
}

/**
 * Link this node to a counterpart along one line.
 *
 * Empty is a real answer twice over, and neither is an error worth surfacing: a
 * node pointed at itself, and an edge that already exists (a second click, or a
 * combobox selection racing a sync).
 *
 * The self check comes first, before the grammar one, and deliberately: the
 * grammar admits `api-endpoint → api-endpoint` and `decision → decision`, so
 * for those two species a self link would pass the grammar and write an edge
 * from a node to itself that nobody asked for. Refusing it here refuses it for
 * every species alike.
 *
 * An edge the grammar forbids **throws**, because it cannot come from the user:
 * the combobox only offers `line.counterpartSpecies`, so a forbidden pair
 * reaching here is a bug in the caller, and writing it would plant an
 * `edge-semantics` failure that only surfaces on the next import.
 */
export function planRelationLink(
  node: NodeLike,
  counterpart: NodeLike,
  line: RelationLineSpec,
  projectId: string,
  edges: readonly Edge[],
): MutationOp[] {
  if (counterpart.id === node.id) return [];

  const { source, target } = relationEndpoints(node, counterpart, line);
  if (!isValidEdgeSemantic(line.edgeType, source.species, target.species)) {
    throw new Error(
      `edge-semantics: ${line.edgeType} does not admit ${source.species} → ${target.species}`,
    );
  }

  const linked = relationRows(node.id, line, edges).some((row) => row.counterpartId === counterpart.id);
  if (linked) return [];

  return [
    {
      op: "create_edge",
      edge: {
        id: edgeId(source.id, target.id),
        project_id: projectId,
        source_id: source.id,
        target_id: target.id,
        edge_type: line.edgeType,
      },
    },
  ];
}

/**
 * Unlink this node from one counterpart along one line.
 *
 * **Every** matching edge, not the first: `e-{source}-{target}` makes a
 * duplicate pair impossible to mint through the app, but a hand-edited or
 * half-synced bundle can carry two edges with different ids and the same
 * endpoints. Deleting one leaves the row on screen after the user removed it,
 * with no way to tell why. (The same rule, and the same reason, as
 * `planAcceptanceDetach`.)
 *
 * **A self-loop unlinks from both lines at once, and that is correct.** The
 * grammar admits `api-endpoint → api-endpoint` and `decision → decision`, and
 * such an edge renders twice — once outbound, once inbound — because it is one
 * edge read from both directions. Removing it from either line removes the one
 * edge, so both rows go. It reads like a double delete and is not one.
 */
export function planRelationUnlink(
  nodeId: string,
  counterpartId: string,
  line: RelationLineSpec,
  edges: readonly Edge[],
): MutationOp[] {
  return edges
    .filter((edge) => edge.edge_type === line.edgeType)
    .filter((edge) => {
      const [from, to] =
        line.direction === "out" ? [edge.source_id, edge.target_id] : [edge.target_id, edge.source_id];
      return from === nodeId && to === counterpartId;
    })
    .map((edge) => ({ op: "delete_edge", edge_id: edge.id }));
}

/** A new counterpart and the edge linking it — the node is returned so a caller can navigate to it. */
export interface RelationCreationPlan {
  node: Node;
  ops: MutationOp[];
}

/**
 * Create the counterpart and link it, as one write.
 *
 * `status: "idea"` and `platforms: []` match the other create-from-a-panel
 * paths (`onCreateNode`, `planAnchorForAcceptance`): a node minted mid-gesture
 * states no availability it has not been asked about, and the panel that opens
 * next is where that gets said.
 *
 * **No product is inherited**, unlike `planAnchorForAcceptance`. That rule
 * exists because anchors govern an acceptance's membership, so a view created
 * for an acceptance must carry the product or the idea falls back into triage.
 * Nothing on these lines governs membership that way, and guessing a product
 * for an endpoint because the view calling it has one would be inventing an
 * assignment the user was not asked about.
 *
 * `null` for a blank title rather than a hash-suffixed id for an untitled node:
 * the combobox only offers the action once something is typed, so whitespace
 * reaching here is a mis-click.
 */
export function planRelationNew(
  node: Node,
  line: RelationLineSpec,
  species: SpeciesId,
  title: string,
  projectId: string,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): RelationCreationPlan | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (!line.counterpartSpecies.includes(species)) {
    throw new Error(`${line.id} does not admit a ${species} counterpart`);
  }

  const created: Node = {
    id: deriveNodeId(species, trimmed, nodesById.keys()),
    project_id: projectId,
    species,
    title: trimmed,
    status: "idea",
    platforms: [],
  };

  return {
    node: created,
    ops: [
      { op: "create_node", node: created },
      ...planRelationLink(node, created, line, projectId, edges),
    ],
  };
}

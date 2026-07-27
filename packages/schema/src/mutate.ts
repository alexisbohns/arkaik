/**
 * Mutation semantics — what a graph edit *means*, independent of where it is
 * stored (issue: hosted graph, slice 2).
 *
 * Before this module the same semantics existed twice and were about to exist
 * three times: `lib/data/local-provider.ts` (Dexie), `packages/mcp/src/tools.ts`
 * (files on disk), and next the hosted Postgres store. They had already drifted
 * — the app carried a flow-cycle guard the MCP server lacked, and the MCP server
 * carried composes-edge synthesis the app performed by hand in its playlist
 * editor. One definition means every writer inherits every invariant.
 *
 * SCOPE, deliberately narrow: this computes the next graph and the journal
 * events that describe the change. It does NOT validate and it does NOT persist.
 * `validateBundle` stays each writer's own gate — the MCP server and the hosted
 * store run it before writing; the browser app does not, and this refactor does
 * not change that. Keeping the two concerns apart is what lets this module stay
 * pure, browser-safe, and testable without a store.
 *
 * Zod-free (type-only imports) like validate.ts / acceptance.ts / derive.ts, so
 * it bundles into the standalone validator and the CLI without dragging zod in.
 */

import { edgeId } from "./id-gen";
import { collectPlaylistNodeRefs, type PlaylistEntry } from "./playlist";
import {
  diffNodeUpdate,
  edgeAddedInput,
  edgeRemovedInput,
  nodeCreatedInput,
  nodeDeletedInput,
  type EventInput,
} from "./derive";
import type { Edge, Node } from "./bundle";

/** The patchable surface of a node: never its identity, never its project. */
export type NodePatch = Partial<Omit<Node, "id" | "project_id">>;

export type MutationOp =
  | { op: "create_node"; node: Node }
  | { op: "update_node"; node_id: string; patch: NodePatch }
  | { op: "delete_node"; node_id: string }
  | { op: "delete_nodes"; node_ids: readonly string[] }
  | { op: "create_edge"; edge: Edge }
  | { op: "delete_edge"; edge_id: string };

export type MutationErrorCode =
  | "node_not_found"
  | "edge_not_found"
  | "duplicate_node"
  | "edge_type_conflict"
  | "playlist_cycle";

/**
 * A refused mutation. Carries a machine-readable `code` so each writer can map
 * it onto its own error shape (the MCP server's `ToolError`, an HTTP status)
 * without string-matching a message.
 */
export class MutationError extends Error {
  readonly code: MutationErrorCode;
  /** The node or edge id the refusal is about, when there is one. */
  readonly subjectId?: string;

  constructor(code: MutationErrorCode, message: string, subjectId?: string) {
    super(message);
    this.name = "MutationError";
    this.code = code;
    this.subjectId = subjectId;
  }
}

/** The graph a mutation applies to. */
export interface MutationInput {
  projectId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
}

export interface MutationOutcome {
  nodes: Node[];
  edges: Edge[];
  /** Events describing the change, unstamped — pass to `toJournalEvents(…, actor)`. */
  eventInputs: EventInput[];
  /** `composes` edges added to keep a flow's playlist coherent. */
  synthesizedEdges: Edge[];
  /** Edge ids removed as a cascade of a node deletion (never separately evented). */
  cascadedEdgeIds: string[];
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/**
 * Whether adding `candidateId` to `flowId`'s playlist would close a loop.
 *
 * Previously `lib/utils/cycle.ts`, app-only. The MCP server had no equivalent
 * and relied on `validateBundle`'s `flow-cycle` rule catching it after the fact;
 * now both refuse the mutation up front, with the same message.
 */
export function wouldCreateCycle(
  flowId: string,
  candidateId: string,
  allNodes: readonly Node[],
): boolean {
  if (candidateId === flowId) return true;

  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  const candidate = nodesById.get(candidateId);
  if (!candidate || candidate.species !== "flow") return false;

  const visited = new Set<string>();
  const stack = [candidateId];

  while (stack.length > 0) {
    const currentFlowId = stack.pop();
    if (!currentFlowId || visited.has(currentFlowId)) continue;
    visited.add(currentFlowId);

    const currentFlow = nodesById.get(currentFlowId);
    if (!currentFlow || currentFlow.species !== "flow") continue;

    const entries = currentFlow.metadata?.playlist?.entries;
    if (!Array.isArray(entries)) continue;

    const referenced = collectPlaylistNodeRefs(entries as PlaylistEntry[]);
    if (referenced.includes(flowId)) return true;
    for (const refId of referenced) {
      if (!visited.has(refId)) stack.push(refId);
    }
  }

  return false;
}

/**
 * The `composes` edges a flow's playlist requires but that do not exist yet
 * (docs/spec/mcp.md § Write Path — Playlist composition).
 *
 * Without this, a flow cannot be created with a populated playlist in a single
 * validated mutation (issue #263): `validateBundle`'s `playlist-composes-
 * coherence` rule demands a `composes` edge for every referenced view/sub-flow,
 * but an edge cannot be added before the flow node exists — a deadlock no call
 * ordering escapes. Edges that already exist are left untouched, and a repeated
 * reference yields one edge.
 */
export function synthesizeComposesEdges(
  flow: Node,
  existingEdges: readonly Edge[],
  projectId: string,
): Edge[] {
  if (flow.species !== "flow") return [];
  const entries = flow.metadata?.playlist?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const existingIds = new Set(existingEdges.map((edge) => edge.id));
  const seen = new Set<string>();
  const synthesized: Edge[] = [];

  for (const refId of collectPlaylistNodeRefs(entries as PlaylistEntry[])) {
    const id = edgeId(flow.id, refId);
    if (existingIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    synthesized.push({
      id,
      project_id: projectId,
      source_id: flow.id,
      target_id: refId,
      edge_type: "composes",
    });
  }
  return synthesized;
}

/** Guard every sub-flow a playlist references against closing a loop. */
function assertNoPlaylistCycle(flow: Node, nextNodes: readonly Node[]): void {
  const entries = flow.metadata?.playlist?.entries;
  if (!Array.isArray(entries)) return;
  for (const candidateId of collectPlaylistNodeRefs(entries as PlaylistEntry[])) {
    if (wouldCreateCycle(flow.id, candidateId, nextNodes)) {
      throw new MutationError(
        "playlist_cycle",
        `Cannot add Flow ${candidateId}: it would create a circular reference.`,
        candidateId,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// applyOps
// ---------------------------------------------------------------------------

/**
 * Apply `ops` in order to a graph, returning the next graph plus the journal
 * events the change implies. Pure: the inputs are never mutated.
 *
 * Ops compose — a later op sees the results of earlier ones — which is what
 * lets a caller create a node and its edge as ONE atomic unit. That is the
 * point of batching: today `app/project/[id]/acceptances/page.tsx` creates an
 * acceptance node, then a `covers` edge, and hand-rolls a rollback of the node
 * when the edge fails, because it has no way to ask for both at once.
 *
 * Throws {@link MutationError} on a refused op, leaving the caller's graph
 * untouched (nothing is written until the caller persists the result).
 */
export function applyOps(input: MutationInput, ops: readonly MutationOp[]): MutationOutcome {
  let nodes: Node[] = [...input.nodes];
  let edges: Edge[] = [...input.edges];
  const eventInputs: EventInput[] = [];
  const synthesizedEdges: Edge[] = [];
  const cascadedEdgeIds: string[] = [];

  /** Fold synthesized composes edges for `flow` into the working graph. */
  const foldSynthesized = (flow: Node): void => {
    const created = synthesizeComposesEdges(flow, edges, input.projectId);
    if (created.length === 0) return;
    edges = [...edges, ...created];
    synthesizedEdges.push(...created);
    eventInputs.push(...created.map(edgeAddedInput));
  };

  for (const op of ops) {
    switch (op.op) {
      case "create_node": {
        if (nodes.some((candidate) => candidate.id === op.node.id)) {
          throw new MutationError("duplicate_node", `Node "${op.node.id}" already exists.`, op.node.id);
        }
        nodes = [...nodes, op.node];
        assertNoPlaylistCycle(op.node, nodes);
        eventInputs.push(nodeCreatedInput(op.node));
        foldSynthesized(op.node);
        break;
      }

      case "update_node": {
        const index = nodes.findIndex((candidate) => candidate.id === op.node_id);
        if (index === -1) {
          throw new MutationError("node_not_found", `Node ${op.node_id} not found`, op.node_id);
        }
        const current = nodes[index];
        const updated: Node = { ...current, ...op.patch };

        const nextNodes = [...nodes];
        nextNodes[index] = updated;
        // Guarded BEFORE any event is derived, so a refused update emits nothing.
        if (updated.species === "flow") assertNoPlaylistCycle(updated, nextNodes);

        // A no-op patch produces no events and no synthesis — callers rely on
        // this to skip a write entirely.
        const inputs = diffNodeUpdate(current, op.patch);
        nodes = nextNodes;
        eventInputs.push(...inputs);
        if (inputs.length > 0) foldSynthesized(updated);
        break;
      }

      case "delete_node": {
        if (!nodes.some((candidate) => candidate.id === op.node_id)) {
          throw new MutationError("node_not_found", `Node ${op.node_id} not found`, op.node_id);
        }
        nodes = nodes.filter((candidate) => candidate.id !== op.node_id);
        // The journal's node.deleted IMPLIES the edge cascade, so cascaded edges
        // get NO edge.removed of their own (docs/spec/journal.md:71).
        for (const edge of edges) {
          if (edge.source_id === op.node_id || edge.target_id === op.node_id) {
            cascadedEdgeIds.push(edge.id);
          }
        }
        edges = edges.filter(
          (edge) => edge.source_id !== op.node_id && edge.target_id !== op.node_id,
        );
        eventInputs.push(nodeDeletedInput(op.node_id));
        break;
      }

      case "delete_nodes": {
        // Only ids actually present are deleted and evented, so a node.deleted
        // never references a node that was never there.
        const present = new Set(
          nodes.filter((candidate) => op.node_ids.includes(candidate.id)).map((n) => n.id),
        );
        if (present.size === 0) break;
        nodes = nodes.filter((candidate) => !present.has(candidate.id));
        for (const edge of edges) {
          if (present.has(edge.source_id) || present.has(edge.target_id)) {
            cascadedEdgeIds.push(edge.id);
          }
        }
        edges = edges.filter(
          (edge) => !present.has(edge.source_id) && !present.has(edge.target_id),
        );
        for (const id of present) eventInputs.push(nodeDeletedInput(id));
        break;
      }

      case "create_edge": {
        // Enforce the `e-{source}-{target}` convention at the seam, so any edge
        // creation stays conformant regardless of the id the caller supplied
        // (issue #215, docs/spec/bundle-format.md § Identifier Conventions).
        const edge: Edge = { ...op.edge, id: edgeId(op.edge.source_id, op.edge.target_id) };
        const existing = edges.find((candidate) => candidate.id === edge.id);
        if (existing) {
          // Idempotent by design: synthesis and an explicit create can race for
          // the same composes edge (the playlist editor adds the entry and the
          // edge together). Re-creating an identical edge is a no-op; only a
          // DIFFERENT edge_type on the same endpoints is a real conflict.
          if (existing.edge_type !== edge.edge_type) {
            throw new MutationError(
              "edge_type_conflict",
              `Edge "${edge.id}" already exists as "${existing.edge_type}", cannot re-add as "${edge.edge_type}".`,
              edge.id,
            );
          }
          break;
        }
        edges = [...edges, edge];
        eventInputs.push(edgeAddedInput(edge));
        break;
      }

      case "delete_edge": {
        if (!edges.some((candidate) => candidate.id === op.edge_id)) {
          throw new MutationError("edge_not_found", `Edge ${op.edge_id} not found`, op.edge_id);
        }
        edges = edges.filter((candidate) => candidate.id !== op.edge_id);
        eventInputs.push(edgeRemovedInput(op.edge_id));
        break;
      }
    }
  }

  return { nodes, edges, eventInputs, synthesizedEdges, cascadedEdgeIds };
}

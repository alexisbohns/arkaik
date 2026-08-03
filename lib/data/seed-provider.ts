import { applyOps, type MutationOp } from "@arkaik/schema";

import type { DataProvider } from "./data-provider";
import { toJournalEvents } from "./emit-events";
import { migrateBundle } from "./migrate";
import type { Node, ProjectBundle } from "./types";

/**
 * The public self-map's provider (self-map program, cycle 4): a `DataProvider`
 * over per-tab memory, initialized from a bundle the factory is given (in
 * production, the build-time-imported `seed/arkaik-self-map.json`).
 *
 * Every mutator SUCCEEDS and applies in memory through the same `applyOps` +
 * journal derivation the local provider uses — that is the entire sandbox
 * mechanism: editors, hooks, and toasts behave exactly as on a real project,
 * nothing touches IndexedDB or the network, and a page refresh (fresh module
 * state) restores the pristine seed. Two deliberate refusals:
 *
 * - `archiveProject` — "delete" on the Settings page archives; an in-memory
 *   archive of the always-listed public project would just relist it on the
 *   next refresh while looking like a successful delete. The UI hides the
 *   affordance; this is the backstop.
 * - `importProject` — the routing provider always sends imports to the local
 *   provider, so this path is unreachable; rejecting keeps it honest.
 *
 * The pristine source is protected by cloning on init, and every read hands
 * out a clone so no caller can alias sandbox-internal state.
 */
export function createSeedProvider(loadBundle: () => ProjectBundle): DataProvider {
  let bundle: ProjectBundle | null = null;

  const ensure = (): ProjectBundle => {
    // `migrateBundle` mirrors the local import path: the shipped seed is
    // already at the current schema_version (CI's validate:seeds gates it),
    // but a drift must degrade to a migration, never a broken page.
    if (!bundle) bundle = migrateBundle(structuredClone(loadBundle()));
    return bundle;
  };

  const requireProject = (projectId: string): ProjectBundle => {
    const current = ensure();
    if (current.project.id !== projectId) throw new Error(`Project ${projectId} not found`);
    return current;
  };

  /** The one write path — same shape as the local provider's `runOps`. */
  const runOps = (projectId: string, ops: MutationOp[]) => {
    const current = requireProject(projectId);
    const outcome = applyOps({ projectId, nodes: current.nodes, edges: current.edges }, ops);
    current.nodes = outcome.nodes;
    current.edges = outcome.edges;
    if (outcome.eventInputs.length > 0) {
      current.journal = [...(current.journal ?? []), ...toJournalEvents(outcome.eventInputs)];
    }
    return outcome;
  };

  const matchesProject = (projectId: string): boolean => ensure().project.id === projectId;

  return {
    async getProject(id) {
      return matchesProject(id) ? structuredClone(ensure()) : undefined;
    },

    async listProjects() {
      const current = ensure();
      return [
        {
          project: structuredClone(current.project),
          nodeCount: current.nodes.length,
          edgeCount: current.edges.length,
          hosted: false,
          seed: true,
        },
      ];
    },

    async saveProject(next) {
      requireProject(next.project.id);
      bundle = migrateBundle(structuredClone(next));
    },

    async archiveProject() {
      throw new Error("The public Arkaik map cannot be deleted — refresh the page to reset it instead.");
    },

    async getNodes(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().nodes) : [];
    },

    async getEdges(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().edges) : [];
    },

    async getJournal(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().journal ?? []) : [];
    },

    async createNode(node) {
      // Return the STORED node, cloned — never the caller's `node` object.
      // `applyOps` keeps that exact reference in `bundle.nodes` (the in-memory
      // array IS the store of record here, unlike the local provider's
      // IndexedDB-backed version of this same pattern), so handing it back
      // unclonned would let a caller mutate sandbox-internal state directly,
      // bypassing applyOps and the journal entirely.
      const { nodes } = runOps(node.project_id, [{ op: "create_node", node }]);
      return structuredClone(nodes.find((candidate: Node) => candidate.id === node.id)!);
    },

    async updateNode(projectId, id, patch) {
      const { nodes } = runOps(projectId, [{ op: "update_node", node_id: id, patch }]);
      return structuredClone(nodes.find((candidate: Node) => candidate.id === id)!);
    },

    async deleteNode(projectId, id) {
      runOps(projectId, [{ op: "delete_node", node_id: id }]);
    },

    async deleteNodes(projectId, ids) {
      if (ids.length === 0) return;
      runOps(projectId, [{ op: "delete_nodes", node_ids: ids }]);
    },

    async createEdge(edge) {
      const { edges } = runOps(edge.project_id, [{ op: "create_edge", edge }]);
      // applyOps normalizes the id to `e-{source}-{target}` — return the stored edge.
      return structuredClone(
        edges.find((candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id)!,
      );
    },

    async deleteEdge(projectId, id) {
      runOps(projectId, [{ op: "delete_edge", edge_id: id }]);
    },

    async applyMutations(projectId, ops) {
      const { nodes, edges } = runOps(projectId, ops);
      return structuredClone({ nodes, edges });
    },

    async exportProject(id) {
      requireProject(id);
      return structuredClone(ensure());
    },

    async importProject() {
      throw new Error("importProject is not supported on the seed provider");
    },
  };
}

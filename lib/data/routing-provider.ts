import type { MutationOp } from "@arkaik/schema";

import type { DataProvider, ProjectSummary } from "./data-provider";
import { isHostedProjectId } from "./remote-provider";
import type { Edge, JournalEvent, Node, Project, ProjectBundle } from "./types";

/**
 * Dispatches each call to the local or the hosted provider by project id, and
 * merges the two for the one operation that spans both — `listProjects()`.
 *
 * A user has both kinds of project at once: local-first ones in this browser and
 * hosted ones in their account. `getProvider()` returns a single provider, so
 * something has to decide per call which backend is meant. That decision is
 * possible *only* because `DataProvider` now carries `projectId` on every
 * mutator — before that, `updateNode(id, patch)` gave a router nothing to route
 * on, and the local provider papered over it by scanning all of IndexedDB.
 *
 * The routing rule is the id prefix (`prj_`), not a cache: hosted ids are minted
 * server-side in that namespace and `lib/utils/export.ts` refuses to give a
 * local project one. So routing is a total function of the id — nothing to
 * populate, invalidate, or get wrong when the network is down.
 */
export interface RoutingProviderOptions {
  local: DataProvider;
  remote: DataProvider;
  /**
   * Whether hosted projects are reachable — false when signed out or when
   * services are unconfigured. `listProjects()` then returns local projects
   * alone instead of failing the whole listing.
   *
   * May answer asynchronously, and in production does: the answer comes from
   * `/api/auth/status`, which is still in flight when the projects page mounts
   * and starts listing. Sampling a flag at that instant reads "no account" and
   * drops the hosted half of the list, so `listProjects()` awaits this.
   */
  isRemoteAvailable: () => boolean | Promise<boolean>;
}

export function createRoutingProvider(options: RoutingProviderOptions): DataProvider {
  const { local, remote, isRemoteAvailable } = options;

  /** The backend that owns this project. */
  const forProject = (projectId: string): DataProvider =>
    isHostedProjectId(projectId) ? remote : local;

  return {
    getProject: (id) => forProject(id).getProject(id),

    /**
     * The only method that spans both backends. A hosted-side failure (offline,
     * signed out mid-session) degrades to the local list rather than blanking
     * the page — losing sight of local projects because the network blinked
     * would be the worse failure.
     */
    async listProjects(): Promise<ProjectSummary[]> {
      const localProjects = await local.listProjects();
      if (!(await isRemoteAvailable())) return localProjects;

      try {
        const hosted = await remote.listProjects();
        return [...hosted, ...localProjects];
      } catch (err) {
        console.error("[routing-provider] hosted project listing failed:", err);
        return localProjects;
      }
    },

    saveProject: (bundle) => forProject(bundle.project.id).saveProject(bundle),
    archiveProject: (id) => forProject(id).archiveProject(id),

    getNodes: (projectId) => forProject(projectId).getNodes(projectId),
    getEdges: (projectId) => forProject(projectId).getEdges(projectId),
    getJournal: (projectId) => forProject(projectId).getJournal(projectId),

    createNode: (node: Node) => forProject(node.project_id).createNode(node),
    updateNode: (projectId, id, patch) => forProject(projectId).updateNode(projectId, id, patch),
    deleteNode: (projectId, id) => forProject(projectId).deleteNode(projectId, id),
    deleteNodes: (projectId, ids) => forProject(projectId).deleteNodes(projectId, ids),

    createEdge: (edge: Edge) => forProject(edge.project_id).createEdge(edge),
    deleteEdge: (projectId, id) => forProject(projectId).deleteEdge(projectId, id),

    applyMutations: (projectId: string, ops: MutationOp[]) =>
      forProject(projectId).applyMutations(projectId, ops),

    exportProject: (id) => forProject(id).exportProject(id),

    /**
     * Import always lands LOCALLY. "Where should this bundle live?" is a product
     * decision the user makes explicitly (via "Move to account"), not something
     * to infer from a dropped file — and importing locally is the behaviour that
     * still works signed out.
     */
    importProject: (bundle: ProjectBundle): Promise<Project> => local.importProject(bundle),
  } satisfies DataProvider as DataProvider;
}

/** Re-exported so callers need only this module to reason about routing. */
export { isHostedProjectId };
export type { Node, Edge, JournalEvent };

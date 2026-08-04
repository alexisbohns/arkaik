import type { MutationOp } from "@arkaik/schema";

import type { DataProvider, ProjectSummary } from "./data-provider";
import { isHostedProjectId } from "./remote-provider";
import { isSeedProjectId } from "./seed-project-id";
import type { Edge, JournalEvent, Node, Project, ProjectBundle } from "./types";

/**
 * Dispatches each call to the local, hosted, or seed provider by project id, and
 * merges the relevant ones for the one operation that spans all three —
 * `listProjects()`.
 *
 * A user has both kinds of project at once: local-first ones in this browser and
 * hosted ones in their account. `getProvider()` returns a single provider, so
 * something has to decide per call which backend is meant. That decision is
 * possible *only* because `DataProvider` now carries `projectId` on every
 * mutator — before that, `updateNode(id, patch)` gave a router nothing to route
 * on, and the local provider papered over it by scanning all of IndexedDB.
 *
 * The routing rule is the id namespace, not a cache: hosted ids are minted
 * server-side in the `prj_` prefix and `lib/utils/export.ts` refuses to give a
 * local project one; the single reserved seed id (self-map cycle 4) is guarded
 * the same way. So routing is a total function of the id — nothing to populate,
 * invalidate, or get wrong when the network is down.
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
  /**
   * The built-in public seed project's provider (self-map cycle 4). Optional so
   * a router without one behaves exactly as before; when present, the reserved
   * seed id routes here — checked BEFORE the hosted prefix — and
   * `listProjects()` leads with its summary unconditionally: the public project
   * must appear signed-out, offline, and before auth resolves.
   */
  seed?: DataProvider;
}

export function createRoutingProvider(options: RoutingProviderOptions): DataProvider {
  const { local, remote, seed, isRemoteAvailable } = options;

  /** The backend that owns this project. */
  const forProject = (projectId: string): DataProvider =>
    seed && isSeedProjectId(projectId) ? seed : isHostedProjectId(projectId) ? remote : local;

  return {
    getProject: (id) => forProject(id).getProject(id),

    /**
     * The only method that spans both backends. A hosted-side failure (offline,
     * signed out mid-session) degrades to the local list rather than blanking
     * the page — losing sight of local projects because the network blinked
     * would be the worse failure.
     */
    async listProjects(): Promise<ProjectSummary[]> {
      const seedProjects = seed ? await seed.listProjects() : [];
      const localProjects = await local.listProjects();
      if (!(await isRemoteAvailable())) return [...seedProjects, ...localProjects];

      try {
        const hosted = await remote.listProjects();
        return [...seedProjects, ...hosted, ...localProjects];
      } catch (err) {
        console.error("[routing-provider] hosted project listing failed:", err);
        return [...seedProjects, ...localProjects];
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
     * Imports still land LOCALLY. "Where should this bundle live?" is a product
     * decision the user makes explicitly (via "Move to account"), not something
     * to infer from a dropped file — and importing locally is the behaviour that
     * still works signed out. The one exception is a bundle carrying the
     * reserved seed id: that is not a user picking a destination, it is the raw
     * editor's save path for the public sandbox (`RawBundlePanel` pins the
     * bundle's id to the current project before calling `importProject`), and it
     * must replace the in-memory sandbox in place rather than squat the reserved
     * id in this browser's IndexedDB.
     */
    importProject: (bundle: ProjectBundle): Promise<Project> =>
      seed && isSeedProjectId(bundle.project.id) ? seed.importProject(bundle) : local.importProject(bundle),
  } satisfies DataProvider as DataProvider;
}

/** Re-exported so callers need only this module to reason about routing. */
export { isHostedProjectId };
export type { Node, Edge, JournalEvent };

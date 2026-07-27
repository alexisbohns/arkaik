import type { MutationOp } from "@arkaik/schema";

import type { DataProvider, ProjectSummary } from "./data-provider";
import type { Edge, JournalEvent, Node, Project, ProjectBundle } from "./types";

/**
 * `DataProvider` over the hosted graph API (app/api/graph/**).
 *
 * Every hook and UI component already reads through `getProvider()`, and the
 * interface now carries `projectId` on every mutator, so this is a drop-in
 * backend: nothing above the data layer changes to make a project server-backed.
 *
 * WRITES ALL GO THROUGH ONE ENDPOINT. `POST .../mutations` takes a batch of ops,
 * so the single-op methods below are just batches of one. That means a create,
 * an update and a delete share one code path, one validator gate, and one
 * atomicity guarantee — there is no second way to write, and therefore no way
 * for the two to drift.
 *
 * NO LOCAL CACHE, deliberately. A hosted project is online-only (the tradeoff
 * recorded in the plan): the alternative is a replay queue against a
 * validator-gated server, where a queued mutation can become invalid before it
 * is sent, which reintroduces exactly the conflict handling this architecture
 * was chosen to avoid. Local-first remains its own mode, fully intact.
 */

/** Server-owned project ids carry this prefix (lib/services/graph/store.ts). */
export const HOSTED_ID_PREFIX = "prj_";

/**
 * Whether an id names a hosted project.
 *
 * The prefix is the routing rule, not a heuristic: hosted ids are minted server
 * side as `prj_<random>` and the import path refuses to give a local project an
 * id in that namespace (see `lib/utils/export.ts`). So this is a total function
 * needing no lookup, no cache, and nothing that can go stale.
 */
export function isHostedProjectId(projectId: string): boolean {
  return projectId.startsWith(HOSTED_ID_PREFIX);
}

export interface RemoteProviderOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Defaults to same-origin. */
  baseUrl?: string;
}

/** An error carrying the server's structured body, so callers can render findings. */
export class RemoteProviderError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "RemoteProviderError";
    this.status = status;
    this.body = body;
  }
}

function messageFor(status: number, body: unknown): string {
  const b = body as { error?: string; message?: string; errors?: Array<{ message?: string }> } | null;
  if (b?.errors?.length) {
    // Surface the first pathed finding — the whole list is on `.body`.
    return b.errors.map((f) => f.message).filter(Boolean).join("; ") || "Validation failed.";
  }
  return b?.message ?? b?.error ?? `Request failed (${status}).`;
}

export function createRemoteProvider(options: RemoteProviderOptions = {}): DataProvider {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.baseUrl ?? "";

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${base}/api/graph${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new RemoteProviderError(res.status, body, messageFor(res.status, body));
    }
    return (await res.json()) as T;
  }

  /** The one write path — every mutator below is a batch of ops through here. */
  async function mutate(projectId: string, ops: MutationOp[]) {
    return request<{ version: string; nodes: Node[]; edges: Edge[] }>(
      `/projects/${encodeURIComponent(projectId)}/mutations`,
      { method: "POST", body: JSON.stringify({ ops }) },
    );
  }

  return {
    async getProject(id: string): Promise<ProjectBundle | undefined> {
      try {
        const { bundle } = await request<{ bundle: ProjectBundle }>(
          `/projects/${encodeURIComponent(id)}`,
        );
        return bundle;
      } catch (err) {
        // A missing project is `undefined`, matching the local provider — only
        // 404 though; a 401 or 500 must still surface as an error rather than
        // being mistaken for "no such project".
        if (err instanceof RemoteProviderError && err.status === 404) return undefined;
        throw err;
      }
    },

    async listProjects(): Promise<ProjectSummary[]> {
      const { projects } = await request<{
        projects: Array<{ id: string; title: string; nodeCount: number; edgeCount: number; createdAt: string; updatedAt: string }>;
      }>("/projects");
      return projects.map((p) => ({
        project: {
          id: p.id,
          title: p.title,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        } as Project,
        nodeCount: p.nodeCount,
        edgeCount: p.edgeCount,
        hosted: true,
      }));
    },

    async saveProject(bundle: ProjectBundle): Promise<void> {
      // Project-level fields only; the graph is edited through mutations.
      await request(`/projects/${encodeURIComponent(bundle.project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ project: bundle.project }),
      });
    },

    async archiveProject(id: string): Promise<void> {
      await request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async getNodes(projectId: string): Promise<Node[]> {
      const { nodes } = await request<{ nodes: Node[] }>(
        `/projects/${encodeURIComponent(projectId)}/nodes`,
      );
      return nodes;
    },

    async getEdges(projectId: string): Promise<Edge[]> {
      const { edges } = await request<{ edges: Edge[] }>(
        `/projects/${encodeURIComponent(projectId)}/edges`,
      );
      return edges;
    },

    async getJournal(projectId: string): Promise<JournalEvent[]> {
      const { journal } = await request<{ journal: JournalEvent[] }>(
        `/projects/${encodeURIComponent(projectId)}/journal`,
      );
      return journal;
    },

    async createNode(node: Node): Promise<Node> {
      const result = await mutate(node.project_id, [{ op: "create_node", node }]);
      return result.nodes.find((candidate) => candidate.id === node.id) ?? node;
    },

    async updateNode(projectId, id, patch): Promise<Node> {
      const result = await mutate(projectId, [{ op: "update_node", node_id: id, patch }]);
      const updated = result.nodes.find((candidate) => candidate.id === id);
      if (!updated) throw new Error(`Node ${id} not found`);
      return updated;
    },

    async deleteNode(projectId: string, id: string): Promise<void> {
      await mutate(projectId, [{ op: "delete_node", node_id: id }]);
    },

    async deleteNodes(projectId: string, ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await mutate(projectId, [{ op: "delete_nodes", node_ids: ids }]);
    },

    async createEdge(edge: Edge): Promise<Edge> {
      const result = await mutate(edge.project_id, [{ op: "create_edge", edge }]);
      // The server normalizes the id to `e-{source}-{target}`, so the stored
      // edge is the one to return — not the caller's input.
      const created = result.edges.find(
        (candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id,
      );
      return created ?? edge;
    },

    async deleteEdge(projectId: string, id: string): Promise<void> {
      await mutate(projectId, [{ op: "delete_edge", edge_id: id }]);
    },

    async applyMutations(projectId: string, ops: MutationOp[]) {
      const result = await mutate(projectId, ops);
      return { nodes: result.nodes, edges: result.edges };
    },

    async exportProject(id: string): Promise<ProjectBundle> {
      const { bundle } = await request<{ bundle: ProjectBundle }>(
        `/projects/${encodeURIComponent(id)}/export`,
      );
      return bundle;
    },

    async importProject(bundle: ProjectBundle): Promise<Project> {
      const { id } = await request<{ id: string }>("/projects", {
        method: "POST",
        body: JSON.stringify(bundle),
      });
      // The hosted project gets a server-owned id, so the returned project is
      // NOT the one that was sent — callers must navigate to the id from here.
      return { ...bundle.project, id };
    },
  };
}

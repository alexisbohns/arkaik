import type { DataProvider } from "./data-provider";
import type { Node, Edge, ProjectBundle } from "./types";
import { migrateBundle } from "./migrate";
import { applyOps, type MutationOp } from "@arkaik/schema";
import {
  appendJournalEvents,
  assembleBundle,
  getDb,
  splitBundle,
  type ProjectRecord,
} from "./db";
import { toJournalEvents } from "./emit-events";

/**
 * The app's `DataProvider`, backed by IndexedDB (Dexie — see `./db.ts`).
 *
 * It keeps the exact `DataProvider` method signatures (all async), so the hooks
 * and UI that import `localProvider` need no change: the export name is
 * preserved and simply repointed at the IndexedDB implementation. `localStorage`
 * is gone except for the one-time import in `./db.ts`.
 *
 * SSR / prerender: `getDb()` resolves to `null` off the browser, so every
 * **read** below no-ops to an empty result and never touches a browser API at
 * import time. **Mutations** run only from client event handlers / effects,
 * which never execute during Next's server render or prerender; off the browser
 * they throw the same "not found"-style errors the previous provider did (an
 * unreachable path at build time — `npm run build` prerenders clean).
 *
 * ## Journal emission (issue #218)
 * The app is a journal *writer*: every graph mutation dual-writes — it patches
 * the snapshot AND appends the matching event to the project's `journals` row
 * (via {@link appendJournalEvents}, in the *same* transaction so both commit
 * atomically). The event derivation is centralized here (not in hooks) through
 * the pure helpers in `./emit-events.ts`. No snapshot rewrite happens on the
 * append — the journal grows in its own row.
 *
 * **No-emit list** (deliberately emit nothing): `saveProject`, `archiveProject`,
 * and `importProject`. `saveProject` persists a whole re-read bundle (project-
 * field edits) with no clean per-field v1 mapping; `archiveProject` toggles a
 * timestamp with no v1 event; `importProject` already carries its own journal
 * (re-emitting would double-count). They still *preserve* an existing journal
 * row so history round-trips.
 *
 * ## Mutation notifications (issue #243)
 * A lightweight, dependency-free pub/sub — {@link subscribeToMutations} — is a
 * capability of *this module*, not a new `DataProvider` method, so other
 * providers (a future repo-bundle viewer, `docs/rfcs/arkaik-dev.md` Option
 * B.1) stay unburdened by a concern only the local provider has today. Synk's
 * `SyncManager` (`docs/spec/services.md` § Synk) is the first consumer: it
 * debounces a backup on each notification.
 *
 * Every mutation below that changes stored data (create/update/delete node,
 * create/delete edge, `importProject`, `saveProject`) calls
 * {@link notifyMutation} exactly once per affected project, and always AFTER
 * its `db.transaction(...)` has resolved successfully — never inside the
 * transaction, and never when the transaction throws (an uncaught rejection
 * propagates out of the method before the notify call is reached).
 * `archiveProject` is deliberately not wired to notifications, matching the
 * "no-emit" journal list above — it is not part of issue #243's acceptance
 * list either.
 */

function isArchived(record: ProjectRecord): boolean {
  return Boolean(record.snapshot.project.archived_at);
}

/** A single mutation notification: which project changed. */
export interface MutationEvent {
  projectId: string;
}

type MutationListener = (event: MutationEvent) => void;

const mutationListeners = new Set<MutationListener>();

/**
 * Subscribe to local-provider mutation notifications (issue #243) — see the
 * module doc above for exactly which methods fire and when. Returns an
 * unsubscribe function.
 */
export function subscribeToMutations(cb: MutationListener): () => void {
  mutationListeners.add(cb);
  return () => {
    mutationListeners.delete(cb);
  };
}

/** Notify subscribers that `projectId` changed. Called only after a
 * mutation's `db.transaction(...)` has resolved successfully. */
function notifyMutation(projectId: string): void {
  for (const listener of mutationListeners) {
    listener({ projectId });
  }
}

/**
 * The single write path: load the project, run `ops` through the shared
 * `applyOps`, and persist the resulting graph + derived events in ONE Dexie
 * transaction so snapshot and journal always commit together.
 *
 * Every graph mutation below funnels through here, which is what makes the
 * app's semantics identical to the MCP server's and the hosted store's — the
 * cycle guard, the composes synthesis, the edge-id normalization and the
 * cascade rules all live in `applyOps`, not in this file.
 *
 * This used to accept a locator that could find a project by scanning every
 * stored snapshot for a node or edge id, because `DataProvider` did not carry
 * the project on those mutators. It does now, so the scan is gone: a mutation
 * reads exactly one project row.
 *
 * `notifyMutation` fires exactly once, after the transaction resolves — never
 * inside it, and never when it throws (issue #243).
 */
async function runOps(projectId: string, ops: MutationOp[], notFoundMessage: string) {
  const db = await getDb();
  if (!db) throw new Error(notFoundMessage);

  let nextNodes: Node[] = [];
  let nextEdges: Edge[] = [];
  let changed = false;

  await db.transaction("rw", db.projects, db.journals, async () => {
    const record = await db.projects.get(projectId);
    if (!record) throw new Error(notFoundMessage);

    const outcome = applyOps(
      { projectId, nodes: record.snapshot.nodes, edges: record.snapshot.edges },
      ops,
    );

    record.snapshot.nodes = outcome.nodes;
    record.snapshot.edges = outcome.edges;
    nextNodes = outcome.nodes;
    nextEdges = outcome.edges;
    // `applyOps` derives no events when nothing actually changed — a patch that
    // sets a field to its current value, or a delete whose ids are not here.
    changed = outcome.eventInputs.length > 0;

    await db.projects.put(record);
    await appendJournalEvents(db, projectId, toJournalEvents(outcome.eventInputs));
  });

  // Notify only on a real change. A no-op mutation firing a notification would
  // wake the Synk backup engine to re-upload an identical bundle, and would make
  // "did anything happen?" unanswerable for any future subscriber.
  if (changed) notifyMutation(projectId);
  return { nodes: nextNodes, edges: nextEdges, projectId };
}

export const localProvider: DataProvider = {
  async getProject(id: string) {
    const db = await getDb();
    if (!db) return undefined;
    const record = await db.projects.get(id);
    if (!record) return undefined;
    const journalRow = await db.journals.get(id);
    return assembleBundle(record.snapshot, journalRow?.events);
  },

  /**
   * Summaries only — the journals table is no longer read here at all. Rendering
   * a list of titles never needed every project's full history.
   */
  async listProjects() {
    const db = await getDb();
    if (!db) return [];
    return (await db.projects.toArray())
      .filter((record) => !isArchived(record))
      .map((record) => ({
        project: record.snapshot.project,
        nodeCount: record.snapshot.nodes.length,
        edgeCount: record.snapshot.edges.length,
        hosted: false,
      }));
  },

  async saveProject(bundle: ProjectBundle) {
    const db = await getDb();
    if (!db) return;
    const { snapshot, journal } = splitBundle(migrateBundle(bundle));
    const projectId = snapshot.project.id;
    await db.transaction("rw", db.projects, db.journals, async () => {
      await db.projects.put({ id: projectId, snapshot });
      if (journal !== undefined) {
        await db.journals.put({ projectId, events: journal });
      } else {
        await db.journals.delete(projectId);
      }
    });
    notifyMutation(projectId);
  },

  async archiveProject(id: string) {
    const db = await getDb();
    if (!db) return;
    await db.transaction("rw", db.projects, async () => {
      const record = await db.projects.get(id);
      if (!record) throw new Error(`Project ${id} not found`);
      const now = new Date().toISOString();
      record.snapshot.project = {
        ...record.snapshot.project,
        archived_at: now,
        updated_at: now,
      };
      await db.projects.put(record);
    });
  },

  async getNodes(projectId: string) {
    const db = await getDb();
    if (!db) return [];
    const record = await db.projects.get(projectId);
    return record?.snapshot.nodes ?? [];
  },

  async getEdges(projectId: string) {
    const db = await getDb();
    if (!db) return [];
    const record = await db.projects.get(projectId);
    return record?.snapshot.edges ?? [];
  },

  async getJournal(projectId: string) {
    const db = await getDb();
    if (!db) return [];
    const row = await db.journals.get(projectId);
    return row?.events ?? [];
  },

  async createNode(node: Node) {
    await runOps(node.project_id, [{ op: "create_node", node }], `Project ${node.project_id} not found`);
    return node;
  },

  async updateNode(projectId: string, id: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const { nodes } = await runOps(
      projectId,
      [{ op: "update_node", node_id: id, patch }],
      `Node ${id} not found`,
    );
    return nodes.find((candidate) => candidate.id === id)!;
  },

  async deleteNode(projectId: string, id: string) {
    await runOps(projectId, [{ op: "delete_node", node_id: id }], `Node ${id} not found`);
  },

  async deleteNodes(projectId: string, ids: string[]) {
    if (ids.length === 0) return;
    await runOps(
      projectId,
      [{ op: "delete_nodes", node_ids: ids }],
      `Project ${projectId} not found`,
    );
  },

  async createEdge(edge: Edge) {
    const { edges } = await runOps(
      edge.project_id,
      [{ op: "create_edge", edge }],
      `Project ${edge.project_id} not found`,
    );
    // applyOps normalizes the id to the `e-{source}-{target}` convention, so the
    // stored edge is the one to return — not the caller's input.
    return edges.find((candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id)!;
  },

  async deleteEdge(projectId: string, id: string) {
    await runOps(projectId, [{ op: "delete_edge", edge_id: id }], `Edge ${id} not found`);
  },

  /**
   * Apply several ops as ONE atomic unit — the seam that lets a caller create a
   * node and its edge together instead of creating the node, creating the edge,
   * and hand-rolling a rollback when the second call fails.
   */
  async applyMutations(projectId: string, ops: MutationOp[]) {
    const { nodes, edges } = await runOps(projectId, ops, `Project ${projectId} not found`);
    return { nodes, edges };
  },

  async exportProject(id: string) {
    const db = await getDb();
    if (!db) throw new Error(`Project ${id} not found`);
    const record = await db.projects.get(id);
    if (!record) throw new Error(`Project ${id} not found`);
    const journalRow = await db.journals.get(id);
    return assembleBundle(record.snapshot, journalRow?.events);
  },

  async importProject(bundle: ProjectBundle) {
    const db = await getDb();
    const normalized = migrateBundle(bundle);
    const { snapshot, journal } = splitBundle(normalized);
    const projectId = snapshot.project.id;
    if (!db) return normalized.project;
    await db.transaction("rw", db.projects, db.journals, async () => {
      await db.projects.put({ id: projectId, snapshot });
      if (journal !== undefined) {
        await db.journals.put({ projectId, events: journal });
      } else {
        await db.journals.delete(projectId);
      }
    });
    notifyMutation(projectId);
    return normalized.project;
  },
};

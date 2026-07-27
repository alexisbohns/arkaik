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

/** How to find the project a mutation targets. */
type Locator =
  | { by: "project"; id: string }
  | { by: "node"; id: string }
  | { by: "edge"; id: string };

/**
 * The single write path: locate the project, run `ops` through the shared
 * `applyOps`, and persist the resulting graph + derived events in ONE Dexie
 * transaction so snapshot and journal always commit together.
 *
 * Every graph mutation below funnels through here, which is what makes the
 * app's semantics identical to the MCP server's and (next) the hosted store's —
 * the cycle guard, the composes synthesis, the edge-id normalization and the
 * cascade rules all live in `applyOps`, not in this file.
 *
 * `notifyMutation` fires exactly once, after the transaction resolves — never
 * inside it, and never when it throws (issue #243).
 */
async function runOps(locator: Locator, ops: MutationOp[], notFoundMessage: string) {
  const db = await getDb();
  if (!db) throw new Error(notFoundMessage);

  let nextNodes: Node[] = [];
  let nextEdges: Edge[] = [];
  let projectId = "";

  await db.transaction("rw", db.projects, db.journals, async () => {
    const record =
      locator.by === "project"
        ? await db.projects.get(locator.id)
        : (await db.projects.toArray()).find((candidate) =>
            locator.by === "node"
              ? candidate.snapshot.nodes.some((n) => n.id === locator.id)
              : candidate.snapshot.edges.some((e) => e.id === locator.id),
          );
    if (!record) throw new Error(notFoundMessage);

    projectId = record.snapshot.project.id;
    const outcome = applyOps(
      { projectId, nodes: record.snapshot.nodes, edges: record.snapshot.edges },
      ops,
    );

    record.snapshot.nodes = outcome.nodes;
    record.snapshot.edges = outcome.edges;
    nextNodes = outcome.nodes;
    nextEdges = outcome.edges;

    await db.projects.put(record);
    await appendJournalEvents(db, projectId, toJournalEvents(outcome.eventInputs));
  });

  notifyMutation(projectId);
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

  async listProjects() {
    const db = await getDb();
    if (!db) return [];
    const [records, journals] = await Promise.all([
      db.projects.toArray(),
      db.journals.toArray(),
    ]);
    const journalByProject = new Map(journals.map((row) => [row.projectId, row.events]));
    return records
      .filter((record) => !isArchived(record))
      .map((record) => assembleBundle(record.snapshot, journalByProject.get(record.id)));
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
    await runOps({ by: "project", id: node.project_id }, [{ op: "create_node", node }], `Project ${node.project_id} not found`);
    return node;
  },

  async updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const { nodes } = await runOps(
      { by: "node", id },
      [{ op: "update_node", node_id: id, patch }],
      `Node ${id} not found`,
    );
    return nodes.find((candidate) => candidate.id === id)!;
  },

  async deleteNode(id: string) {
    await runOps({ by: "node", id }, [{ op: "delete_node", node_id: id }], `Node ${id} not found`);
  },

  /**
   * Deleting across projects is the one mutation `runOps` cannot express: it
   * targets every project that happens to hold one of the ids, so it runs
   * `applyOps` once per affected project inside a single transaction, and fires
   * one notification per project rather than one per node (issue #243).
   */
  async deleteNodes(ids: string[]) {
    if (ids.length === 0) return;
    const db = await getDb();
    if (!db) return;
    const idSet = new Set(ids);
    const affectedProjectIds: string[] = [];

    await db.transaction("rw", db.projects, db.journals, async () => {
      for (const record of await db.projects.toArray()) {
        if (!record.snapshot.nodes.some((n) => idSet.has(n.id))) continue;
        const projectId = record.snapshot.project.id;
        const outcome = applyOps(
          { projectId, nodes: record.snapshot.nodes, edges: record.snapshot.edges },
          [{ op: "delete_nodes", node_ids: ids }],
        );
        record.snapshot.nodes = outcome.nodes;
        record.snapshot.edges = outcome.edges;
        await db.projects.put(record);
        await appendJournalEvents(db, projectId, toJournalEvents(outcome.eventInputs));
        affectedProjectIds.push(projectId);
      }
    });

    for (const projectId of affectedProjectIds) notifyMutation(projectId);
  },

  async createEdge(edge: Edge) {
    const { edges } = await runOps(
      { by: "project", id: edge.project_id },
      [{ op: "create_edge", edge }],
      `Project ${edge.project_id} not found`,
    );
    // applyOps normalizes the id to the `e-{source}-{target}` convention, so the
    // stored edge is the one to return — not the caller's input.
    return edges.find((candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id)!;
  },

  async deleteEdge(id: string) {
    await runOps({ by: "edge", id }, [{ op: "delete_edge", edge_id: id }], `Edge ${id} not found`);
  },

  /**
   * Apply several ops as ONE atomic unit — the seam that lets a caller create a
   * node and its edge together instead of creating the node, creating the edge,
   * and hand-rolling a rollback when the second call fails.
   */
  async applyMutations(projectId: string, ops: MutationOp[]) {
    const { nodes, edges } = await runOps({ by: "project", id: projectId }, ops, `Project ${projectId} not found`);
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

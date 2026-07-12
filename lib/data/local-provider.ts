import type { DataProvider } from "./data-provider";
import type { Node, Edge, ProjectBundle, PlaylistEntry } from "./types";
import { migrateBundle } from "./migrate";
import { edgeId } from "@arkaik/schema";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import {
  appendJournalEvents,
  assembleBundle,
  getDb,
  splitBundle,
  type ProjectRecord,
} from "./db";
import {
  diffNodeUpdate,
  edgeAddedInput,
  edgeRemovedInput,
  nodeCreatedInput,
  nodeDeletedInput,
  toJournalEvents,
} from "./emit-events";

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

function collectReferencedFlowIds(entries: PlaylistEntry[]): string[] {
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.type === "flow") {
      result.push(entry.flow_id);
      continue;
    }

    if (entry.type === "condition") {
      result.push(...collectReferencedFlowIds(entry.if_true));
      result.push(...collectReferencedFlowIds(entry.if_false));
      continue;
    }

    if (entry.type === "junction") {
      for (const playlistCase of entry.cases) {
        result.push(...collectReferencedFlowIds(playlistCase.entries));
      }
    }
  }

  return result;
}

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
    const db = await getDb();
    if (!db) throw new Error(`Project ${node.project_id} not found`);
    await db.transaction("rw", db.projects, db.journals, async () => {
      const record = await db.projects.get(node.project_id);
      if (!record) throw new Error(`Project ${node.project_id} not found`);
      record.snapshot.nodes.push(node);
      await db.projects.put(record);
      await appendJournalEvents(db, node.project_id, toJournalEvents([nodeCreatedInput(node)]));
    });
    notifyMutation(node.project_id);
    return node;
  },

  async updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const db = await getDb();
    if (!db) throw new Error(`Node ${id} not found`);
    let updated: Node | undefined;
    let projectId: string | undefined;
    await db.transaction("rw", db.projects, db.journals, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.nodes.some((n) => n.id === id));
      if (!record) throw new Error(`Node ${id} not found`);
      projectId = record.snapshot.project.id;

      const nodes = record.snapshot.nodes;
      const idx = nodes.findIndex((n) => n.id === id);
      const current = nodes[idx];
      const nextNode = { ...current, ...patch };

      if (nextNode.species === "flow") {
        const entries = nextNode.metadata?.playlist?.entries;
        if (Array.isArray(entries)) {
          const nextNodes = [...nodes];
          nextNodes[idx] = nextNode;
          const candidateFlowIds = collectReferencedFlowIds(entries);

          for (const candidateFlowId of candidateFlowIds) {
            if (wouldCreateCycle(nextNode.id, candidateFlowId, nextNodes)) {
              throw new Error(`Cannot add Flow ${candidateFlowId}: it would create a circular reference.`);
            }
          }
        }
      }

      // Diff the patch against the pre-update node (per-key for metadata) and
      // append the derived event(s). Computed only after the cycle validation
      // above, so a rejected update never emits.
      const events = toJournalEvents(diffNodeUpdate(current, patch));

      nodes[idx] = nextNode;
      updated = nextNode;
      await db.projects.put(record);
      await appendJournalEvents(db, record.snapshot.project.id, events);
    });
    notifyMutation(projectId!);
    return updated!;
  },

  async deleteNode(id: string) {
    const db = await getDb();
    if (!db) throw new Error(`Node ${id} not found`);
    let projectId: string | undefined;
    await db.transaction("rw", db.projects, db.journals, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.nodes.some((n) => n.id === id));
      if (!record) throw new Error(`Node ${id} not found`);
      projectId = record.snapshot.project.id;
      record.snapshot.nodes = record.snapshot.nodes.filter((n) => n.id !== id);
      // Cascade-remove attached edges. The journal's node.deleted IMPLIES this
      // cascade, so we do NOT emit edge.removed for them (docs/spec/journal.md:71).
      record.snapshot.edges = record.snapshot.edges.filter(
        (e) => e.source_id !== id && e.target_id !== id,
      );
      await db.projects.put(record);
      await appendJournalEvents(db, record.snapshot.project.id, toJournalEvents([nodeDeletedInput(id)]));
    });
    notifyMutation(projectId!);
  },

  async deleteNodes(ids: string[]) {
    if (ids.length === 0) return;
    const db = await getDb();
    if (!db) return;
    const idSet = new Set(ids);
    // One notification per affected project, not one per node (issue #243) —
    // collected during the transaction, fired after it commits.
    const affectedProjectIds: string[] = [];
    await db.transaction("rw", db.projects, db.journals, async () => {
      const records = await db.projects.toArray();
      for (const record of records) {
        // Only ids actually present in this project's snapshot are deleted (and
        // emitted), so a node.deleted never references a node that never existed.
        const deletedIds = record.snapshot.nodes.filter((n) => idSet.has(n.id)).map((n) => n.id);
        if (deletedIds.length === 0) continue;
        record.snapshot.nodes = record.snapshot.nodes.filter((n) => !idSet.has(n.id));
        // Cascade-remove edges without emitting edge.removed (docs/spec/journal.md:71).
        record.snapshot.edges = record.snapshot.edges.filter(
          (e) => !idSet.has(e.source_id) && !idSet.has(e.target_id),
        );
        await db.projects.put(record);
        await appendJournalEvents(
          db,
          record.snapshot.project.id,
          toJournalEvents(deletedIds.map(nodeDeletedInput)),
        );
        affectedProjectIds.push(record.snapshot.project.id);
      }
    });
    for (const projectId of affectedProjectIds) {
      notifyMutation(projectId);
    }
  },

  async createEdge(edge: Edge) {
    const db = await getDb();
    if (!db) throw new Error(`Project ${edge.project_id} not found`);
    // Enforce the `e-{source}-{target}` convention at the seam so any edge
    // creation — including a repoint expressed as delete + create — stays
    // conformant regardless of the id the caller supplied (issue #215,
    // docs/spec/bundle-format.md § Identifier Conventions).
    const normalized: Edge = { ...edge, id: edgeId(edge.source_id, edge.target_id) };
    await db.transaction("rw", db.projects, db.journals, async () => {
      const record = await db.projects.get(normalized.project_id);
      if (!record) throw new Error(`Project ${normalized.project_id} not found`);
      record.snapshot.edges.push(normalized);
      await db.projects.put(record);
      await appendJournalEvents(db, normalized.project_id, toJournalEvents([edgeAddedInput(normalized)]));
    });
    notifyMutation(normalized.project_id);
    return normalized;
  },

  async deleteEdge(id: string) {
    const db = await getDb();
    if (!db) throw new Error(`Edge ${id} not found`);
    let projectId: string | undefined;
    await db.transaction("rw", db.projects, db.journals, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.edges.some((e) => e.id === id));
      if (!record) throw new Error(`Edge ${id} not found`);
      projectId = record.snapshot.project.id;
      record.snapshot.edges = record.snapshot.edges.filter((e) => e.id !== id);
      await db.projects.put(record);
      await appendJournalEvents(db, record.snapshot.project.id, toJournalEvents([edgeRemovedInput(id)]));
    });
    notifyMutation(projectId!);
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

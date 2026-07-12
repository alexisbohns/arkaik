import type { DataProvider } from "./data-provider";
import type { Node, Edge, ProjectBundle, PlaylistEntry } from "./types";
import { migrateBundle } from "./migrate";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import {
  assembleBundle,
  getDb,
  splitBundle,
  type ProjectRecord,
} from "./db";

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
    await db.transaction("rw", db.projects, async () => {
      const record = await db.projects.get(node.project_id);
      if (!record) throw new Error(`Project ${node.project_id} not found`);
      record.snapshot.nodes.push(node);
      await db.projects.put(record);
    });
    return node;
  },

  async updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const db = await getDb();
    if (!db) throw new Error(`Node ${id} not found`);
    let updated: Node | undefined;
    await db.transaction("rw", db.projects, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.nodes.some((n) => n.id === id));
      if (!record) throw new Error(`Node ${id} not found`);

      const nodes = record.snapshot.nodes;
      const idx = nodes.findIndex((n) => n.id === id);
      const nextNode = { ...nodes[idx], ...patch };

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

      nodes[idx] = nextNode;
      updated = nextNode;
      await db.projects.put(record);
    });
    return updated!;
  },

  async deleteNode(id: string) {
    const db = await getDb();
    if (!db) throw new Error(`Node ${id} not found`);
    await db.transaction("rw", db.projects, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.nodes.some((n) => n.id === id));
      if (!record) throw new Error(`Node ${id} not found`);
      record.snapshot.nodes = record.snapshot.nodes.filter((n) => n.id !== id);
      record.snapshot.edges = record.snapshot.edges.filter(
        (e) => e.source_id !== id && e.target_id !== id,
      );
      await db.projects.put(record);
    });
  },

  async deleteNodes(ids: string[]) {
    if (ids.length === 0) return;
    const db = await getDb();
    if (!db) return;
    const idSet = new Set(ids);
    await db.transaction("rw", db.projects, async () => {
      const records = await db.projects.toArray();
      for (const record of records) {
        const hasAffected = record.snapshot.nodes.some((n) => idSet.has(n.id));
        if (!hasAffected) continue;
        record.snapshot.nodes = record.snapshot.nodes.filter((n) => !idSet.has(n.id));
        record.snapshot.edges = record.snapshot.edges.filter(
          (e) => !idSet.has(e.source_id) && !idSet.has(e.target_id),
        );
        await db.projects.put(record);
      }
    });
  },

  async createEdge(edge: Edge) {
    const db = await getDb();
    if (!db) throw new Error(`Project ${edge.project_id} not found`);
    await db.transaction("rw", db.projects, async () => {
      const record = await db.projects.get(edge.project_id);
      if (!record) throw new Error(`Project ${edge.project_id} not found`);
      record.snapshot.edges.push(edge);
      await db.projects.put(record);
    });
    return edge;
  },

  async deleteEdge(id: string) {
    const db = await getDb();
    if (!db) throw new Error(`Edge ${id} not found`);
    await db.transaction("rw", db.projects, async () => {
      const records = await db.projects.toArray();
      const record = records.find((r) => r.snapshot.edges.some((e) => e.id === id));
      if (!record) throw new Error(`Edge ${id} not found`);
      record.snapshot.edges = record.snapshot.edges.filter((e) => e.id !== id);
      await db.projects.put(record);
    });
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
    return normalized.project;
  },
};

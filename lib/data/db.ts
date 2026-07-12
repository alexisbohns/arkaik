import Dexie, { type Table } from "dexie";
import type { JournalEvent, ProjectBundle } from "./types";
import { migrateBundle } from "./migrate";

/**
 * IndexedDB storage layer (Dexie) for the local `DataProvider`.
 *
 * Why Dexie / IndexedDB instead of the previous `localStorage` whole-store
 * rewrite: `localStorage` persisted the *entire* store as one JSON string, so
 * every mutation — even editing one node in project A — re-serialized every
 * project. IndexedDB gives us row-level, per-project writes.
 *
 * ## Tables
 * - `projects`  — one row per project, keyed by `id` (= `project.id`). The row
 *   holds a {@link BundleSnapshot}: the full {@link ProjectBundle} *minus* its
 *   `journal`. A mutation to project A writes only project A's row, never
 *   touching project B (the core win over the old backend).
 * - `journals`  — one row per project, keyed by `projectId`, holding the
 *   embedded journal events. The journal lives in its *own* row so a future
 *   app-side journal append (#218) can rewrite just the journal, not the graph
 *   snapshot. It is read-only here; nothing in this issue writes journal events
 *   beyond mirroring what save/import already carried.
 * - `meta`      — small key/value table for provider bookkeeping (currently
 *   just the one-time legacy-migration flag).
 *
 * ## SSR / prerender safety
 * IndexedDB is browser-only. The Dexie instance is created **lazily** inside
 * {@link getDb} and only when a real `indexedDB` exists, so importing this
 * module (or the provider) during Next's server render / prerender touches no
 * browser API. On the server {@link getDb} resolves to `null` and every
 * provider read no-ops to an empty result.
 */

/** The `arkaik:store` payload written by the previous localStorage backend. */
export const LEGACY_STORAGE_KEY = "arkaik:store";

/** A {@link ProjectBundle} without its `journal` — the graph snapshot we store per project. */
export type BundleSnapshot = Omit<ProjectBundle, "journal">;

export interface ProjectRecord {
  /** Equal to `snapshot.project.id`. */
  id: string;
  snapshot: BundleSnapshot;
}

export interface JournalRecord {
  projectId: string;
  events: JournalEvent[];
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

const DB_NAME = "arkaik";
const LEGACY_MIGRATION_FLAG = "legacyLocalStorageMigrated";

class ArkaikDB extends Dexie {
  projects!: Table<ProjectRecord, string>;
  journals!: Table<JournalRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      projects: "id",
      journals: "projectId",
      meta: "key",
    });
  }
}

/** Split a bundle into the stored snapshot (no journal) and its journal events. */
export function splitBundle(bundle: ProjectBundle): {
  snapshot: BundleSnapshot;
  journal: JournalEvent[] | undefined;
} {
  const { journal, ...snapshot } = bundle;
  return { snapshot, journal };
}

/** Reassemble a stored snapshot with its journal events, preserving the
 * "no journal key at all" vs "empty journal array" distinction (fidelity for
 * export / round-trip): `journal` is only re-attached when a journal row
 * existed for this project. */
export function assembleBundle(
  snapshot: BundleSnapshot,
  events: JournalEvent[] | undefined,
): ProjectBundle {
  return events !== undefined ? { ...snapshot, journal: events } : snapshot;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let readyPromise: Promise<ArkaikDB | null> | null = null;

async function openDb(): Promise<ArkaikDB | null> {
  if (!isBrowser()) return null;
  const db = new ArkaikDB();
  await db.open();
  // A migration failure must never lock the DB out, so it swallows its own
  // errors and leaves the legacy payload intact for a later retry.
  await migrateLegacyLocalStorage(db);
  return db;
}

/**
 * Shared readiness gate. Resolves to the open {@link ArkaikDB} in the browser,
 * or `null` during SSR / prerender. Memoized so the DB opens (and the one-time
 * legacy migration runs) at most once per page. On an open failure the promise
 * is reset so a later call can retry.
 */
export function getDb(): Promise<ArkaikDB | null> {
  if (!isBrowser()) return Promise.resolve(null);
  if (!readyPromise) {
    readyPromise = openDb().catch((err) => {
      console.error("[LocalProvider] Failed to open IndexedDB:", err);
      readyPromise = null;
      return null;
    });
  }
  return readyPromise;
}

/**
 * One-time data migration: import the legacy `arkaik:store` localStorage
 * payload into Dexie on first load, running {@link migrateBundle} per bundle
 * (older bundles upgrade). Idempotent via a `meta` flag.
 *
 * Failure handling / data safety:
 * - The legacy localStorage payload is **kept, not cleared** — it is a passive
 *   backup. If IndexedDB is later wiped, the `meta` flag goes with it and this
 *   migration re-runs from the still-present localStorage.
 * - The bulk import and the flag write share one transaction, so a partial
 *   import can never leave the flag set. Any error is swallowed (logged) with
 *   the flag unset, so the next load retries — no data loss either way.
 */
async function migrateLegacyLocalStorage(db: ArkaikDB): Promise<void> {
  try {
    const done = await db.meta.get(LEGACY_MIGRATION_FLAG);
    if (done?.value) return;

    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    if (!raw) {
      // Nothing to migrate — record that so we don't re-read the key forever.
      await db.meta.put({ key: LEGACY_MIGRATION_FLAG, value: true });
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, ProjectBundle>;
    const projectRecords: ProjectRecord[] = [];
    const journalRecords: JournalRecord[] = [];

    for (const rawBundle of Object.values(parsed)) {
      const { snapshot, journal } = splitBundle(migrateBundle(rawBundle));
      projectRecords.push({ id: snapshot.project.id, snapshot });
      if (journal !== undefined) {
        journalRecords.push({ projectId: snapshot.project.id, events: journal });
      }
    }

    await db.transaction("rw", db.projects, db.journals, db.meta, async () => {
      if (projectRecords.length > 0) await db.projects.bulkPut(projectRecords);
      if (journalRecords.length > 0) await db.journals.bulkPut(journalRecords);
      await db.meta.put({ key: LEGACY_MIGRATION_FLAG, value: true });
    });
  } catch (err) {
    // Leave the flag unset and localStorage untouched: retry on the next load.
    console.error("[LocalProvider] Legacy localStorage migration failed (will retry):", err);
  }
}

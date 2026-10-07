import Dexie, { type Table } from "dexie";
import type { AsyncStorage, PersistedQuery } from "@tanstack/query-persist-client-core";

/**
 * The persisted query cache's own IndexedDB database (`lib/data/query-persistence.ts`).
 *
 * SEPARATE from `arkaik` (lib/data/db.ts) on purpose: bumping that database's
 * version closes every other open tab and puts each read behind its
 * open-time migration sweeps, and a cache is not worth either. This one holds
 * one row per kept query and nothing else; losing it costs one network read.
 */
interface CacheRow {
  key: string;
  value: PersistedQuery;
}

class QueryCacheDB extends Dexie {
  rows!: Table<CacheRow, string>;

  constructor() {
    super("arkaik-query-cache");
    this.version(1).stores({ rows: "key" });
  }
}

/** IndexedDB storage for the persister, or `null` where there is none (the server, private modes that refuse it). */
export function openQueryCacheStorage(): AsyncStorage<PersistedQuery> | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
  const db = new QueryCacheDB();
  return {
    getItem: async (key) => (await db.rows.get(key))?.value,
    setItem: (key, value) => db.rows.put({ key, value }),
    removeItem: async (key) => {
      await db.rows.delete(key);
    },
    entries: async () => (await db.rows.toArray()).map((row) => [row.key, row.value] as [string, PersistedQuery]),
  };
}

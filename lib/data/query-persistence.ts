import {
  experimental_createQueryPersister,
  type AsyncStorage,
  type PersistedQuery,
} from "@tanstack/query-persist-client-core";
import type { Query, QueryClient, QueryFunctionContext, QueryKey } from "@tanstack/query-core";

import { CURRENT_SCHEMA_VERSION } from "./migrate";
import { isHostedProjectId } from "./remote-provider";

/**
 * Hosted projects, kept across visits (#429; the design recorded in
 * docs/superpowers/plans/2026-09-10-reactive-data-layer.md § "Deferred:
 * persistence").
 *
 * The in-memory cache already removes the in-session cost. What it cannot do is
 * paint a hosted project on a RETURN visit before the network answers. This
 * module gives each hosted read its own row in IndexedDB — TanStack's
 * per-query persister (`experimental_createQueryPersister`), not the blob
 * persister the review rejected for its whole-cache `JSON.stringify` on every
 * cache event and for gating every query behind one restore. A query restores
 * lazily, inside its own fetch, and nothing else waits for it.
 *
 * What is kept, and for whom:
 *  - Only `["project", <hosted id>, "bundle" | "journal" | "journal-stats", …]`.
 *    Local projects already live in IndexedDB; the seed's contract is that a
 *    refresh is the reset; the listing is cheap; and History's pages are an
 *    INFINITE query, which the per-query persister would restore as a single
 *    page.
 *  - Per account: the buster is the schema version AND the signed-in user's id
 *    (`whenHostedAccountKnown`), so a second account on this browser never
 *    paints the first one's projects, and a bundle-shape change never restores
 *    an old shape. Nothing is kept for an unnamed or signed-out session.
 *    Sign-out clears every row (`clearPersistedQueries`).
 *
 * What a restored entry promises — nothing, until the server confirms it:
 *  - `refetchOnRestore: "always"`: the first mount revalidates whatever
 *    `staleTime` says. Inside the 30 s window the default would skip that, and
 *    "reload to see what the agent did" would silently stop working. The
 *    revalidation is conditional on the restored entry's own ETag, so a quiet
 *    project costs one 304.
 *  - The entry carries `restored: true` until a read confirms it (the
 *    queryFns strip it). A surface about to plan something destructive
 *    against the data — `ProductManagerPanel` — waits for that.
 *
 * Writes are skipped when nothing changed: a 304 hands back the SAME entry
 * object, and re-writing a multi-megabyte bundle every polling minute to say
 * so would be the cost the blob persister was rejected for.
 */

/** Which hosted reads are kept. */
const PERSISTED_KINDS: ReadonlySet<unknown> = new Set(["bundle", "journal", "journal-stats"]);

export function isPersistedQueryKey(key: QueryKey): boolean {
  return (
    key[0] === "project" &&
    typeof key[1] === "string" &&
    isHostedProjectId(key[1]) &&
    PERSISTED_KINDS.has(key[2])
  );
}

/** A week: long enough that tomorrow's visit paints, short enough to stay small. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Every row's key starts with this (`<prefix>-<queryHash>`). */
const STORAGE_PREFIX = "arkaik-query";

export interface QueryPersistenceOptions {
  /** Where rows live; `null` (the server, a browser without IndexedDB) keeps nothing. */
  storage: AsyncStorage<PersistedQuery> | null;
  /** The signed-in account's id once known, `null` for none. */
  accountKnown: () => Promise<string | null>;
  maxAgeMs?: number;
}

/** Marks a restored entry; the queryFns strip it once the server confirms. */
function markRestored(data: unknown): unknown {
  return data !== null && typeof data === "object" ? { ...(data as object), restored: true } : data;
}

type Persister = <T>(
  queryFn: (context: QueryFunctionContext) => T | Promise<T>,
  context: QueryFunctionContext,
  query: Query,
) => Promise<T>;

/**
 * The `persister` query option, for every query: it passes anything it does
 * not keep straight to the queryFn, and hands the rest to an account-scoped
 * TanStack persister.
 */
export function createHostedQueryPersister(options: QueryPersistenceOptions): {
  persister: Persister;
  /** Drops expired and busted rows. */
  gc: () => Promise<void>;
} {
  const { storage, accountKnown, maxAgeMs = DEFAULT_MAX_AGE_MS } = options;

  // The data object each row was last written with. A 304 returns the same
  // object, so an identical reference means there is nothing new to write.
  const written = new Map<string, unknown>();
  const dedupedStorage: AsyncStorage<PersistedQuery> | null = storage && {
    getItem: (key) => storage.getItem(key),
    async setItem(key, value) {
      if (written.get(key) === value.state.data) return;
      written.set(key, value.state.data);
      await storage.setItem(key, value);
    },
    async removeItem(key) {
      written.delete(key);
      await storage.removeItem(key);
    },
    ...(storage.entries ? { entries: () => storage.entries!() } : {}),
  };

  const byAccount = new Map<string, ReturnType<typeof experimental_createQueryPersister<PersistedQuery>>>();
  function forAccount(account: string) {
    let persister = byAccount.get(account);
    if (!persister) {
      persister = experimental_createQueryPersister<PersistedQuery>({
        storage: dedupedStorage,
        buster: `${CURRENT_SCHEMA_VERSION}:${account}`,
        maxAge: maxAgeMs,
        prefix: STORAGE_PREFIX,
        refetchOnRestore: "always",
        // IndexedDB stores structured clones; no JSON round trip.
        serialize: (persisted) => persisted,
        deserialize: (stored) => ({ ...stored, state: { ...stored.state, data: markRestored(stored.state.data) } }),
      });
      byAccount.set(account, persister);
    }
    return persister;
  }

  const persister: Persister = async (queryFn, context, query) => {
    if (!dedupedStorage || !isPersistedQueryKey(query.queryKey)) return queryFn(context);
    const account = await accountKnown();
    if (!account) return queryFn(context);
    return forAccount(account).persisterFn(queryFn, context, query) as Promise<Awaited<ReturnType<typeof queryFn>>>;
  };

  /**
   * Prunes for the known account only. "No account" here may just mean the
   * status was slow to answer (the gate times out), and sweeping on that
   * would wipe a signed-in user's cache on a bad connection. Another
   * account's rows are dropped when read (their buster does not match), and
   * sign-out clears everything.
   */
  async function gc() {
    const account = await accountKnown();
    if (account) await forAccount(account).persisterGc();
  }

  return { persister, gc };
}

let installed: QueryPersistenceOptions | null = null;

/**
 * Puts the persister on a client's default query options — once, before any
 * hook has created a query (`QueryProvider` calls it on mount) — and sweeps
 * expired and busted rows in the background.
 */
export function installQueryPersistence(client: QueryClient, options: QueryPersistenceOptions): void {
  if (installed) return;
  installed = options;
  const { persister, gc } = createHostedQueryPersister(options);
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, persister },
  });
  void gc().catch((err: unknown) => console.error("[query-persistence] sweep failed:", err));
}

/** Forgets every kept row — on sign-out, so the next account starts clean. */
export async function clearPersistedQueries(): Promise<void> {
  const storage = installed?.storage;
  if (!storage?.entries) return;
  for (const [key] of await storage.entries()) {
    if (key.startsWith(`${STORAGE_PREFIX}-`)) await storage.removeItem(key);
  }
}

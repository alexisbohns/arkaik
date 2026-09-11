import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";

import type { DataProvider, MutationResult, ProjectSummary, ReadResult } from "@/lib/data/data-provider";
import { subscribeToMutations } from "@/lib/data/local-provider";
import { getProvider } from "@/lib/data/provider-registry";
import { getQueryClient } from "@/lib/data/query-client";
import { isHostedProjectId } from "@/lib/data/remote-provider";
import type { Edge, JournalEvent, Node, ProjectBundle } from "@/lib/data/types";

/**
 * The query layer between the data hooks and `getProvider()` — React-free
 * (docs/superpowers/plans/2026-09-10-reactive-data-layer.md § D3–D5).
 *
 * Every project surface used to run its own `getProject`/`getNodes`/
 * `getEdges`/`getJournal` on mount, so one navigation cost up to six provider
 * reads of the same project. Now there is ONE bundle entry per project that
 * `useProject`, `useNodes` and `useEdges` all observe (the last two through
 * hoisted `select`s), one journal entry per projection, and one projects list.
 *
 * This module is the cache's ONLY writer. It owns the keys, the entry shapes,
 * the selectors, the pure reducers a write-back applies, the cache operations
 * the hooks call after a mutation, and the invalidation seams for the few
 * writers that bypass the hooks. Components never touch the client directly:
 * the hooks are the binding layer, and everything else goes through a seam.
 */

// --- Keys ------------------------------------------------------------------

export const projectsKey = () => ["projects"] as const;
export const projectKey = (projectId: string) => ["project", projectId] as const;
export const bundleKey = (projectId: string) => ["project", projectId, "bundle"] as const;
export const journalKey = (projectId: string, types: readonly string[] | null) =>
  ["project", projectId, "journal", { types: normalizeJournalTypes(types) }] as const;

/**
 * `["project", id, "journal"]` without the trailing types — the prefix that
 * matches every cached projection of a project's journal at once.
 */
const journalPrefix = (projectId: string) => [...projectKey(projectId), "journal"] as const;

/**
 * The journal key carries its projection sorted and deduped, so two callers
 * asking for the same events in a different order share one entry. `null`
 * is the whole journal.
 */
export function normalizeJournalTypes(types: readonly string[] | null): string[] | null {
  if (types === null) return null;
  return [...new Set(types)].sort();
}

// --- Entry shapes ----------------------------------------------------------

/**
 * What the bundle entry holds. `null` in the cache means "not found" — query
 * data cannot be `undefined`, and a missing project must still resolve so the
 * surface stops loading. `version` is the server's strong version, used to
 * refuse a write-back that belongs to an older request; `etag` is the read
 * validator the next refetch sends as `If-None-Match` (`null` for a backend
 * without one, and after every write-back — the entry no longer matches any
 * server ETag).
 */
export interface BundleEntry {
  bundle: ProjectBundle;
  version: string | null;
  etag: string | null;
}

export interface JournalEntry {
  events: JournalEvent[];
  etag: string | null;
}

// --- Conditional reads ---------------------------------------------------------

/**
 * A project read through the provider's conditional method. The routing
 * provider — what `getProvider()` answers in the app — always has one, and
 * owns the fallback for its local and seed backends. The wrap here is for a
 * BARE provider installed through `setProvider` (a test fake, the read-only
 * repo-bundle viewer): the optional method is absent, and the plain read is
 * an unconditional `fresh` answer with no validator.
 *
 * Exported for `useProject`'s pre-save read, which must not go through the
 * cache (see there) but should still be conditional on a hosted project.
 */
export async function readProjectBundle(
  provider: DataProvider,
  projectId: string,
  options: { etag: string | null; signal?: AbortSignal },
): Promise<ReadResult<ProjectBundle>> {
  if (provider.readProject) return provider.readProject(projectId, options);
  const bundle = await provider.getProject(projectId);
  return bundle === undefined ? { status: "missing" } : { status: "fresh", value: bundle, etag: null };
}

async function readProjectJournal(
  provider: DataProvider,
  projectId: string,
  options: { etag: string | null; types: readonly string[] | null; signal?: AbortSignal },
): Promise<ReadResult<JournalEvent[]>> {
  if (provider.readJournal) return provider.readJournal(projectId, options);
  return { status: "fresh", value: await provider.getJournal(projectId), etag: null };
}

// --- Query descriptors -------------------------------------------------------

/**
 * Hosted projects are written server-side while a tab is open — by agents,
 * the CLI, the GitHub App — and the remote provider has no mutation bus to
 * hear about it. So they poll, one conditional GET a minute that the server
 * answers with a bodiless 304 while nothing moved, and only while the tab is
 * visible. Local and seed projects have a bus (or no writers but this tab)
 * and never poll.
 */
function pollingFor(projectId: string): { refetchInterval: number | false; refetchIntervalInBackground: boolean } {
  return { refetchInterval: isHostedProjectId(projectId) ? 60_000 : false, refetchIntervalInBackground: false };
}

/**
 * No `enabled` gate on any of these: `useProjectId()` falls back to `""`, and
 * an empty id must resolve to a not-found entry with `loading: false`, exactly
 * as `getProject("")` did in the hooks before the cache.
 *
 * The read is conditional on the entry already cached: its `etag` travels as
 * `If-None-Match`, and a `not-modified` answer returns THAT SAME ENTRY — same
 * reference, so structural sharing short-circuits and nothing downstream
 * renders. `signal` is TanStack's, so a `cancelQueries` (every write-back
 * starts with one) actually tears the request down rather than letting a
 * stale body arrive and be ignored.
 */
export function bundleQueryOptions(projectId: string) {
  return {
    queryKey: bundleKey(projectId),
    queryFn: async ({ client, signal }: QueryFunctionContext): Promise<BundleEntry | null> => {
      const provider = getProvider();
      const previous = client.getQueryData<BundleEntry | null>(bundleKey(projectId));
      let read = await readProjectBundle(provider, projectId, { etag: previous?.etag ?? null, signal });
      if (read.status === "not-modified") {
        if (previous) return previous;
        // A 304 with nothing to fall back on should not happen (no entry, no
        // etag sent) — but a server that answered one anyway must not leave
        // the query without data. Read again, unconditionally.
        read = await readProjectBundle(provider, projectId, { etag: null, signal });
      }
      if (read.status !== "fresh") return null;
      return { bundle: read.value, version: read.version ?? null, etag: read.etag };
    },
    ...pollingFor(projectId),
  };
}

/**
 * The same conditional read for a journal projection. `types` is in the key
 * and handed to the provider, but the providers still return the whole
 * journal (Part 2c wires the `?types=` read); the callers and the event
 * append already speak the final shape. A missing project is a `null` entry,
 * like the bundle's.
 */
export function journalQueryOptions(projectId: string, types: readonly string[] | null) {
  const key = journalKey(projectId, types);
  return {
    queryKey: key,
    queryFn: async ({ client, signal }: QueryFunctionContext): Promise<JournalEntry | null> => {
      const provider = getProvider();
      const previous = client.getQueryData<JournalEntry | null>(key);
      const options = { types: key[3].types, signal };
      let read = await readProjectJournal(provider, projectId, { ...options, etag: previous?.etag ?? null });
      if (read.status === "not-modified") {
        if (previous) return previous;
        read = await readProjectJournal(provider, projectId, { ...options, etag: null });
      }
      if (read.status !== "fresh") return null;
      return { events: read.value, etag: read.etag };
    },
    ...pollingFor(projectId),
  };
}

/**
 * The listing is mounted in the persistent shell, so it is fresh for a full
 * minute: each window focus would otherwise re-list both backends.
 */
export function projectsQueryOptions() {
  return {
    queryKey: projectsKey(),
    queryFn: (): Promise<ProjectSummary[]> => getProvider().listProjects(),
    staleTime: 60_000,
  };
}

// --- Selectors ---------------------------------------------------------------

/**
 * Module-level empties, never fresh arrays: a hook that answered `[]` anew on
 * every render would wake every `useMemo([nodes])` chain while loading.
 */
export const EMPTY_NODES: Node[] = [];
export const EMPTY_EDGES: Edge[] = [];
export const EMPTY_JOURNAL: JournalEvent[] = [];
export const EMPTY_PROJECTS: ProjectSummary[] = [];

// Hoisted so TanStack can memoize the projection: an inline `select` is a
// new function each render, which recomputes it and hands out new arrays.
export function selectProject(entry: BundleEntry | null | undefined): ProjectBundle | undefined {
  return entry?.bundle;
}

export function selectNodes(entry: BundleEntry | null | undefined): Node[] {
  return entry?.bundle.nodes ?? EMPTY_NODES;
}

export function selectEdges(entry: BundleEntry | null | undefined): Edge[] {
  return entry?.bundle.edges ?? EMPTY_EDGES;
}

export function selectJournal(entry: JournalEntry | null | undefined): JournalEvent[] {
  return entry?.events ?? EMPTY_JOURNAL;
}

// --- Load-state mapping ------------------------------------------------------

/** The subset of a query result the hooks' `loading`/`error` are derived from. */
export interface LoadStateSource {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  data: unknown;
  error: unknown;
}

/**
 * The frozen `{ loading, error }` contract of every data hook (§ D2), derived
 * from a query result.
 *
 * - A retry with no data yet must look like a load, so an error surface
 *   flips back to its loading state while the retry is in flight.
 * - A failed *background* refetch is not reported: TanStack keeps
 *   `status: "error"` next to the retained data, and reporting it would
 *   unmount a page that still has everything it needs. The `data ===
 *   undefined` clause is what stops every later refetch from resetting the
 *   Journey map's expansion and re-running its layout.
 * - `error` is `null` exactly when absent — consumers compare with `!== null`.
 *
 * Read in this short-circuit order on purpose and never destructure the
 * result up front: TanStack notifies an observer only when a property it
 * actually read changes, so a warm refetch that changes nothing (only
 * `isFetching` toggled) produces zero renders. `isFetching` is reached only
 * once an error is already on the table.
 */
export function deriveLoadState(
  result: LoadStateSource,
  fallbackMessage = "Failed to load",
): { loading: boolean; error: string | null } {
  const loading = result.isPending || (result.isError && result.isFetching && result.data === undefined);
  const error =
    result.isError && !result.isFetching && result.data === undefined
      ? result.error instanceof Error
        ? result.error.message
        : fallbackMessage
      : null;
  return { loading, error };
}

// --- Reducers ----------------------------------------------------------------
//
// Pure, and every one returns new objects for what it touches while keeping
// the siblings it does not (`bundle.project`, `bundle.quality`), so an
// unchanged part of the entry keeps its identity downstream. Each no-ops on an
// absent (`undefined`) or not-found (`null`) entry: there is nothing to patch,
// and inventing an entry would put a graph in the cache that no read produced.

/** What a graph write-back carries — `applyMutations`' result, or a subset. */
export type GraphWriteBack = Pick<MutationResult, "nodes" | "edges" | "version">;

/**
 * True when `incoming` is a strictly older server version than `current`.
 * Versions are the server's bigint rendered as strings; anything that is not
 * one compares as "not older", so a malformed version can never freeze the
 * cache on a stale graph.
 */
function isOlderVersion(current: string | null, incoming: string | undefined): boolean {
  if (current === null || incoming === undefined) return false;
  try {
    return BigInt(incoming) < BigInt(current);
  } catch {
    return false;
  }
}

/**
 * Adopt the graph a mutation returned. Refuses the result of an older request
 * when the entry already holds a newer server version: two hosted POSTs are
 * routinely in flight together, and replacing whole arrays from the earlier
 * response would silently revert the later one. The read validator is
 * dropped — the entry no longer matches any server ETag.
 */
export function withGraph<E extends BundleEntry | null | undefined>(entry: E, result: GraphWriteBack): E | BundleEntry {
  if (!entry) return entry;
  if (isOlderVersion(entry.version, result.version)) return entry;
  return {
    bundle: { ...entry.bundle, nodes: result.nodes, edges: result.edges },
    version: result.version ?? entry.version,
    etag: null,
  };
}

/**
 * Adopt an edge list on its own (`syncEdges` after a batch elsewhere), under
 * the same version guard as `withGraph`: the list comes from a mutation result
 * whose nodes the guard may just have refused as older, and adopting its
 * edges anyway would put the older edge list under the newer version.
 * Without a version (local, seed) the list is adopted as-is.
 */
export function withEdges<E extends BundleEntry | null | undefined>(
  entry: E,
  edges: Edge[],
  version?: string,
): E | BundleEntry {
  if (!entry) return entry;
  if (isOlderVersion(entry.version, version)) return entry;
  return { bundle: { ...entry.bundle, edges }, version: version ?? entry.version, etag: null };
}

/**
 * Replace the whole bundle after `saveProject`. Unlike the two above this is
 * a replacement, not a patch, so it does not need an entry to build on: the
 * bundle was just written to storage and is what the next read would return,
 * whatever the cache held before. The server version, if known, is kept —
 * `saveProject` does not report one.
 */
export function withBundle(entry: BundleEntry | null | undefined, bundle: ProjectBundle): BundleEntry {
  return { bundle, version: entry?.version ?? null, etag: null };
}

/**
 * Extend a cached journal projection with the events a write appended, in
 * append order (`DecisionLog` walks the array in order; everything else
 * re-sorts). `types` is the projection the entry was read with — only events
 * it admits are added, so a typed entry never gains an event it would not
 * have been given by the server. Events already present (a refetch landed
 * first) are skipped rather than doubled.
 */
export function withAppendedEvents<E extends JournalEntry | null | undefined>(
  entry: E,
  events: readonly JournalEvent[],
  types: readonly string[] | null,
): E | JournalEntry {
  if (!entry) return entry;
  const admitted = types === null ? events : events.filter((event) => types.includes(event.type));
  if (admitted.length === 0) return entry;
  const known = new Set(entry.events.map((event) => event.id));
  const fresh = admitted.filter((event) => !known.has(event.id));
  if (fresh.length === 0) return entry;
  return { events: [...entry.events, ...fresh], etag: null };
}

// --- Cache operations --------------------------------------------------------

/** The `types` a cached journal entry was read with, recovered from its key. */
function typesOfJournalKey(queryKey: readonly unknown[]): readonly string[] | null {
  const tail = queryKey[3];
  if (typeof tail !== "object" || tail === null || !("types" in tail)) return null;
  const types = (tail as { types: unknown }).types;
  return Array.isArray(types) ? (types as string[]) : null;
}

/**
 * After a write: extend every cached projection of the journal with the events
 * the write appended, or — when the backend could not say — mark them stale
 * without refetching. Not refetching is deliberate: an invalidated query
 * refetches on the next observer mount, and every node panel will soon mount
 * one, which would re-download the whole journal on each panel open after an
 * edit. A stale entry still repaints from cache and revalidates in the
 * background on its own schedule.
 *
 * The journal gets the same cancel-first ordering as the bundle: a journal
 * refetch that started before the mutation (a window focus, the local bus)
 * would otherwise land after the append with the pre-mutation list, replace
 * it, and — a fetch success clears `isInvalidated` and stamps the entry
 * fresh — hide the event the user just made for the whole stale window.
 * The cancel reverts every in-flight journal fetch; a projection that had no
 * data yet is then asked to read again so its answer is post-commit (see
 * `refetchIfEmpty` for why a cancelled first load needs that nudge).
 */
async function appendOrInvalidateJournal(
  client: QueryClient,
  projectId: string,
  events: JournalEvent[] | undefined,
): Promise<void> {
  const filter = { queryKey: journalPrefix(projectId) };
  await client.cancelQueries(filter);
  if (!events || events.length === 0) {
    void client.invalidateQueries({ ...filter, refetchType: "none" });
  } else {
    // Per query rather than one `setQueriesData`: the updater is handed the
    // entry but not its key, and the projection's `types` live in the key.
    for (const query of client.getQueryCache().findAll(filter)) {
      const types = typesOfJournalKey(query.queryKey);
      client.setQueryData<JournalEntry>(query.queryKey, (entry) => withAppendedEvents(entry, events, types));
    }
  }
  void client.invalidateQueries({
    ...filter,
    refetchType: "active",
    predicate: (query) => query.state.data === undefined,
  });
}

/**
 * A cancelled fetch that had no data to revert to leaves the query pending
 * and idle, and nothing schedules another read: a mounted observer would
 * stay `loading` until a remount or a window focus. When the write-back had
 * no entry to patch, ask any active observer to read again, post-commit.
 * `active` rather than `all`: with nobody observing there is nothing to
 * strand, and a read nobody waits for would be a wasted one.
 */
function refetchIfEmpty(client: QueryClient, projectId: string): void {
  if (client.getQueryData(bundleKey(projectId)) !== undefined) return;
  void client.invalidateQueries({ queryKey: bundleKey(projectId), refetchType: "active" });
}

/** The listing shows counts and `updated_at`; any write moves them. */
function markProjectsStale(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: projectsKey(), refetchType: "none" });
}

/**
 * Write a mutation's result into the cache — the canonical optimistic-update
 * ordering. The cancel comes first: a background refetch that started before
 * the mutation must not land after it and reinstate the pre-mutation graph.
 * TanStack reverts the cancelled fetch's state, and its late answer is
 * ignored; then the result is written under the version guard. The journal
 * projections get the same treatment inside `appendOrInvalidateJournal`.
 */
export async function writeBackGraph(client: QueryClient, projectId: string, result: MutationResult): Promise<void> {
  await client.cancelQueries({ queryKey: bundleKey(projectId) });
  client.setQueryData<BundleEntry | null>(bundleKey(projectId), (entry) => withGraph(entry, result));
  refetchIfEmpty(client, projectId);
  await appendOrInvalidateJournal(client, projectId, result.events);
  markProjectsStale(client);
}

/**
 * `syncEdges`: the same guarded write-back for an edge list alone. `version`
 * is the one the list came with (`applyMutations`' result), so a list the
 * graph write-back just refused as older is refused here too.
 */
export async function writeBackEdges(
  client: QueryClient,
  projectId: string,
  edges: Edge[],
  version?: string,
): Promise<void> {
  await client.cancelQueries({ queryKey: bundleKey(projectId) });
  client.setQueryData<BundleEntry | null>(bundleKey(projectId), (entry) => withEdges(entry, edges, version));
  refetchIfEmpty(client, projectId);
  markProjectsStale(client);
}

/**
 * After `saveProject`: the bundle just written IS the project now. The journal
 * entries are left alone — `saveProject` emits no events (local-provider.ts
 * § Journal emission). The listing goes stale: the title and `updated_at`
 * live there too.
 */
export async function writeBackBundle(client: QueryClient, projectId: string, bundle: ProjectBundle): Promise<void> {
  await client.cancelQueries({ queryKey: bundleKey(projectId) });
  client.setQueryData<BundleEntry | null>(bundleKey(projectId), (entry) => withBundle(entry, bundle));
  markProjectsStale(client);
}

// --- Invalidation seams ------------------------------------------------------
//
// For writers that bypass the hooks (the raw-bundle save, import, archive,
// the projects page's own loader). They read the client through
// `getQueryClient()`, so on the server — where nothing observes anything —
// they act on a throwaway client and are harmless.

/**
 * Everything cached under a project — bundle and every journal projection.
 * Active by default: the page behind a raw-bundle save must actually refetch,
 * not merely learn it is stale.
 */
export function invalidateProject(
  projectId: string,
  { refetchType = "active" }: { refetchType?: "active" | "inactive" | "all" | "none" } = {},
): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: projectKey(projectId), refetchType });
}

/** The projects list, marked stale for its next mount; nothing refetches now. */
export function invalidateProjects(): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: projectsKey(), refetchType: "none" });
}

// --- The local bus -----------------------------------------------------------

/**
 * The local provider announces every mutation it commits (issue #243). Wire
 * it to the cache so a write that never went through a hook — an import, a
 * restore, a raw save — still refreshes whatever is on screen. It fires for
 * the hooks' own writes too; those go on to `cancelQueries` before their
 * write-back, so the bundle and journal reads the bus started are ignored
 * rather than adopted — Dexie has no abort, so the reads themselves still
 * complete and are paid for. Seed and remote have no bus: the explicit seams
 * above cover them.
 */
export function subscribeLocalMutationsToCache(client: QueryClient): () => void {
  return subscribeToMutations(({ projectId }) => {
    void client.invalidateQueries({ queryKey: projectKey(projectId) });
    void client.invalidateQueries({ queryKey: projectsKey(), refetchType: "none" });
  });
}

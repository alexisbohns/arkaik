# Reactive data layer — one fetch per project, a query cache behind the hooks, cheap revalidation

**Status:** design v2 (after a four-lens adversarial review), implementation
in progress. Parts land as one commit each on
`claude/arkaik-rendering-performance-pzist3`; each part is a reviewable unit
(see `docs/conventions.md` § "Shipping larger work").

## Why

On a hosted project the size of Pebbles (1000+ nodes, thousands of prose-heavy
journal events) a map or the changelog takes ~2 s to appear. Measured on the
current tree:

| Route | Requests per navigation | Server loads the whole jsonb snapshot |
|---|---|---|
| `/project/:id/maps/journey` | 6 (`useProject` ×3, nodes, edges, journal) | 6 times, plus the full journal |
| `/project/:id/overview` | 5 | 5 times, plus the full journal |
| `/project/:id/changelog` | 4 | 3 times, plus the full journal |

Every page mounts its own `useProject`/`useNodes`/`useEdges`/`useJournal`
(`lib/hooks/*.ts`), each a plain `useState` with no cache, and Next remounts
the page segment on every navigation; the Journey route even runs two
waterfalls (the map page gates on its own `useProject` before the map mounts
its four hooks). `remote-provider.ts` sends `cache: "no-store"`. Server-side,
`getNodes`/`getEdges`/`getJournal` all start with `loadProject`
(`select snapshot …`) even when they only need an owner check, and the bundle
GET loads the snapshot twice. The journal (thousands of events,
`deliverable.shipped` + `node.created` = 75 % of its bytes) is fetched by ten
surfaces, eight of which only forward it to the node panel's History section.

Main-thread parsing is not the cost: at hosted scale `JSON.parse` of the
bundle is ~6 ms and of the journal ~5 ms. Rendering is the smaller share: ELK
layout runs on the main thread (`elkjs/lib/elk.bundled.js`, 44–129 ms on the
Journey map at seed scale but 2–4 s on the System map, 17–32 s at hosted
scale); the graph builders are single-digit milliseconds; React Flow node
types are stable and memoized.

## What changes (the shape)

```
IndexedDB (Dexie) | hosted graph API | in-memory seed
      ↕ local / remote / seed providers      (DataProvider: applyMutations also returns version + events; two optional conditional reads)
      ↕ routingProvider                       (owns the fallback for the optional reads)
      ↕ lib/data/project-queries.ts          NEW — React-free query descriptors, select functions, write-back reducers, invalidation seams
      ↕ TanStack Query cache                 NEW — one QueryClient per browser (lib/data/query-client.ts), mounted by components/query/QueryProvider.tsx
      ↕ useProject / useNodes / useEdges / useJournal / useProjects   (same return shapes; thin bindings)
      ↕ pages → props → canvases / panels     (unchanged)
```

- **One bundle query per project** (`["project", id, "bundle"]`). `useNodes`
  and `useEdges` are `select`s over it. Layout, page and map share it: the
  Journey route drops from 6 requests to 1 (plus a lazy journal read when a
  node panel's History section mounts).
- **The journal is fetched by the surfaces that read it, in the shape they
  read.** The changelog, design and decisions pages request a typed
  projection (`?types=`); the History page and the Overview request the whole
  journal (the Overview no longer gates first paint on it); the node panel's
  History section reads the whole journal itself, lazily, when it mounts.
  Maps, library, delivery and acceptances stop fetching the journal at all.
- **Writes write back, safely.** Every hook mutator goes through
  `provider.applyMutations` (available on all three providers), which now
  returns `{ nodes, edges, version?, events? }`; the hook cancels any
  in-flight read of the entry, then writes both arrays back guarded by the
  server version, and appends the returned events to every cached journal
  entry. This also closes today's stale-edges gap (cascaded deletes and
  synthesized `composes` edges never reached `useEdges` until a reload).
  Writes that bypass the hooks call one invalidation seam.
- **Revalidation is cheap.** Read routes emit a weak ETag, answer
  `If-None-Match` with 304 and no snapshot load, and carry
  `Cache-Control: private, no-cache`. The query layer sends the validator it
  holds and keeps the previous object on 304, so a background refetch that
  finds nothing changed costs one small request and zero re-renders.
- **ELK runs in a web worker** with a lazy main-thread fallback.
- **Persistence of hosted entries in IndexedDB is deferred** (see
  "Deferred: persistence") — the in-memory cache already removes the
  in-session cost, and the review found the blob persister's cost and three
  correctness hazards that deserve their own change.

Export and import are untouched: `exportProject` / `importProject` keep their
endpoints and the bundle stays the interchange unit. A cache changes nothing
about the stored shape.

## Decisions

### D1 — TanStack Query, not TanStack DB

TanStack DB is a client-side normalized collection layer with live differential
queries; its value is offline-first sync and sub-document reactivity. Hosted
mode is deliberately online-only for writes (`remote-provider.ts` header,
`docs/hosted-projects.md`), the server validates whole graphs on a jsonb
snapshot, and the amplification above is a caching problem, not a data-model
problem. A third data model between Dexie and Postgres would not remove a
single redundant request. Revisit if hosted offline editing or per-node
subscriptions become goals.

`docs/conventions.md` § State Management ("No global store for domain data")
is amended: a **query cache** is not a store. Domain data still flows through
the same hooks and props; the cache only deduplicates and remembers reads, and
`lib/data/project-queries.ts` is its only writer — components never call
`useQueryClient()`.

### D2 — Hook return shapes are frozen

`useProject → { project, loading, error, reload, updateProject }`,
`useNodes → { nodes, loading, error, reload, addNode, removeNode, removeNodes, updateNode, applyMutations }`,
`useEdges → { edges, loading, error, reload, addEdge, removeEdge, syncEdges }`,
`useJournal → { journal, loading, error, reload }`,
`useProjects → { projects, loading, error }`.

Mapping from query state (verified against every consumer, then corrected by
the review for the failed-background-refetch case):

- `loading = isPending || (isError && isFetching && data === undefined)`.
  A retry after an error with **no data** must look like a load (`PageError`
  → `PageLoading`), as today's `reload()` does. After a failed *background*
  refetch TanStack keeps `status: "error"` next to the retained data, so the
  `data === undefined` clause is what stops every later refetch from
  unmounting the page (which would reset the Journey map's auto-expand latch
  and re-run ELK).
- `error = isError && !isFetching && data === undefined ? message : null` —
  `null` exactly when absent (`layout.tsx:167`, `ProductManagerPanel.tsx:100`
  compare with `!== null`). A failed background refetch over cached data is
  not reported: the surface keeps its data (stale-while-error).
- `reload = () => refetch({ cancelRefetch: false }).then(() => undefined)` —
  pages fan one retry into up to four `reload()` calls on what is now one
  query; joining the in-flight fetch beats cancelling it three times.
- The hooks read the observer result with the short-circuit order above and
  never destructure `isFetching`/`fetchStatus` up front: TanStack notifies
  only on tracked properties, so a warm background refetch that changes
  nothing produces **zero** renders. Pinned by a `QueryObserver` test.
- `nodes`, `edges`, `journal` fall back to **module-level `EMPTY` constants**,
  never fresh arrays, so `useMemo([journal])` chains stay quiet while loading.
- `structuralSharing` stays on and `select` functions are hoisted to module
  scope, so an unchanged refetch keeps `project.project`, `project.quality`,
  `nodes` and `edges` identities and ELK does not re-run.
- No `enabled` gate: an empty id (`useProjectId()` falls back to `""`) must
  resolve to a `null` entry with `loading: false`, as `getProject("")` does
  today. `loading` is `true` whenever data has not been read (`isPending`),
  never `false` with an empty list before a read — `ProductManagerPanel`
  plans destructive deletions against `nodes` once `loading` is false.
- Behaviour changes accepted as fixes: the layout's `useProject` reports
  `isPending` on a project switch (sidebar shows "Loading project…" instead
  of the previous project's title), and `error` is per key.
- No `useSuspenseQuery`: there is no Suspense boundary under `/project/[id]`.

### D3 — Query keys and entry shapes

| Key | Data | Notes |
|---|---|---|
| `["projects"]` | `ProjectSummary[]` | queryFn awaits `whenHostedAvailabilityKnown()` (the routing provider already does); `staleTime: 60 s`; invalidated when the existing `useAuthStatus` resolves signed-in |
| `["project", id, "bundle"]` | `BundleEntry = { bundle: ProjectBundle, version: string \| null, etag: string \| null } \| null` | `null` = not found (query data cannot be `undefined`). `version` is the server's strong version (guards write-backs); `etag` is the read validator (Part 2b) |
| `["project", id, "journal", { types: string[] \| null }]` | `JournalEntry = { events: JournalEvent[], etag: string \| null }` | `types` sorted + deduped in the key; `null` = whole journal |

Selectors: `selectProject(entry) → bundle ?? undefined`, `selectNodes`,
`selectEdges`, `selectJournal`. Every write-back reducer returns new objects
and **no-ops on an absent (`undefined`) or not-found (`null`) entry**; the
unit test asserts both immutability and that unchanged siblings
(`bundle.project`, `bundle.quality`) keep identity — the `react-hooks/immutability`
rule cannot see inside a `setQueryData` updater.

### D4 — Freshness policy

- Project entries: `staleTime: 30 s` (navigation inside the window is a cache
  hit with no request; beyond it the cached data paints immediately and a
  background refetch runs), `gcTime: 30 min`, `retry: 1` and never on a 4xx
  (`RemoteProviderError` status < 500).
- `refetchOnWindowFocus: true`, with `focusManager` listening to both
  `visibilitychange` **and** window `focus` — switching from a terminal to a
  browser window that stayed visible fires neither by default.
- Hosted entries (`isHostedProjectId`) additionally poll with
  `refetchInterval: 60 s`, `refetchIntervalInBackground: false`: agents, the
  CLI and the GitHub App write server-side while the tab is open, and after
  Part 2b each tick is one conditional GET answered by a 304.
- `["projects"]`: `staleTime: 60 s` (it is mounted in the persistent layout;
  each focus would otherwise re-list both providers).

### D5 — Writes

- **Contract**: `DataProvider.applyMutations(projectId, ops)` returns
  `{ nodes, edges, version?: string, events?: JournalEvent[] }`. Remote fills
  `version` and `events` from the mutations response (which already carries
  both and the provider discarded). Local and seed return the events they
  appended (`toJournalEvents(outcome.eventInputs)` with the same envelope the
  provider writes) and no `version` (Dexie transactions and the in-memory
  sandbox serialize, so their responses resolve in commit order).
- Every hook mutator (`addNode`, `updateNode`, `removeNode(s)`, `addEdge`,
  `removeEdge`, `applyMutations`) calls `provider.applyMutations(projectId,
  ops)`; `removeNodes([])` and `applyMutations([])` return early (the
  providers' `deleteNodes([])` short-circuit, and an empty ops array is a
  400 on the server). `addNode`/`updateNode`/`addEdge` return the entity
  found in the result (by id; edges by `source_id`+`target_id`, since the
  server normalizes edge ids).
- **Write-back sequence** (the canonical optimistic-update ordering):
  1. `await queryClient.cancelQueries({ queryKey: bundleKey })` — a
     background refetch started before the mutation must not land after it
     and reinstate the pre-mutation snapshot. The queryFn threads TanStack's
     `AbortSignal` into `readProject`/`readJournal` → `fetch`, so the
     cancelled request is actually torn down. The journal projections get
     the same cancel before step 3 (a focus-triggered journal GET landing
     after the append would replace it with the pre-mutation list and stamp
     it fresh). A cancelled fetch that had no data reverts to pending/idle
     and nothing restarts it, so after the write the bundle (when it still
     has no entry) and every journal projection without data are
     invalidated with `refetchType: "active"`: a mounted observer reads
     again, post-commit, instead of staying `loading` until a remount.
  2. `setQueryData(bundleKey, entry => guard(entry, result))` where the guard
     skips the update when both `entry.version` and `result.version` are
     defined and `BigInt(result.version) < BigInt(entry.version)` — two
     hosted POSTs are routinely in flight together (title autosave, playlist
     label flush, a status click), and whole-array replacement from the
     older response would revert the newer one. Otherwise `{ bundle: {
     ...bundle, nodes, edges }, version: result.version ?? entry.version,
     etag: null }`.
  3. Append `result.events` to every cached `["project", id, "journal", …]`
     entry whose `types` admits them (array order preserved: `DecisionLog`
     walks in array order; every other consumer re-sorts). If a provider
     returns no events, invalidate the journal entries with
     `refetchType: "none"` instead. Journal entries are otherwise **not**
     invalidated after a write: an invalidated query refetches on the next
     observer mount, and after Part 2a every node panel mounts one — which
     would re-download the whole journal on each panel open after an edit.
  4. `invalidateQueries(["projects"], { refetchType: "none" })`.
- `syncEdges(next, version?)` is the same guarded write-back of `edges`
  (idempotent after `applyMutations`, whose result carries the `version` the
  caller forwards — without it the guard the batch's own write-back applied
  would be undone one call later).
- `useProject.updateProject`: `current = await getProvider().getProject(id)`
  — a fresh provider read for local and seed (their `saveProject` rewrites
  nodes, edges and deletes the journal row when the bundle lacks one, so the
  saved bundle must never come from a possibly-bypassed cache) and, after
  Part 2b, a conditional GET for hosted (304 when unchanged instead of
  today's unconditional snapshot load). Not a `fetchQuery` on the entry: a
  graph write-back's `cancelQueries` overlapping it makes `fetchQuery`
  resolve with the reverted pre-mutation snapshot (query-core returns
  `state.data` on a revert-cancel rather than rejecting), and the overlap
  is routine (a status click during a title autosave).
  Then `saveProject(nextBundle)`, cancel, write back `nextBundle` with
  `etag: null`, invalidate `["projects"]` (`refetchType: "none"`). The
  layout's sidebar (custom maps, products) updates at once — today it stays
  stale until remount.
- **Invalidation seams** in `lib/data/project-queries.ts`:
  `invalidateProject(projectId)` (default `refetchType: "active"` — the page
  behind a raw-bundle save must actually refetch), `invalidateProjects()`
  (`refetchType: "none"`). They read the client through `getQueryClient()`
  (`lib/data/query-client.ts`): a browser-side module singleton, a fresh
  client per call on the server, and an injectable override for tests — no
  registration step, so StrictMode's double initializer cannot register a
  discarded client. Call sites that bypass the hooks:
  `components/panels/RawBundlePanel.tsx` (raw save), `lib/utils/export.ts`
  (`importProject`, `importProjectFromFile`, `archiveProject` → projects
  only; the project entry is left to expire, so the still-mounted layout
  does not refetch a just-archived project), `app/projects/page.tsx` (create
  / import / move), `lib/hooks/useAuthStatus.ts` (signed-in → projects).
- **Local safety net**: `QueryProvider` subscribes to the local provider's
  `subscribeToMutations` and invalidates `["project", projectId]` and
  `["projects"]`. It also fires for the hooks' own writes, but those go on to
  `cancelQueries` before their write-back, so the bundle and journal reads
  the bus started are ignored rather than adopted (Dexie has no abort — the
  reads themselves still complete); for bypass writers they land. Seed and
  remote providers have no bus; the explicit seams above and the server ETag
  cover them.

Known, pre-existing, out of scope: `RawBundlePanel` on a **hosted** project
saves into IndexedDB under the `prj_` id (routing sends every non-seed import
to the local provider). The invalidation added there refetches the server
bundle and correctly shows no change. Documented as a follow-up, not fixed
here.

### D6 — Conditional GET (server + remote provider)

- **Validators** come from one owner-scoped statement, after `getCaller`,
  same scope as `loadProject` (no `archived_at` filter — reads of archived
  projects stay 200), computed **in the same statement as the body** for the
  snapshot routes so ETag and body are snapshot-consistent (for `/journal`,
  validator first, then rows — the ETag can then only be older than the
  body, which is safe):
  ```sql
  select p.snapshot, p.version::text as version,
         (select count(*) from graph_events e where e.project_id = p.id)::text as event_count,
         (select count(*) from graph_events e where e.project_id = p.id
             and e.event->>'type' in ('quality.finding.resolved','quality.finding.accepted'))::text as quality_event_count
    from graph_projects p
   where p.id = $1 and p.owner_id = any($2::text[])
  ```
  `count(*)`, not `max(seq)`: `appendJournalEvents` inserts without a
  transaction, so two concurrent appends can commit out of seq order and a
  `max(seq)` validator would miss the earlier one; a count changes on every
  committed insert, and the only deleter (restore) always bumps `version`.
  It also keeps the platform-wide `bigserial` out of a tenant-visible header.
  All values stay **strings** (bigint discipline).
- **ETags** (weak on purpose — `If-None-Match` compares weakly, and the write
  routes' `parseIfMatch` / `classifyIfMatch` refuse `W/`, so a client that
  echoes a read ETag into `If-Match` gets a loud 400/409 rather than a silent
  stale write; write routes keep their strong `"<version>"` ETags and the JSON
  `version` field the CLI builds `If-Match` from):
  - `GET /projects/{id}` (folded bundle): `W/"<version>.<quality_event_count>"`
    — a merged PR's `deliverable.shipped` append must not turn the next map
    revalidation into a 2 MB 200; only quality decisions change the fold.
  - `/nodes`, `/edges`: `W/"<version>"`.
  - `/journal`, `/export`: `W/"<version>.<event_count>"`.
- **304** only when the request carries `If-None-Match` and it matches
  (comma lists and `*` handled); the response has the ETag,
  `Cache-Control: private, no-cache`, `Vary: Authorization`, no body, and
  **no snapshot load**. 200 responses carry the same headers. Next 16 adds
  no caching headers of its own to `force-dynamic` route handlers and
  `private` keeps Vercel's edge out. The MCP remote-store and the CLI never
  send `If-None-Match`, so they never see a 304.
- **Cheaper 200s**: `getNodes`/`getEdges` select `snapshot->'nodes'` /
  `snapshot->'edges'`; `getJournal` and `qualityFindingEvents` stop calling
  `loadProject` for the owner check; the bundle GET loads the snapshot
  **once** (today twice).
- **Pure helpers** in a DB-free module `lib/services/graph/etag.ts`
  (`formatReadEtag`, `ifNoneMatchSatisfied`, `parseJournalTypes`), tested in
  the fast CI job like `restore.ts`; `tests/services/load-graph-api.js`'s
  rewrite table gains the module, or the Postgres suite cannot load the
  routes.
- **Optional provider reads**: `readProject(id, { etag, signal })` and
  `readJournal(id, { etag, types, signal })` returning
  `{ status: "fresh", value, etag, version? } | { status: "not-modified" } |
  { status: "missing" }`. The remote provider implements them (handles 304
  **before** the `!res.ok` check; sends `If-None-Match` only from the `etag`
  argument; **no value memo** — the query layer already holds the previous
  entry). The **routing provider owns the fallback**: for a target without
  the method it calls `getProject`/`getJournal` and wraps the result with
  `etag: null`. The queryFn reads the previous entry, passes its `etag`, and
  on `not-modified` returns that same entry (same reference → structural
  sharing short-circuits, zero renders).
- `cache: "no-store"` stays: we validate ourselves, the browser HTTP cache
  would only double-store. The "NO LOCAL CACHE" paragraph in
  `remote-provider.ts` is rewritten in Part 1: a read cache with
  server-validated freshness is not the replay queue it warns against; writes
  remain online-only.

### D7 — Journal projection and the panel History section

- `GET …/journal?types=a,b` (comma-separated; repeatable) filters with
  `event->>'type' = any($2::text[])` in server `seq` order; unknown types
  match nothing; an empty list after trimming means "no filter"; more than 32
  types is a 400 (fail-closed, like `classifyDryRun`). Response shape
  unchanged (`{ journal }`). The ETag is the whole-journal validator (superset
  invalidation). `/export` never projects, and the integration test says so.
- Migration `db/migrations/011_graph_events_type_index.sql`:
  `create index if not exists graph_events_project_type_seq_idx on graph_events (project_id, (event->>'type'), seq)`
  — idempotent, inside the runner's per-file transaction (no
  `concurrently`), serves the projection, the quality-count validator,
  `qualityFindingEvents` and the two GitHub queries.
- `DataProvider.getJournal(projectId, options?: { types?: readonly string[] })`
  (source-compatible); local and seed filter in memory; routing forwards.
- `useJournal(projectId, options?: { types })`. Consumers:

| Surface | Reads | Journal query |
|---|---|---|
| Changelog | `deliverable.shipped`, `release.tagged` | projection |
| Design | `idea.proposed`, `request.filed`, `node.status_changed`, `decision.status_changed` | projection |
| Decisions (`DecisionLog`) | `node.created` | projection |
| Overview | whole-journal counts (`journalEventCount`, `eventCount` per release) | whole journal, **off the first-paint gate**: bundle-backed cards paint first, journal-backed cards show a pending state (a server aggregate is a follow-up) |
| History | everything | whole journal |
| Node panel History section | every scalar-`node_id` type + `edge.*` | whole journal, **read by the section itself** via `useJournal(useProjectId())` (the route id — a hosted node's `project_id` is the imported bundle's own id), lazily on mount |
| Maps, Library, Delivery, Acceptances | nothing | **no journal request** |

- `PageShell`/`ProjectPanels`/`NodeDetailPanel` replace the
  `journal?: JournalEvent[]` prop with `history?: boolean` (mount the History
  section or not). Pages that passed `journal={journal}` pass `history`;
  Overview keeps passing nothing (its panels have no History today). The
  section shows a one-line loading state while its query is pending. This is
  its own part (2a): it depends only on the cache (so N open panels share
  one journal query), not on ETags or `?types=`, and it is the slice that
  removes the journal request from the Journey route.
- Empty-state gates that read `journal.length === 0` on the projected pages
  get sentences that are true for a subset ("No releases tagged yet, and
  nothing shipped since." already exists on the changelog).

### D8 — ELK in a worker

- `lib/utils/elk.worker.ts` = `import "elkjs/lib/elk-worker.min.js";`;
  `lib/utils/elk-engine.ts` = `getElkEngine()`: lazy memoized singleton,
  browser-guarded (`typeof Worker !== "undefined"`), built from
  `elkjs/lib/elk-api.js` with
  `workerFactory: () => new Worker(new URL("./elk.worker.ts", import.meta.url))`
  (classic worker, no `type: "module"` — verified to compile under Turbopack
  dev and prod; also the documented webpack 5 form). Fallback:
  `await import("elkjs/lib/elk.bundled.js")` (dynamic, so the 1.6 MB engine
  leaves the main graph — the worker chunk is 464 KB gzip against 469 KB
  removed, wire-neutral) when `Worker` is missing, construction throws, or
  `worker.onerror` fires; a layout in flight when the worker dies is retried
  once on the fallback. `elk-api` never rejects on its own, so the engine
  wrapper races each layout against the worker's error event.
- `computeElkLayout` keeps its signature; `useElkLayout` and both canvases
  are untouched. Layouts are not faster, they stop blocking the UI; the
  System map's organic rendition at hosted scale remains slow (stress is 95 %
  of it) — lowering `elk.stress.iterationLimit` and a "laying out" indicator
  are follow-ups.
- Nothing in `tests/` loads `elk-layout.ts`; keep `import.meta.url` out of
  every module the CommonJS test loaders transpile.
- This is a different story from the data layer and would be its own stack;
  the environment provides one branch, so it lands as the **last** commit so
  it can be cherry-picked out.

### Deferred: persistence (design recorded, not shipped here)

The in-memory cache removes the in-session cost; a cold load pays one request
instead of six either way. The review found the `PersistQueryClientProvider`
+ blob persister costs 20 ms of main-thread `JSON.stringify` and a multi-MB
IndexedDB rewrite per cache event, gates every query app-wide behind the
restore, and adds three hazards: an entry restored inside `staleTime` is never
revalidated (regression for "reload to see what the agent did"),
`ProductManagerPanel` would plan deletions against a ≤24 h snapshot, and
entries are not scoped to the signed-in user. When it is picked up:
`experimental_createQueryPersister` per hosted query (one Dexie row per query
hash in a **separate** database, lazy restore inside the query's own
queryFn), restored entries marked `isInvalidated` so the first mount
revalidates by ETag, `buster` including `CURRENT_SCHEMA_VERSION` **and** the
user id, `loading` reported while a restored entry is being validated, and
the `docs/conventions.md` "never write to IndexedDB directly" rule amended.

## Parts — the stack that shipped

Cut as a `gh stack` of one-branch-one-PR parts (`docs/conventions.md`
§ "Shipping larger work"). The plan above was written for one branch; the
split happened after the first three commits existed, which is why parts 1–3
are those commits verbatim and part 2b became two parts — the API below the
UI that consumes it.

| # | Branch | PR | What |
|---|---|---|---|
| 1 | `reactive-data-1-groundwork` | #431 | `@tanstack/react-query` and this design record |
| 2 | `reactive-data-2-query-cache` | #432 | `query-client.ts`, `project-queries.ts`, `QueryProvider`, the five hooks, the `applyMutations` contract (`version`, `events`) across the providers, the invalidation seams, `tests/data/project-queries.test.js` |
| 3 | `reactive-data-3-panel-history` | #433 | 2a — the `history` prop, `HistorySection`'s self-read, nine page edits, the Overview off the journal gate |
| 4 | `reactive-data-4-etag-reads` | #435 | 2b server — `etag.ts`, the validator SQL, the read routes, the single-load bundle GET, migration 011, `graph-etag` + `graph-api` coverage, `docs/spec/services.md` § Hosted Graph Projects |
| 5 | `reactive-data-5-conditional-reads` | #436 | 2b client — `readProject`/`readJournal`, the routing fallback, the conditional queryFns, hosted polling, `updateProject`'s conditional pre-read |
| 6 | `reactive-data-6-journal-projection` | #437 | 2c — `?types=` end to end, the changelog/design/decisions projections and their empty states |
| 7 | `reactive-data-7-docs` | #438 | this commit: the architecture diagram, the hosted-projects wording, the doc audit, these lessons |

The ELK worker is **not** in this stack: it is the layout thread, not the data
layer, and ships on its own branch off `main` (issue #427). The deferred
follow-ups are issue #429.

## Verification plan

- Unit: `project-queries` (one provider read serves two consumers; write-back
  without refetch; cancel-then-write-back survives a slow read; the version
  guard drops an older response; reducers are immutable and keep unchanged
  identities and no-op on `undefined`/`null`; event append respects `types`;
  loading/error mapping after success → failed refetch → refetch in flight;
  zero observer notifications on a warm no-change refetch; seams no-op
  without a client), `graph-etag` (format, weak comparison, lists, `*`, types
  parsing incl. empty and >32), provider 304 (injected `fetchImpl` answering
  304 → not-modified, 200 → value + etag + version; signal forwarded).
- Integration (`tests/services/graph-api.test.js`, local Postgres): ETag
  format on every read route; 304 on match with no body; a quality-event
  append without a version bump flips the bundle and journal ETags; a
  `deliverable.shipped` append flips only the journal ETag; `?types=`
  filters and keeps order; `/export?types=` still embeds every event; an
  archived project still answers 200/304 to its owner; another owner gets
  404 whatever `If-None-Match` says.
- Manual (browser): Journey map on a hosted project shows one bundle request
  per navigation and none for the journal; changelog shows one projection
  request; a background revalidation is a 304; ELK chunk loads as a worker.

## Follow-ups (not in this stack)

- Persistence (above).
- Overview: a server-side journal aggregate (`total`, events per release) so
  the landing page needs only a projection.
- History page: server pagination by `seq`.
- `useAuthStatus` as a shared query (six unshared fetches today).
- `RawBundlePanel` on hosted projects should go through `PUT …/bundle`.
- System map: adaptive `elk.stress.iterationLimit`, a "laying out" state.
- `coveringAcceptances` edge index in the graph builders (O(V·E) today,
  milliseconds at seed scale).
- Remote `archiveProject` calls `res.json()` on a 204 (pre-existing; verify).

## Lab Note (draft for the PR)

```yaml
en:
  title: "Maps and the changelog open instantly on big projects"
  summary: "Arkaik now remembers what it already read: switching between the map, the changelog and the overview no longer re-downloads the whole project, and a large map lays itself out without freezing the page."
fr:
  title: "Cartes et changelog s'ouvrent instantanément sur les gros projets"
  summary: "Arkaik se souvient désormais de ce qu'il a déjà lu : passer de la carte au changelog ou à la vue d'ensemble ne retélécharge plus tout le projet, et une grande carte se met en page sans figer l'écran."
nodes: [V-journey-map, V-system-map, V-changelog, V-overview, V-history, V-node-detail-panel, API-graph-project, API-get-graph-project-journal, API-get-graph-project-nodes, API-get-graph-project-edges, API-get-graph-project-export]
suggested:
  molecule: arkaik
  type: improvement
  tags: [performance]
```

(`nodes:` read off `seed/arkaik-self-map.json`; confirm against the hosted
self-map before opening the PR. If the ELK worker ships separately, drop its
clause from both summaries.)

## Lessons learned

- **Part 2a.** D7's `useJournal(node.project_id)` wording was wrong for hosted
  projects: `createProject` / `replaceProjectBundle` store the bundle verbatim
  under a server-minted `prj_…` id, so a hosted node's `project_id` is the
  bundle's own id and the routing provider sends it to the local Dexie store
  (an empty journal, or a colliding local project's). The History section
  reads by the route id (`useProjectId()`), like every other project hook.

- **Splitting after the fact worked, but cost a PR.** Parts 1–3 were three
  commits on one branch before the split. Turning them into a stack was
  mechanical (`git branch` at each commit, then `gh stack init`), but renaming
  the original branch on GitHub so its PR would follow **closed** that PR
  instead: GitHub retargets a renamed branch for pull requests that use it as
  a *base*, not as a *head*. Rename first, or accept a new PR number. Cutting
  the parts up front stays cheaper than either.

- **The handover diff was a starting point, not a review candidate — as
  labelled.** The unverified diff attached to #425 had never been compiled: it
  left every caller of the changed store functions unadapted (the pollen route
  was a type error), and its `store.ts` half was truncated mid-file by the
  issue body it travelled in. It also needed `git apply --recount`. What it
  did carry, and what was worth carrying, was the *reasoning* — why weak
  validators, why counts rather than `max(seq)`, why the journal's validators
  are read before its rows. Attach reasoning to a handover even when the code
  is unfinished; the code was rewritten, the reasoning survived intact.

- **Part 2b, D6's cost estimate held up.** Measured on 20 000 events after a
  `vacuum analyze`: the quality-decision count is an index scan on migration
  011's new index (0.015 ms) and the whole-event count an index-only scan
  (~1 ms). Both are noise against the multi-megabyte snapshot read a 304
  avoids — which is why the same shared validator statement serves `/nodes`
  and `/edges` too, whose ETag uses only one of its three columns.

- **A new module breaks the CommonJS test loaders silently.** `lib/data/
  journal-projection.ts` is a plain relative import, and both provider loaders
  had to learn to transpile it before the suites could even load. The same
  trap as an `@/…` alias: the loaders enumerate their modules by hand. Adding
  a file to `lib/data/` means checking `tests/data/load-*.js`.

- **Part 2c: an empty projection is the whole journal.** The first
  implementation made `[]` filter to nothing in memory while the server's
  parser and the remote URL both read it as "no projection". A test caught it
  at the seed provider. The rule now lives in one sentence in three places
  (`normalizeJournalTypes`, `projectJournal`, `parseJournalTypes`) and in the
  cache key, so `[]`, `null` and `undefined` cannot disagree — and a typed
  entry still admits every appended event it should.

- **A projection makes an empty state lie.** "No journal yet" was true when
  the page read the whole journal and false the moment it read two event
  types. Every page that narrows its read has to narrow its empty-state
  sentence with it — the changelog now says "No releases tagged yet, and
  nothing shipped since." This is the reviewable half of a projection, and it
  is not in the diff of the read.

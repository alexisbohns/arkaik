# Reactive data layer — one fetch per project, a query cache behind the hooks, cheap revalidation

**Status:** design, pre-implementation. Parts land as commits on
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
the page segment on every navigation. `remote-provider.ts` sends
`cache: "no-store"`. Server-side, `getNodes`/`getEdges`/`getJournal` all start
with `loadProject` (`select snapshot …`) even when they only need an owner
check. The journal (thousands of events, `deliverable.shipped` + `node.created`
= 75 % of its bytes) is fetched by ten surfaces, eight of which only forward it
to the node panel's History section.

Rendering is the smaller share: ELK layout runs on the main thread
(`elkjs/lib/elk.bundled.js`, 44–129 ms on the Journey map at seed scale but
2–4 s on the System map, 17–32 s at hosted scale); the graph builders are
single-digit milliseconds; React Flow node types are stable and memoized.

## What changes (the shape)

```
IndexedDB (Dexie) | hosted graph API | in-memory seed
      ↕ local / remote / seed providers      (DataProvider, unchanged surface + two optional read methods)
      ↕ routingProvider
      ↕ lib/data/project-queries.ts          NEW — React-free query descriptors, select functions, write-back reducers, invalidation seams
      ↕ TanStack Query cache                 NEW — one QueryClient per app (components/query/QueryProvider.tsx)
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
  journal; the node panel's History section reads the whole journal itself,
  lazily, when it mounts. Maps, library, delivery and acceptances stop fetching
  the journal at all.
- **Writes write back.** Every hook mutator goes through
  `provider.applyMutations` (available on all three providers, returns
  `{ nodes, edges }`) and writes both arrays into the bundle entry, which also
  closes today's stale-edges gap (cascaded deletes and synthesized `composes`
  edges never reached `useEdges` until a reload). Writes that bypass the hooks
  call one invalidation seam.
- **Revalidation is cheap.** Read routes emit a weak ETag
  `W/"<version>.<journalSeq>"`, answer `If-None-Match` with 304 and no
  snapshot load, and carry `Cache-Control: private, no-cache`. The remote
  provider remembers the validator per resource and returns the previous
  object on 304, so a background refetch that finds nothing changed costs one
  small request and zero re-renders.
- **ELK runs in a web worker** with a lazy main-thread fallback.
- **Hosted entries persist in IndexedDB** (separate Dexie database) so a
  return visit paints from cache and revalidates by ETag.

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
the same hooks and props; the cache only deduplicates and remembers reads.

### D2 — Hook return shapes are frozen

`useProject → { project, loading, error, reload, updateProject }`,
`useNodes → { nodes, loading, error, reload, addNode, removeNode, removeNodes, updateNode, applyMutations }`,
`useEdges → { edges, loading, error, reload, addEdge, removeEdge, syncEdges }`,
`useJournal → { journal, loading, error, reload }`,
`useProjects → { projects, loading, error }` (+ `reload`, additive).

Mapping from query state (verified against every consumer):

- `loading = isPending || (isError && isFetching)` — a retry after an error
  must look like a load (`PageError` → `PageLoading`), as today's `reload()`
  does by setting `loading=true; error=null` synchronously.
- `error = isError && !isFetching && data === undefined ? message : null` —
  `null` exactly when absent (`layout.tsx:167`, `ProductManagerPanel.tsx:100`
  compare with `!== null`). A failed **background** refetch over cached data
  is not reported: the surface keeps its data (stale-while-error) instead of
  the layout gate replacing the whole page.
- `reload = () => refetch().then(() => undefined)`.
- `nodes`, `edges`, `journal` fall back to **module-level `EMPTY` constants**,
  never fresh arrays, so `useMemo([journal])` chains stay quiet while loading.
- `structuralSharing` stays on and `select` functions are hoisted to module
  scope, so an unchanged refetch keeps `project.project`, `project.quality`,
  `nodes` and `edges` identities and ELK does not re-run.
- `loading` is `true` whenever data has not been read (`isPending`), never
  `false` with an empty list before a read — `ProductManagerPanel` plans
  destructive deletions against `nodes` once `loading` is false.
- No `useSuspenseQuery`: there is no Suspense boundary under `/project/[id]`.

### D3 — Query keys and entry shapes

| Key | Data | Notes |
|---|---|---|
| `["projects"]` | `ProjectSummary[]` | queryFn awaits `whenHostedAvailabilityKnown()` (the routing provider already does); invalidated when auth resolves signed-in |
| `["project", id, "bundle"]` | `BundleEntry = { bundle: ProjectBundle, etag: string \| null } \| null` | `null` = not found (query data cannot be `undefined`). `etag` is filled by Part 2 |
| `["project", id, "journal", { types: string[] \| null }]` | `JournalEntry = { events: JournalEvent[], etag: string \| null }` | `types` sorted + deduped in the key; `null` = whole journal |
| `["auth", "status"]` | `{ configured, user }` | replaces the six unshared `useAuthStatus` fetches; the queryFn still calls `setHostedAvailable()` |

Selectors: `selectProject(entry) → bundle ?? undefined`, `selectNodes`,
`selectEdges`, `selectJournal`.

### D4 — Freshness policy

`staleTime: 30 s` on project entries (navigation inside the window is a cache
hit with no request; beyond it the cached data paints immediately and a
background refetch runs), `refetchOnWindowFocus: true` (catches agent, CLI and
webhook writes when the tab comes back), `gcTime: 30 min` in memory (24 h
once persisted, Part 4), `retry: 1` and never on a 4xx (`RemoteProviderError`
status < 500). `["auth","status"]`: `staleTime: 60 s`.

### D5 — Writes

- Every hook mutator (`addNode`, `updateNode`, `removeNode(s)`, `addEdge`,
  `removeEdge`, `applyMutations`) calls `provider.applyMutations(projectId,
  ops)` and writes `{ nodes, edges }` back into the bundle entry with
  `setQueryData` (new objects, never in-place — `react-hooks/immutability`).
  `addNode`/`updateNode`/`addEdge` return the entity found in the result (by
  id; edges by `source_id`+`target_id`, since the server normalizes edge ids).
  `syncEdges(next)` is a write-back of `edges` (idempotent after
  `applyMutations`).
- After a write: the bundle entry's `etag` is set to `null` (the next
  revalidation is unconditional — once, not per navigation);
  `["project", id, "journal"]` entries are invalidated with
  `refetchType: "none"` (marked stale; no page re-fetches thousands of events
  after each edit — today's hooks never refreshed the journal after a
  mutation either); `["projects"]` likewise `refetchType: "none"`.
- `useProject.updateProject` keeps its **re-read through the provider before
  `saveProject`** for every provider (local `saveProject` rewrites nodes,
  edges and deletes the journal row when the bundle lacks one; seed replaces
  the whole bundle). It then writes the saved bundle back to the entry, so the
  layout's sidebar (custom maps, products) updates at once — today it stays
  stale until remount.
- **Invalidation seam**: `lib/data/project-queries.ts` exports
  `invalidateProject(projectId)`, `dropProject(projectId)`,
  `invalidateProjects()`, reading the client from a registry
  (`lib/data/query-client.ts: setQueryClient/getQueryClient`, a no-op when
  none is registered, e.g. in Node tests). Call sites that bypass the hooks:
  `components/panels/RawBundlePanel.tsx` (raw save), `lib/utils/export.ts`
  (`importProject`, `importProjectFromFile`, `archiveProject`),
  `app/projects/page.tsx` (create / import / move), `app/project/[id]/settings/page.tsx`
  (archive → `dropProject` + `invalidateProjects`).
- **Local safety net**: `QueryProvider` subscribes to the local provider's
  `subscribeToMutations` and invalidates `["project", projectId]` and
  `["projects"]` (`refetchType: "active"`). It also fires for the hooks' own
  writes; the redundant IndexedDB re-read is cheap and `invalidateQueries`
  cancels an in-flight refetch, so a write-back is never overwritten by an
  older read. Seed and remote providers have no bus; the explicit seams above
  and the server ETag cover them.

Known, pre-existing, out of scope: `RawBundlePanel` on a **hosted** project
saves into IndexedDB under the `prj_` id (routing sends every non-seed import
to the local provider). The invalidation added there refetches the server
bundle and correctly shows no change. Documented as a follow-up, not fixed
here.

### D6 — Conditional GET (server + remote provider)

- **Validator**: one owner-scoped statement, after `getCaller`, same scope as
  `loadProject` (no `archived_at` filter — reads of archived projects stay
  200):
  ```sql
  select p.version::text as version,
         coalesce((select max(e.seq) from graph_events e where e.project_id = p.id), 0)::text as journal_seq
    from graph_projects p
   where p.id = $1 and p.owner_id = any($2::text[])
  ```
  Both values stay **strings** (bigint). `graph_projects.version` alone is
  not enough: `appendJournalEvents` (quality events, Lab Note webhook) never
  bumps it, and the bundle GET folds those events into `quality`.
- **ETag** on every read route (`/projects/{id}`, `/nodes`, `/edges`,
  `/journal`, `/export`): `W/"<version>.<journal_seq>"`. Weak on purpose:
  `If-None-Match` compares weakly, and the write routes' `If-Match` parsers
  (`parseIfMatch`, `classifyIfMatch`) refuse `W/` outright, so a client that
  echoes a read ETag into `If-Match` gets a loud 400/409 rather than a silent
  stale write. Write routes keep their strong `"<version>"` ETags and the JSON
  `version` field (what the CLI builds `If-Match` from) is unchanged.
- **304** only when the request carries `If-None-Match` and it matches
  (comma lists and `*` handled); the response has the ETag,
  `Cache-Control: private, no-cache`, `Vary: Authorization`, no body, and
  **no snapshot load**. 200 responses carry the same headers. The MCP
  remote-store and the CLI never send `If-None-Match`, so they never see a
  304.
- **Cheaper 200s**: `getNodes`/`getEdges` select `snapshot->'nodes'` /
  `snapshot->'edges'`; `getJournal` and `qualityFindingEvents` use the
  validator row as their owner check instead of `loadProject`; the bundle GET
  loads the snapshot **once** (today twice).
- **Pure helpers** in a DB-free module `lib/services/graph/etag.ts`
  (`formatReadEtag`, `ifNoneMatchSatisfied`, `parseJournalTypes`), tested in
  the fast CI job like `restore.ts`.
- **Remote provider**: keeps a per-resource validator memo
  `{ etag, value }` (bounded: one entry per project id / journal selection);
  sends `If-None-Match` when it has one; on 304 returns the memoized object
  (same reference → TanStack's structural sharing short-circuits). Exposed
  through two **optional** `DataProvider` methods,
  `readProject(id, { etag })` and `readJournal(id, { etag, types })`,
  returning `{ status: "fresh", value, etag } | { status: "not-modified" } |
  { status: "missing" }`; the routing provider forwards them; the query layer
  uses them when present and falls back to `getProject`/`getJournal` (local,
  seed) with `etag: null`. `cache: "no-store"` stays: we validate ourselves,
  the browser HTTP cache would only double-store.
- Rewrite the "NO LOCAL CACHE" paragraph in `remote-provider.ts`: a read
  cache with server-validated freshness is not the replay queue it warns
  against; writes remain online-only.

### D7 — Journal projection

- `GET …/journal?types=a,b` (comma-separated; also repeatable) filters with
  `event->>'type' = any($2::text[])` in server `seq` order; unknown types
  match nothing; no `?types=` = whole journal. Response shape unchanged
  (`{ journal }`). The ETag is the whole-journal validator (superset
  invalidation, one aggregate). `/export` never projects.
- Migration `db/migrations/011_graph_events_type_index.sql`:
  `create index if not exists graph_events_project_type_seq_idx on graph_events (project_id, (event->>'type'), seq)` — idempotent like its siblings, also serves `qualityFindingEvents` and the two GitHub queries.
- `DataProvider.getJournal(projectId, options?: { types?: readonly string[] })`
  (source-compatible); local and seed filter in memory; routing forwards.
- `useJournal(projectId, options?: { types })`. Consumers:

| Surface | Reads | Journal query |
|---|---|---|
| Changelog | `deliverable.shipped`, `release.tagged` | projection |
| Design | `idea.proposed`, `request.filed`, `node.status_changed`, `decision.status_changed` | projection |
| Decisions (`DecisionLog`) | `node.created` | projection |
| Overview | whole-journal counts (`journalEventCount`, `eventCount` per release) | whole journal (unchanged gating; a server aggregate is a follow-up) |
| History | everything | whole journal |
| Node panel History section | every scalar-`node_id` type + `edge.*` | whole journal, **read by the section itself** via `useJournal(projectId)`, lazily on mount |
| Maps, Library, Delivery, Acceptances | nothing | **no journal request** |

- `PageShell`/`ProjectPanels`/`NodeDetailPanel` replace the `journal?:
  JournalEvent[]` prop with `history?: boolean` (mount the History section or
  not). Pages that passed `journal={journal}` pass `history`; Overview keeps
  passing nothing (its panels have no History today). The section shows a
  one-line loading state while its query is pending.
- Empty-state gates that read `journal.length === 0` on the projected pages
  get sentences that are true for a subset ("No releases tagged yet, and
  nothing shipped since." already exists on the changelog).
- All projections re-sort with `orderEvents`; `DecisionLog` walks in array
  order, which server `seq` order preserves.

### D8 — ELK in a worker

- `lib/utils/elk.worker.ts` = `import "elkjs/lib/elk-worker.min.js";`;
  `lib/utils/elk-engine.ts` = `getElkEngine()`: lazy memoized singleton,
  browser-guarded (`typeof Worker !== "undefined"`), built from
  `elkjs/lib/elk-api.js` with
  `workerFactory: () => new Worker(new URL("./elk.worker.ts", import.meta.url))`
  (classic worker, no `type: "module"` — verified to compile under Turbopack
  dev and prod; also the documented webpack 5 form). Fallback:
  `await import("elkjs/lib/elk.bundled.js")` (dynamic, so the 1.6 MB engine
  leaves the main graph) when `Worker` is missing, construction throws, or
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

### D9 — Persistence

- `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister`
  over a **separate** Dexie database `arkaik-query-cache` (`entries: "key"`)
  — bumping the canonical `arkaik` DB would close other tabs and sit every
  cache read behind the open-time migration sweeps.
- Persist only successful `["project", id, …]` entries whose id
  `isHostedProjectId` (local projects already live in IndexedDB; the seed's
  "refresh is the reset" contract must hold). `maxAge: 24 h`, `gcTime: 24 h`
  for hosted entries, `buster = "v1:" + CURRENT_SCHEMA_VERSION`.
- Restored entries are stale by construction (`dataUpdatedAt` old) → refetch
  on mount with `If-None-Match` from the persisted `etag` → 304 when
  unchanged. Restoration is asynchronous, so the hydrating render stays
  data-free (`useProductScope`'s `useSyncExternalStore` reasoning holds).
- On sign-out (`AuthButton`): `queryClient.clear()` and
  `persister.removeClient()`.

## Parts (one commit each, in order)

1. **Query cache behind the hooks** — deps, `QueryProvider`, `query-client.ts`,
   `project-queries.ts`, the five hooks (+ `useAuthStatus`), invalidation
   seams at the bypass sites, tests (`tests/data/project-queries.test.js`,
   wired into `package.json`, `ci.yml`, `.gitignore`), `docs/conventions.md`
   amendment. Entry shapes already carry `etag: null`.
2. **Conditional GETs and the journal projection** — `etag.ts`, validator
   query, read routes, `read-route.ts`, store SQL, migration 011,
   `getJournal` options, `readProject`/`readJournal`, remote provider memo,
   `useJournal` options, panel History self-read, page changes, tests
   (`tests/services/graph-etag.test.js`, `graph-api.test.js` additions,
   remote-provider conditional test).
3. **ELK worker** — `elk.worker.ts`, `elk-engine.ts`, `elk-layout.ts`.
4. **Persistence** — persister, Dexie cache DB, provider wiring, sign-out
   clear.
5. **Docs** — `docs/data-layer.md`, `docs/architecture.md`,
   `docs/hosted-projects.md`, `docs/spec/services.md` § Hosted Graph API read
   contract, this plan's "Lessons learned".

Each part passes `npm run lint`, `npx tsc --noEmit`, `npm run build`, the
affected `test:*` scripts (sequentially — several share
`packages/schema/.test-build/`), and `npm run generate` drift (a new
`lucide-react` icon import changes generated files).

## Verification plan

- Unit: `project-queries` (one provider read serves two consumers; write-back
  without refetch; invalidation seams no-op without a client; journal key
  normalization), `graph-etag` (format, weak comparison, lists, `*`, types
  parsing), remote provider conditional reads (injected `fetchImpl` answering
  304 → same reference, 200 → new value + etag).
- Integration (`tests/services/graph-api.test.js`, Postgres): ETag format on
  every read route; 304 on match; a quality-event append without a version
  bump flips the ETag; `?types=` filters and keeps order; `/export` ignores
  `?types=`.
- Manual (browser): Journey map on a hosted project shows one bundle request
  per navigation and none for the journal; changelog shows one projection
  request; ELK chunk loads as a worker (Network tab); reload paints from the
  persisted cache and issues a 304.

## Follow-ups (not in this stack)

- Overview: a server-side journal aggregate (`total`, events per release) so
  the project's landing page stops needing the whole journal.
- History page: server pagination by `seq`.
- Hosted mutation responses already carry `events`; append them to the cached
  journal instead of marking it stale.
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
suggested:
  molecule: arkaik
  type: improvement
  tags: [performance]
```

## Lessons learned

_(filled in after the parts land)_

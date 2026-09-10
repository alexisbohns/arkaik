#!/usr/bin/env node

/**
 * The query cache behind the data hooks (lib/data/project-queries.ts +
 * lib/data/query-client.ts) — the verification list of
 * docs/superpowers/plans/2026-09-10-reactive-data-layer.md, against the real
 * TanStack core:
 *
 *  - one provider read serves every consumer of a project entry;
 *  - a write-back lands without a refetch;
 *  - a write-back survives a slower read that started before it — for the
 *    journal projections too, and a cancelled first load is re-issued for
 *    its observer instead of stranding it;
 *  - a cache fetch overlapping a write-back resolves with the reverted
 *    snapshot (why `updateProject` reads the provider directly);
 *  - the version guard drops an older response, for `syncEdges` too;
 *  - the reducers are immutable, keep unchanged siblings' identity, and
 *    no-op on an absent or not-found entry;
 *  - an event append respects each journal projection's `types`;
 *  - the loading/error mapping after success → failed refetch → refetch;
 *  - a warm refetch that changes nothing notifies an observer zero times;
 *  - the invalidation seams are harmless without a browser client;
 *  - the local mutation bus invalidates the right entries;
 *  - a conditional read sends the stored validator, and a 304 keeps the
 *    previous entry BY REFERENCE while a fresh one replaces it.
 */

const fs = require("fs");
const { loadProjectQueries, BUILD_DIR } = require("./load-project-queries");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ISO = "2026-01-01T00:00:00.000Z";

function makeNode(id, projectId, title = id) {
  return { id, project_id: projectId, species: "view", title, status: "idea", platforms: ["web"] };
}

function makeBundle(projectId, nodes, edges = []) {
  return {
    schema_version: 3,
    project: { id: projectId, title: `Project ${projectId}`, created_at: ISO, updated_at: ISO, archived_at: null },
    nodes,
    edges,
    quality: { findings: [] },
  };
}

function makeEvent(id, type) {
  return { id, ts: ISO, actor: "arkaik-app", type, v: 1 };
}

/** A `DataProvider` fake exposing only the reads the cache issues, with counters. */
function makeProvider(overrides = {}) {
  const fake = {
    reads: { project: 0, journal: 0, list: 0 },
    getProject: async () => undefined,
    getJournal: async () => [],
    listProjects: async () => [],
    ...overrides,
  };
  const wrap = (name, counter) => {
    const inner = fake[name];
    fake[name] = (...args) => {
      fake.reads[counter]++;
      return inner(...args);
    };
  };
  wrap("getProject", "project");
  wrap("getJournal", "journal");
  wrap("listProjects", "list");
  return fake;
}

async function main() {
  const { queries, queryClient, remote, core, setProvider, notifyLocalMutation, localListenerCount } =
    loadProjectQueries();
  const {
    projectsKey,
    projectKey,
    bundleKey,
    journalKey,
    bundleQueryOptions,
    journalQueryOptions,
    projectsQueryOptions,
    selectNodes,
    selectEdges,
    selectProject,
    selectJournal,
    EMPTY_NODES,
    EMPTY_EDGES,
    EMPTY_JOURNAL,
    deriveLoadState,
    withGraph,
    withEdges,
    withBundle,
    withAppendedEvents,
    writeBackGraph,
    writeBackEdges,
    writeBackBundle,
    invalidateProject,
    invalidateProjects,
    subscribeLocalMutationsToCache,
  } = queries;
  const { createQueryClient, getQueryClient, setQueryClientForTests } = queryClient;
  const { QueryObserver, isCancelledError } = core;

  // Every entry arms a 30-minute gc timer that would keep Node alive after the
  // last assertion, so each client is cleared on the way out.
  const clients = [];
  const newClient = () => {
    const client = createQueryClient();
    clients.push(client);
    return client;
  };

  // --- keys -----------------------------------------------------------------
  {
    check("projectsKey is [\"projects\"]", JSON.stringify(projectsKey()) === '["projects"]');
    check("bundleKey extends projectKey", JSON.stringify(bundleKey("p")) === '["project","p","bundle"]');
    check(
      "journalKey sorts and dedupes its types",
      JSON.stringify(journalKey("p", ["b", "a", "a"])) === JSON.stringify(journalKey("p", ["a", "b"])),
      JSON.stringify(journalKey("p", ["b", "a", "a"])),
    );
    check("journalKey carries null for the whole journal", JSON.stringify(journalKey("p", null)[3]) === '{"types":null}');
    check(
      "projectKey is a prefix of both",
      JSON.stringify(bundleKey("p").slice(0, 2)) === JSON.stringify(projectKey("p")) &&
        JSON.stringify(journalKey("p", null).slice(0, 2)) === JSON.stringify(projectKey("p")),
    );
  }

  // --- client policy --------------------------------------------------------
  {
    const client = newClient();
    const { retry, staleTime, gcTime, refetchOnWindowFocus } = client.getDefaultOptions().queries;
    check("project entries are fresh for 30 s", staleTime === 30_000, String(staleTime));
    check("entries survive 30 min unobserved", gcTime === 30 * 60_000, String(gcTime));
    check("refetch on window focus is on", refetchOnWindowFocus === true);
    check("one retry on a plain error", retry(0, new Error("boom")) === true && retry(1, new Error("boom")) === false);
    check("never retries a 4xx", retry(0, new remote.RemoteProviderError(404, null, "nope")) === false);
    check("retries a 5xx once", retry(0, new remote.RemoteProviderError(503, null, "down")) === true);
    check("projects list is fresh for 60 s", projectsQueryOptions().staleTime === 60_000);
  }

  // --- one read serves two consumers ------------------------------------------
  {
    const client = newClient();
    const bundle = makeBundle("p1", [makeNode("V-a", "p1")]);
    const provider = makeProvider({ getProject: async (id) => (id === "p1" ? structuredClone(bundle) : undefined) });
    setProvider(provider);

    const [a, b] = await Promise.all([client.fetchQuery(bundleQueryOptions("p1")), client.fetchQuery(bundleQueryOptions("p1"))]);
    check("two concurrent fetchQuery calls issue one provider read", provider.reads.project === 1, String(provider.reads.project));
    check("both consumers get the same entry", a === b && a.bundle.nodes[0].id === "V-a");
    check("the entry carries no validator yet", a.version === null && a.etag === null);

    const c = await client.fetchQuery(bundleQueryOptions("p1"));
    check("a later read inside the fresh window is a cache hit", provider.reads.project === 1 && c === a);

    check("selectNodes projects the entry", selectNodes(a) === a.bundle.nodes);
    check("selectEdges projects the entry", selectEdges(a) === a.bundle.edges);
    check("selectProject projects the entry", selectProject(a) === a.bundle);
    check(
      "the selectors answer the module-level empties for a missing entry",
      selectNodes(null) === EMPTY_NODES &&
        selectNodes(undefined) === EMPTY_NODES &&
        selectEdges(null) === EMPTY_EDGES &&
        selectJournal(null) === EMPTY_JOURNAL &&
        selectProject(null) === undefined,
    );

    const missing = await client.fetchQuery(bundleQueryOptions("nope"));
    check("a project the provider does not know is a null entry, not undefined", missing === null);
    const readsBeforeWrites = provider.reads.project;

    // --- write-back without refetch ---
    // Identity is compared per node, not per array: `setQueryData` runs
    // structural sharing, so the cached array is a copy in which every
    // unchanged node keeps its identity — the property downstream memos need.
    const ids = (list) => list.map((item) => item.id).join(",");
    client.setQueryData(projectsKey(), []);
    client.setQueryData(journalKey("p1", null), { events: [], etag: null });
    const next = [makeNode("V-a", "p1"), makeNode("V-b", "p1")];
    const appended = [makeEvent("evt-1", "node.created")];
    await writeBackGraph(client, "p1", { nodes: next, edges: [], events: appended });
    const entry = client.getQueryData(bundleKey("p1"));
    check("writeBackGraph adopts the mutation's nodes", ids(entry.bundle.nodes) === "V-a,V-b", ids(entry.bundle.nodes));
    check("structural sharing keeps an unchanged node's identity across the write-back", entry.bundle.nodes[0] === a.bundle.nodes[0]);
    check("writeBackGraph issues no provider read", provider.reads.project === readsBeforeWrites, String(provider.reads.project));
    check("writeBackGraph keeps the untouched project object", entry.bundle.project === a.bundle.project);
    check("writeBackGraph marks the listing stale", client.getQueryState(projectsKey()).isInvalidated === true);
    check("writeBackGraph does not refetch the listing", provider.reads.list === 0);
    check(
      "writeBackGraph appends the returned events to the cached journal",
      client.getQueryData(journalKey("p1", null)).events[0] === appended[0],
    );
    check("the journal entry was not invalidated when events were appended", client.getQueryState(journalKey("p1", null)).isInvalidated === false);

    const edgesOnly = [{ id: "e-a-b", project_id: "p1", source_id: "V-a", target_id: "V-b", type: "composes" }];
    await writeBackEdges(client, "p1", edgesOnly);
    const afterEdges = client.getQueryData(bundleKey("p1"));
    check("writeBackEdges replaces the edges alone", ids(afterEdges.bundle.edges) === "e-a-b" && afterEdges.bundle.nodes === entry.bundle.nodes);

    const saved = { ...afterEdges.bundle, project: { ...afterEdges.bundle.project, title: "Renamed" } };
    await writeBackBundle(client, "p1", saved);
    const afterSave = client.getQueryData(bundleKey("p1"));
    check("writeBackBundle replaces the whole bundle", afterSave.bundle.project.title === "Renamed" && afterSave.bundle.edges === afterEdges.bundle.edges);
    check("writeBackBundle still issued no provider read", provider.reads.project === readsBeforeWrites, String(provider.reads.project));
  }

  // --- cancel-then-write-back survives a slow read ------------------------------
  {
    const client = newClient();
    const stale = makeBundle("p1", [makeNode("V-old", "p1")]);
    let releaseRead;
    const provider = makeProvider({ getProject: () => new Promise((resolve) => { releaseRead = resolve; }) });
    setProvider(provider);

    const slow = client.fetchQuery({ ...bundleQueryOptions("p1"), staleTime: 0 }).catch((err) => err);
    await tick();
    check("the slow read is in flight", client.getQueryState(bundleKey("p1")).fetchStatus === "fetching");

    const fresh = [makeNode("V-new", "p1")];
    await writeBackGraph(client, "p1", { nodes: fresh, edges: [] });
    check("a write-back with no entry to patch leaves the cache empty rather than inventing one", client.getQueryData(bundleKey("p1")) === undefined);

    releaseRead(stale);
    const settled = await slow;
    await tick();
    check("the cancelled read rejects with a CancelledError", isCancelledError(settled), String(settled));
    check("the late read did not land after the write-back", client.getQueryData(bundleKey("p1")) === undefined);
    check("the cancelled read left the entry idle", client.getQueryState(bundleKey("p1")).fetchStatus === "idle");

    // The realistic case: an entry exists, a background refetch starts, a
    // mutation lands during it. The refetch is torn down; the write-back wins.
    const client2 = newClient();
    setProvider(makeProvider({ getProject: async () => structuredClone(stale) }));
    await client2.fetchQuery(bundleQueryOptions("p1"));
    let release2;
    const slowProvider = makeProvider({ getProject: () => new Promise((resolve) => { release2 = resolve; }) });
    setProvider(slowProvider);
    const refetch = client2.refetchQueries({ queryKey: bundleKey("p1") });
    await tick();
    check("the background refetch is in flight", slowProvider.reads.project === 1 && client2.getQueryState(bundleKey("p1")).fetchStatus === "fetching");
    await writeBackGraph(client2, "p1", { nodes: fresh, edges: [] });
    release2(makeBundle("p1", [makeNode("V-stale-again", "p1")]));
    await refetch;
    await tick();
    const after = client2.getQueryData(bundleKey("p1"));
    check(
      "a write-back during a background refetch survives the refetch's late answer",
      after.bundle.nodes.length === 1 && after.bundle.nodes[0].id === "V-new",
      JSON.stringify(after.bundle.nodes.map((n) => n.id)),
    );
    check("the torn-down refetch was not restarted", slowProvider.reads.project === 1, String(slowProvider.reads.project));

    // The journal gets the same protection: a journal refetch that started
    // before the mutation (a focus) must not land after the append with the
    // pre-mutation list — a fetch success would also stamp it fresh.
    const client3 = newClient();
    const ev1 = makeEvent("ev1", "node.created");
    const ev2 = makeEvent("ev2", "node.renamed");
    setProvider(makeProvider({ getProject: async () => structuredClone(stale), getJournal: async () => [ev1] }));
    await client3.fetchQuery(bundleQueryOptions("p1"));
    await client3.fetchQuery(journalQueryOptions("p1", null));
    let releaseJournal;
    const slowJournal = makeProvider({
      getProject: async () => structuredClone(stale),
      getJournal: () => new Promise((resolve) => { releaseJournal = resolve; }),
    });
    setProvider(slowJournal);
    const journalRefetch = client3.refetchQueries({ queryKey: journalKey("p1", null) });
    await tick();
    check("a journal refetch is in flight", slowJournal.reads.journal === 1 && client3.getQueryState(journalKey("p1", null)).fetchStatus === "fetching");
    await writeBackGraph(client3, "p1", { nodes: fresh, edges: [], events: [ev2] });
    releaseJournal([ev1]);
    await journalRefetch;
    await tick();
    const journalAfter = client3.getQueryData(journalKey("p1", null));
    check(
      "an appended event survives a journal refetch's late pre-mutation answer",
      journalAfter.events.map((e) => e.id).join(",") === "ev1,ev2",
      journalAfter.events.map((e) => e.id).join(","),
    );
    check("the cancelled journal refetch left the entry idle", client3.getQueryState(journalKey("p1", null)).fetchStatus === "idle");
    check("the journal refetch was not restarted (it had data)", slowJournal.reads.journal === 1, String(slowJournal.reads.journal));

    // The events-undefined branch: the stale mark must survive the late answer too.
    const refetchAgain = client3.refetchQueries({ queryKey: journalKey("p1", null) });
    await tick();
    await writeBackGraph(client3, "p1", { nodes: fresh, edges: [] });
    check("a result without events marks the journal stale", client3.getQueryState(journalKey("p1", null)).isInvalidated === true);
    releaseJournal([ev1]);
    await refetchAgain;
    await tick();
    check("…and the late answer does not clear the stale mark", client3.getQueryState(journalKey("p1", null)).isInvalidated === true);
    check("…nor replace the appended list", client3.getQueryData(journalKey("p1", null)).events.length === 2);

    // A journal projection in its FIRST fetch, with an observer mounted: the
    // cancel reverts it to pending/idle, so the write-back must ask it to
    // read again — and only the second (post-commit) answer may land.
    const client4 = newClient();
    const journalReleases = [];
    const firstLoad = makeProvider({ getJournal: () => new Promise((resolve) => { journalReleases.push(resolve); }) });
    setProvider(firstLoad);
    const journalObserver = new QueryObserver(client4, journalQueryOptions("p1", null));
    const stopJournal = journalObserver.subscribe(() => {});
    await tick();
    check("the first journal read is in flight", firstLoad.reads.journal === 1);
    await writeBackGraph(client4, "p1", { nodes: fresh, edges: [], events: [ev2] });
    await tick();
    check("a write-back during a journal first load re-issues the read for its observer", firstLoad.reads.journal === 2, String(firstLoad.reads.journal));
    journalReleases[0]([ev1]);
    await tick();
    check("the cancelled first answer does not land", client4.getQueryData(journalKey("p1", null)) === undefined);
    journalReleases[1]([ev1, ev2]);
    await tick();
    const landed = journalObserver.getCurrentResult();
    check(
      "the post-commit answer lands and the observer settles",
      landed.status === "success" && landed.data.events.map((e) => e.id).join(",") === "ev1,ev2",
      JSON.stringify(landed.status),
    );
    stopJournal();

    // The same for the bundle: an observer mounted during the first load
    // must not be stranded `loading` by the write-back's cancel.
    const client5 = newClient();
    const bundleReleases = [];
    const firstBundle = makeProvider({ getProject: () => new Promise((resolve) => { bundleReleases.push(resolve); }) });
    setProvider(firstBundle);
    const bundleObserver = new QueryObserver(client5, bundleQueryOptions("p1"));
    const stopBundle = bundleObserver.subscribe(() => {});
    await tick();
    await writeBackGraph(client5, "p1", { nodes: fresh, edges: [] });
    await tick();
    check("a write-back during a bundle first load re-issues the read for its observer", firstBundle.reads.project === 2, String(firstBundle.reads.project));
    check("…and the observer is fetching again, not stranded", bundleObserver.getCurrentResult().fetchStatus === "fetching");
    bundleReleases[0](stale);
    await tick();
    check("the cancelled first bundle answer does not land", client5.getQueryData(bundleKey("p1")) === undefined);
    bundleReleases[1](makeBundle("p1", [makeNode("V-post-commit", "p1")]));
    await tick();
    const bundleLanded = bundleObserver.getCurrentResult();
    check(
      "the post-commit bundle answer lands and the observer settles",
      bundleLanded.status === "success" && bundleLanded.data.bundle.nodes[0].id === "V-post-commit",
      bundleLanded.status,
    );
    await writeBackEdges(client5, "p1", [], "1");
    check("writeBackEdges with an entry present issues no read", firstBundle.reads.project === 2);
    stopBundle();

    // Why `updateProject` reads the provider, not the entry: a cache fetch
    // cancelled by a write-back does not reject — query-core answers a
    // revert-cancel with the REVERTED `state.data`, the pre-mutation snapshot.
    const client6 = newClient();
    setProvider(makeProvider({ getProject: async () => makeBundle("p1", []) }));
    await client6.fetchQuery(bundleQueryOptions("p1"));
    let releaseBase;
    setProvider(makeProvider({ getProject: () => new Promise((resolve) => { releaseBase = resolve; }) }));
    const base = client6.fetchQuery({ ...bundleQueryOptions("p1"), staleTime: 0 });
    await tick();
    await writeBackGraph(client6, "p1", { nodes: [makeNode("V-x", "p1")], edges: [] });
    releaseBase(makeBundle("p1", []));
    const handed = await base;
    check(
      "a cache fetch overlapping a write-back resolves with the reverted pre-mutation snapshot (the trap)",
      handed.bundle.nodes.length === 0 && client6.getQueryData(bundleKey("p1")).bundle.nodes[0].id === "V-x",
    );
  }

  // --- version guard --------------------------------------------------------------
  {
    const client = newClient();
    const bundle = makeBundle("p2", [makeNode("V-a", "p2")]);
    const seeded = { bundle, version: "10", etag: "W/\"10\"" };
    client.setQueryData(bundleKey("p2"), seeded);

    await writeBackGraph(client, "p2", { nodes: [makeNode("V-older", "p2")], edges: [], version: "9" });
    check("an older server version is dropped, entry untouched", client.getQueryData(bundleKey("p2")) === seeded);

    const newer = [makeNode("V-newer", "p2")];
    await writeBackGraph(client, "p2", { nodes: newer, edges: [], version: "11" });
    const after = client.getQueryData(bundleKey("p2"));
    check("a newer server version is adopted", after.bundle.nodes[0].id === "V-newer" && after.version === "11");
    check("a write-back drops the read validator", after.etag === null);

    await writeBackGraph(client, "p2", { nodes: [makeNode("V-local", "p2")], edges: [] });
    check("a result without a version keeps the entry's version", client.getQueryData(bundleKey("p2")).version === "11");

    await writeBackGraph(client, "p2", { nodes: [makeNode("V-big", "p2")], edges: [], version: "9007199254740993" });
    check("versions compare as bigints, not floats", client.getQueryData(bundleKey("p2")).version === "9007199254740993");
    await writeBackGraph(client, "p2", { nodes: [makeNode("V-bigger", "p2")], edges: [], version: "9007199254740992" });
    check("an older bigint version is dropped even past 2^53", client.getQueryData(bundleKey("p2")).bundle.nodes[0].id === "V-big");

    // `syncEdges` after two out-of-order hosted responses: B (v6, detached)
    // lands before A (v5, attached). A's graph is refused; A's edge list,
    // forwarded with A's version, must be refused too.
    const client2 = newClient();
    const eAX = { id: "e-A-X", project_id: "p2", source_id: "A", target_id: "X", edge_type: "covers" };
    client2.setQueryData(bundleKey("p2"), { bundle: makeBundle("p2", []), version: "4", etag: null });
    await writeBackGraph(client2, "p2", { nodes: [], edges: [], version: "6" });
    await writeBackGraph(client2, "p2", { nodes: [], edges: [eAX], version: "5" });
    const guarded = client2.getQueryData(bundleKey("p2"));
    check("the older graph is refused", guarded.bundle.edges.length === 0 && guarded.version === "6");
    await writeBackEdges(client2, "p2", [eAX], "5");
    check("writeBackEdges refuses the older response's edge list", client2.getQueryData(bundleKey("p2")) === guarded);
    await writeBackEdges(client2, "p2", [eAX], "7");
    const adopted = client2.getQueryData(bundleKey("p2"));
    check("writeBackEdges adopts a newer edge list and its version", adopted.bundle.edges[0].id === "e-A-X" && adopted.version === "7");
    await writeBackEdges(client2, "p2", []);
    check("writeBackEdges without a version adopts (local, seed) and keeps the version", client2.getQueryData(bundleKey("p2")).bundle.edges.length === 0 && client2.getQueryData(bundleKey("p2")).version === "7");
  }

  // --- reducers -------------------------------------------------------------------
  {
    const bundle = makeBundle("p", [makeNode("V-a", "p")], []);
    const entry = { bundle, version: "3", etag: "x" };
    const frozen = JSON.stringify(entry);

    const nodes = [makeNode("V-b", "p")];
    const edges = [];
    const next = withGraph(entry, { nodes, edges });
    check("withGraph returns a new entry and a new bundle", next !== entry && next.bundle !== entry.bundle);
    check("withGraph keeps project and quality identity", next.bundle.project === bundle.project && next.bundle.quality === bundle.quality);
    check("withGraph adopts both arrays", next.bundle.nodes === nodes && next.bundle.edges === edges);
    check("withGraph does not mutate its input", JSON.stringify(entry) === frozen);
    check("withGraph no-ops on undefined", withGraph(undefined, { nodes, edges }) === undefined);
    check("withGraph no-ops on null", withGraph(null, { nodes, edges }) === null);

    const e2 = withEdges(entry, edges);
    check("withEdges returns new objects, keeps nodes and version", e2 !== entry && e2.bundle !== bundle && e2.bundle.nodes === bundle.nodes && e2.version === "3" && e2.etag === null);
    check("withEdges no-ops on undefined and null", withEdges(undefined, edges) === undefined && withEdges(null, edges) === null);
    check("withEdges refuses an older version", withEdges(entry, edges, "2") === entry);
    check("withEdges adopts a newer version", withEdges(entry, edges, "4").version === "4");

    const replaced = makeBundle("p", []);
    const b2 = withBundle(entry, replaced);
    check("withBundle replaces the bundle, keeps the version, drops the etag", b2.bundle === replaced && b2.version === "3" && b2.etag === null);
    check("withBundle builds an entry even without one to patch", withBundle(undefined, replaced).bundle === replaced && withBundle(undefined, replaced).version === null);

    const journal = { events: [makeEvent("e1", "node.created")], etag: "j" };
    const events = [makeEvent("e2", "edge.added"), makeEvent("e3", "node.deleted")];
    const j2 = withAppendedEvents(journal, events, null);
    check("withAppendedEvents returns a new entry with events in append order", j2 !== journal && j2.events.length === 3 && j2.events[1].id === "e2" && j2.events[2].id === "e3");
    check("withAppendedEvents does not mutate its input", journal.events.length === 1 && journal.etag === "j");
    check("withAppendedEvents drops the read validator", j2.etag === null);
    check("withAppendedEvents no-ops on undefined and null", withAppendedEvents(undefined, events, null) === undefined && withAppendedEvents(null, events, null) === null);
    check("withAppendedEvents returns the same entry when nothing is admitted", withAppendedEvents(journal, events, ["release.tagged"]) === journal);
    check("withAppendedEvents skips events the entry already holds", withAppendedEvents(journal, [makeEvent("e1", "node.created")], null) === journal);
    const typed = withAppendedEvents(journal, events, ["node.deleted"]);
    check("withAppendedEvents admits only the projection's types", typed.events.length === 2 && typed.events[1].id === "e3");
  }

  // --- event append respects each cached projection -------------------------------
  {
    const client = newClient();
    const provider = makeProvider();
    setProvider(provider);
    client.setQueryData(bundleKey("p3"), { bundle: makeBundle("p3", []), version: null, etag: null });
    client.setQueryData(journalKey("p3", null), { events: [], etag: null });
    client.setQueryData(journalKey("p3", ["node.created"]), { events: [], etag: null });
    client.setQueryData(journalKey("p3", ["edge.added", "release.tagged"]), { events: [], etag: null });
    client.setQueryData(journalKey("other", null), { events: [], etag: null });

    const events = [makeEvent("e1", "node.created"), makeEvent("e2", "edge.removed")];
    await writeBackGraph(client, "p3", { nodes: [], edges: [], events });
    const whole = client.getQueryData(journalKey("p3", null));
    const created = client.getQueryData(journalKey("p3", ["node.created"]));
    const unrelated = client.getQueryData(journalKey("p3", ["release.tagged", "edge.added"]));
    check("the whole-journal entry gains both events", whole.events.length === 2 && whole.events[0].id === "e1");
    check("a typed entry gains only the events it admits", created.events.length === 1 && created.events[0].id === "e1");
    check("a projection none of the events match is left alone", unrelated.events.length === 0);
    check("another project's journal is untouched", client.getQueryData(journalKey("other", null)).events.length === 0);
    check("no journal read was issued", provider.reads.journal === 0);

    await writeBackGraph(client, "p3", { nodes: [], edges: [] });
    check(
      "a result without events marks every journal projection stale",
      client.getQueryState(journalKey("p3", null)).isInvalidated === true &&
        client.getQueryState(journalKey("p3", ["node.created"])).isInvalidated === true,
    );
    check("…without refetching it", provider.reads.journal === 0);
    check("…and leaves other projects alone", client.getQueryState(journalKey("other", null)).isInvalidated === false);

    const j = await client.fetchQuery(journalQueryOptions("p3", null));
    check("the journal read goes to the provider once invalidated and asked", provider.reads.journal === 1 && Array.isArray(j.events) && j.etag === null);
  }

  // --- loading / error mapping --------------------------------------------------
  {
    const data = { bundle: makeBundle("p", []), version: null, etag: null };
    const err = new Error("boom");
    const map = (s) => deriveLoadState({ isPending: false, isError: false, isFetching: false, data: undefined, error: null, ...s });

    let r = map({ isPending: true });
    check("pending → loading, no error", r.loading === true && r.error === null);
    r = map({ data });
    check("success → not loading, no error", r.loading === false && r.error === null);
    r = map({ data, isError: true, error: err });
    check("failed background refetch over data → not loading, no error (stale-while-error)", r.loading === false && r.error === null);
    r = map({ data, isError: true, isFetching: true, error: err });
    check("refetch in flight after a failed refetch over data → not loading, no error", r.loading === false && r.error === null);
    r = map({ isError: true, isFetching: true, error: err });
    check("no data + error + fetching → loading (a retry looks like a load)", r.loading === true && r.error === null);
    r = map({ isError: true, error: err });
    check("no data + error + idle → the error's message", r.loading === false && r.error === "boom");
    r = deriveLoadState({ isPending: false, isError: true, isFetching: false, data: undefined, error: "not an Error" }, "Failed to load nodes");
    check("a non-Error failure reports the fallback message", r.error === "Failed to load nodes");
    r = map({ data: null });
    check("a not-found (null) entry is neither loading nor an error", r.loading === false && r.error === null);

    // Tracked-property discipline: on the success path the mapping must not
    // touch `isFetching`, or a warm refetch would notify every consumer.
    const touched = new Set();
    const spy = new Proxy(
      { isPending: false, isError: false, isFetching: true, data, error: null },
      { get: (target, key) => { touched.add(key); return target[key]; } },
    );
    deriveLoadState(spy);
    check("the success path never reads isFetching", !touched.has("isFetching"), [...touched].join(","));
  }

  // --- zero notifications on a warm no-change refetch ------------------------------
  {
    const client = newClient();
    const bundle = makeBundle("p4", [makeNode("V-a", "p4")], []);
    let answer = bundle;
    const provider = makeProvider({ getProject: async () => structuredClone(answer) });
    setProvider(provider);
    await client.fetchQuery(bundleQueryOptions("p4"));

    const observer = new QueryObserver(client, { ...bundleQueryOptions("p4"), select: selectNodes });
    let notifications = 0;
    const unsubscribe = observer.subscribe(() => { notifications++; });
    // Read exactly what the hooks read, in their order, so only those
    // properties are tracked.
    const tracked = observer.trackResult(observer.getCurrentResult());
    const before = deriveLoadState(tracked);
    const nodesBefore = tracked.data;
    const entryBefore = client.getQueryData(bundleKey("p4"));
    check("the observer starts settled", before.loading === false && before.error === null && nodesBefore.length === 1);

    await client.refetchQueries({ queryKey: bundleKey("p4") });
    check("a warm refetch that changes nothing issues a read", provider.reads.project === 2);
    check("…but notifies the observer zero times", notifications === 0, String(notifications));
    check("…and keeps the nodes array identity", observer.getCurrentResult().data === nodesBefore);
    check("…and the entry identity", client.getQueryData(bundleKey("p4")) === entryBefore);

    answer = makeBundle("p4", [makeNode("V-a", "p4", "Renamed")], []);
    await client.refetchQueries({ queryKey: bundleKey("p4") });
    check("a refetch that changes the data notifies", notifications === 1, String(notifications));
    check("…with a new nodes array", observer.getCurrentResult().data !== nodesBefore);
    unsubscribe();

    // The tracked set must not be empty, or TanStack notifies on every change.
    const untracked = new QueryObserver(client, { ...bundleQueryOptions("p4"), select: selectNodes });
    let noisy = 0;
    const stop = untracked.subscribe(() => { noisy++; });
    await client.refetchQueries({ queryKey: bundleKey("p4") });
    stop();
    check("control: an observer that tracks nothing is notified by isFetching alone", noisy > 0, String(noisy));
  }

  // --- seams without a browser client ------------------------------------------------
  {
    const client = newClient();
    setProvider(makeProvider());
    client.setQueryData(bundleKey("p1"), { bundle: makeBundle("p1", []), version: null, etag: null });
    client.setQueryData(journalKey("p1", null), { events: [], etag: null });
    client.setQueryData(projectsKey(), []);

    setQueryClientForTests(null);
    check("off the browser, getQueryClient hands out a fresh client per call", getQueryClient() !== getQueryClient());
    let threw = false;
    try {
      await invalidateProject("p1");
      await invalidateProjects();
    } catch (err) {
      threw = true;
    }
    check("the seams resolve without a browser client", threw === false);
    check(
      "…and touch nothing in a client they were not handed",
      client.getQueryState(bundleKey("p1")).isInvalidated === false && client.getQueryState(projectsKey()).isInvalidated === false,
    );

    setQueryClientForTests(client);
    check("the test override is what getQueryClient answers", getQueryClient() === client);
    await invalidateProject("p1", { refetchType: "none" });
    check(
      "invalidateProject marks the bundle and every journal projection stale",
      client.getQueryState(bundleKey("p1")).isInvalidated === true && client.getQueryState(journalKey("p1", null)).isInvalidated === true,
    );
    check("invalidateProject leaves the listing alone", client.getQueryState(projectsKey()).isInvalidated === false);
    await invalidateProjects();
    check("invalidateProjects marks the listing stale", client.getQueryState(projectsKey()).isInvalidated === true);
    setQueryClientForTests(null);
  }

  // --- the local mutation bus ----------------------------------------------------------
  {
    const client = newClient();
    setProvider(makeProvider());
    const seed = (id) => {
      client.setQueryData(bundleKey(id), { bundle: makeBundle(id, []), version: null, etag: null });
      client.setQueryData(journalKey(id, null), { events: [], etag: null });
    };
    seed("p5");
    seed("p6");
    client.setQueryData(projectsKey(), []);

    const unsubscribe = subscribeLocalMutationsToCache(client);
    check("subscribing registers one bus listener", localListenerCount() === 1);
    notifyLocalMutation("p5");
    await tick();
    check(
      "a local mutation invalidates the project's bundle and journal",
      client.getQueryState(bundleKey("p5")).isInvalidated === true && client.getQueryState(journalKey("p5", null)).isInvalidated === true,
    );
    check("…and the listing", client.getQueryState(projectsKey()).isInvalidated === true);
    check("…but not another project", client.getQueryState(bundleKey("p6")).isInvalidated === false);

    unsubscribe();
    check("unsubscribing removes the listener", localListenerCount() === 0);
    seed("p5");
    notifyLocalMutation("p5");
    await tick();
    check("after unsubscribe a mutation changes nothing", client.getQueryState(bundleKey("p5")).isInvalidated === false);
  }

  // --- conditional reads (Part 2b) --------------------------------------------
  // The queryFn reads the previous entry, sends its validator, and on
  // `not-modified` returns that entry unchanged. Returning the SAME OBJECT is
  // the point: structural sharing short-circuits on identity, so a
  // revalidation that changes nothing costs zero renders downstream.
  {
    const client = newClient();
    const bundle = makeBundle("p-cond", [makeNode("V-a", "p-cond")]);
    const seen = [];
    let answer = { status: "fresh", value: structuredClone(bundle), etag: 'W/"1.0"', version: "1" };
    const provider = makeProvider({
      getProject: async () => {
        throw new Error("a provider with readProject must not be read unconditionally");
      },
      readProject: async (id, options) => {
        seen.push(options.etag);
        return answer.status === "fresh" ? { ...answer, value: structuredClone(answer.value) } : answer;
      },
    });
    setProvider(provider);

    const first = await client.fetchQuery(bundleQueryOptions("p-cond"));
    check("the first read is unconditional", seen.length === 1 && seen[0] === null, JSON.stringify(seen));
    check(
      "the entry stores the server validator and version",
      first.etag === 'W/"1.0"' && first.version === "1",
      JSON.stringify({ etag: first.etag, version: first.version }),
    );

    answer = { status: "not-modified" };
    await client.refetchQueries({ queryKey: bundleKey("p-cond"), type: "all" });
    const second = client.getQueryData(bundleKey("p-cond"));
    check("the refetch sent the stored validator", seen[1] === 'W/"1.0"', JSON.stringify(seen));
    check("a not-modified answer keeps the previous entry — by reference", second === first);
    // …and the validator survives it, or the read after a quiet minute would
    // go out unconditional and pull the whole bundle back for nothing.
    await client.refetchQueries({ queryKey: bundleKey("p-cond"), type: "all" });
    check("the validator survives a not-modified refetch", seen[2] === 'W/"1.0"', JSON.stringify(seen));

    answer = { status: "fresh", value: makeBundle("p-cond", [makeNode("V-b", "p-cond")]), etag: 'W/"2.0"', version: "2" };
    await client.refetchQueries({ queryKey: bundleKey("p-cond"), type: "all" });
    const third = client.getQueryData(bundleKey("p-cond"));
    check(
      "a fresh answer replaces the entry and stores the new validator",
      third !== first && third.bundle.nodes[0].id === "V-b" && third.etag === 'W/"2.0"' && third.version === "2",
      JSON.stringify({ etag: third.etag, version: third.version, first: third.bundle.nodes[0].id }),
    );

    // A `missing` answer is a not-found entry, not an error, exactly as an
    // `undefined` from `getProject` was before the conditional read.
    answer = { status: "missing" };
    await client.refetchQueries({ queryKey: bundleKey("p-cond"), type: "all" });
    check("a missing answer resolves to a null entry", client.getQueryData(bundleKey("p-cond")) === null);
  }

  // A 304 with nothing cached should not happen — no entry means no validator
  // was sent — but a server that answers one anyway must not leave the query
  // without data. The queryFn re-reads unconditionally.
  {
    const client = newClient();
    const seen = [];
    let answers = [{ status: "not-modified" }, { status: "fresh", value: makeBundle("p-304", []), etag: null }];
    const provider = makeProvider({
      readProject: async (id, options) => {
        seen.push(options.etag);
        return answers.shift();
      },
    });
    setProvider(provider);

    const entry = await client.fetchQuery(bundleQueryOptions("p-304"));
    check(
      "an unexpected 304 on a cold entry is retried unconditionally",
      seen.length === 2 && seen[0] === null && seen[1] === null && entry !== null && entry.bundle.project.id === "p-304",
      JSON.stringify(seen),
    );
  }

  // The journal reads through the same path, and hands its projection along.
  {
    const client = newClient();
    const seen = [];
    let answer = { status: "fresh", value: [makeEvent("e1", "node.created")], etag: 'W/"1.1"' };
    const provider = makeProvider({
      getJournal: async () => {
        throw new Error("a provider with readJournal must not be read unconditionally");
      },
      readJournal: async (id, options) => {
        seen.push({ etag: options.etag, types: options.types });
        return answer;
      },
    });
    setProvider(provider);

    const first = await client.fetchQuery(journalQueryOptions("p-cond", ["b", "a"]));
    check(
      "a journal read carries its normalized projection to the provider",
      JSON.stringify(seen[0].types) === JSON.stringify(["a", "b"]),
      JSON.stringify(seen[0]),
    );
    check("the journal entry stores its validator", first.etag === 'W/"1.1"', JSON.stringify(first));

    answer = { status: "not-modified" };
    await client.refetchQueries({ queryKey: journalKey("p-cond", ["a", "b"]), type: "all" });
    check("the journal refetch sent the stored validator", seen[1].etag === 'W/"1.1"', JSON.stringify(seen));
    check(
      "a not-modified journal answer keeps the previous entry — by reference",
      client.getQueryData(journalKey("p-cond", ["a", "b"])) === first,
    );
  }

  // --- hosted polling ---------------------------------------------------------
  // A hosted project is written by agents, the CLI and the GitHub App while a
  // tab is open, and the remote provider has no mutation bus to hear it. Local
  // and seed projects do have one, and must not poll.
  {
    const hosted = bundleQueryOptions("prj_abc123");
    const local = bundleQueryOptions("local-1");
    check("a hosted bundle query polls once a minute", hosted.refetchInterval === 60_000, String(hosted.refetchInterval));
    check("…only while the tab is visible", hosted.refetchIntervalInBackground === false);
    check("a local bundle query never polls", local.refetchInterval === false, String(local.refetchInterval));
    check(
      "the journal follows the same rule",
      journalQueryOptions("prj_abc123", null).refetchInterval === 60_000 &&
        journalQueryOptions("local-1", null).refetchInterval === false,
    );
  }

  for (const client of clients) client.clear();
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} project-queries test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll project-queries tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

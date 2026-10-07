#!/usr/bin/env node

/**
 * Hosted reads kept across visits (lib/data/query-persistence.ts, #429).
 *
 * Real TanStack core, real `@tanstack/query-persist-client-core`, the real
 * bundle query from project-queries.ts; only the storage (an in-memory map)
 * and the provider are fakes. A "visit" is a fresh QueryClient over the same
 * storage — exactly what a reload is to the cache.
 *
 * What is pinned is the design the review recorded: a restored entry paints,
 * then revalidates by its ETag WHATEVER staleTime says; it is marked until the
 * server confirms it; another account never sees it; nothing is kept without
 * an account, for a local project, or for History's infinite query; and a 304
 * never rewrites a row.
 */

const fs = require("fs");
const { loadProjectQueries, BUILD_DIR } = require("./load-project-queries");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ISO = "2026-01-01T00:00:00.000Z";
const HOSTED = "prj_kept";

function makeBundle(id, nodeIds) {
  return {
    schema_version: 3,
    project: { id, title: id, created_at: ISO, updated_at: ISO },
    nodes: nodeIds.map((n) => ({ id: n, project_id: id, species: "view", title: n, status: "idea", platforms: ["web"] })),
    edges: [],
  };
}

function memoryStorage() {
  const rows = new Map();
  const writes = [];
  return {
    rows,
    writes,
    getItem: async (key) => rows.get(key),
    setItem: async (key, value) => {
      writes.push(key);
      rows.set(key, structuredClone(value));
    },
    removeItem: async (key) => {
      rows.delete(key);
    },
    entries: async () => [...rows.entries()],
  };
}

async function settle(client) {
  for (let i = 0; i < 50; i++) {
    await tick();
    if (client.isFetching() === 0) {
      // The persister writes on a scheduled task after the fetch settles,
      // and a restore schedules its revalidation the same way: let both run.
      for (let j = 0; j < 5; j++) await tick();
      if (client.isFetching() === 0) return;
    }
  }
}

async function main() {
  const { queries, queryClient, core, setProvider, persistence } = loadProjectQueries();
  const { bundleQueryOptions, bundleKey, journalPagesKey, journalKey, journalStatsKey, projectsKey, selectConfirmed } = queries;
  const { createQueryClient } = queryClient;
  const { createHostedQueryPersister, isPersistedQueryKey } = persistence;

  const clients = [];
  /** One visit: a fresh client whose queries use a persister for `account`. */
  function visit(storage, account) {
    const client = createQueryClient();
    clients.push(client);
    const { persister } = createHostedQueryPersister({ storage, accountKnown: async () => account });
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, persister } });
    return client;
  }

  // The server: answers fresh with a validator, or 304 to that validator.
  const sent = [];
  let current = { bundle: makeBundle("orig", ["V-a"]), etag: 'W/"1.0"', version: "1" };
  setProvider({
    getProject: async () => {
      throw new Error("hosted reads are conditional");
    },
    readProject: async (id, options) => {
      sent.push(options.etag);
      if (options.etag === current.etag) return { status: "not-modified" };
      return { status: "fresh", value: structuredClone(current.bundle), etag: current.etag, version: current.version };
    },
  });

  // --- Which reads are kept ---------------------------------------------------------
  check("a hosted bundle, journal and stats read are kept", [
    bundleKey(HOSTED), journalKey(HOSTED, null), journalStatsKey(HOSTED),
  ].every(isPersistedQueryKey));
  check(
    "a local project, the seed, the listing and History's infinite pages are not",
    ![bundleKey("local-1"), bundleKey("arkaik-self-map"), projectsKey(), journalPagesKey(HOSTED, null)].some(isPersistedQueryKey),
  );

  // --- Visit 1 writes the row ------------------------------------------------------------
  const storage = memoryStorage();
  const first = visit(storage, "u1");
  await first.fetchQuery(bundleQueryOptions(HOSTED));
  await settle(first);
  check("the first visit keeps its hosted read", storage.rows.size === 1, JSON.stringify([...storage.rows.keys()]));

  // --- Visit 2 paints from the row, then revalidates ---------------------------------------
  sent.length = 0;
  const second = visit(storage, "u1");
  const observer = new core.QueryObserver(second, bundleQueryOptions(HOSTED));
  const painted = [];
  const unsubscribe = observer.subscribe((result) => {
    if (result.data) painted.push(result.data);
  });
  await settle(second);
  check(
    "a return visit paints the kept entry, marked restored, before the server answers",
    painted.length >= 1 && painted[0].restored === true && painted[0].bundle.nodes[0].id === "V-a",
    JSON.stringify(painted.map((p) => p.restored ?? false)),
  );
  check(
    "…then revalidates by the kept ETag even inside staleTime (refetchOnRestore: always)",
    sent.length === 1 && sent[0] === 'W/"1.0"',
    JSON.stringify(sent),
  );
  const confirmedEntry = observer.getCurrentResult().data;
  check(
    "…and the server's 304 clears the mark, keeping the content",
    confirmedEntry.restored === undefined && confirmedEntry.bundle.nodes[0].id === "V-a" && confirmedEntry.etag === 'W/"1.0"',
    JSON.stringify({ restored: confirmedEntry.restored, etag: confirmedEntry.etag }),
  );

  check(
    "selectConfirmed — what ProductManagerPanel waits on — is false for the restored paint, true once confirmed",
    selectConfirmed(painted[0]) === false && selectConfirmed(confirmedEntry) === true &&
      selectConfirmed(undefined) === true && selectConfirmed(null) === true,
  );

  // --- A 304 that changes nothing writes nothing --------------------------------------------
  const writesBefore = storage.writes.length;
  await second.refetchQueries({ queryKey: bundleKey(HOSTED), type: "all" });
  await settle(second);
  await second.refetchQueries({ queryKey: bundleKey(HOSTED), type: "all" });
  await settle(second);
  check(
    "repeated 304s rewrite no row — the same entry object is not written twice",
    storage.writes.length === writesBefore,
    `${writesBefore} -> ${storage.writes.length}`,
  );

  // --- A change on the server replaces the row ------------------------------------------------
  current = { bundle: makeBundle("orig", ["V-a", "V-b"]), etag: 'W/"2.0"', version: "2" };
  await second.refetchQueries({ queryKey: bundleKey(HOSTED), type: "all" });
  await settle(second);
  const kept = [...storage.rows.values()][0];
  check(
    "a fresh answer is written back, so the next visit paints it",
    kept.state.data.bundle.nodes.length === 2 && kept.state.data.etag === 'W/"2.0"',
    JSON.stringify(kept.state.data.etag),
  );
  unsubscribe();

  // --- Another account never sees it --------------------------------------------------------
  sent.length = 0;
  const other = visit(storage, "u2");
  const otherEntry = await other.fetchQuery(bundleQueryOptions(HOSTED));
  await settle(other);
  check(
    "another account on the same browser reads from the server, unconditionally",
    otherEntry.restored === undefined && sent[0] === null,
    JSON.stringify(sent),
  );
  check(
    "…and the first account's row is gone, replaced by its own",
    storage.rows.size === 1 && [...storage.rows.values()][0].buster.endsWith(":u2"),
    JSON.stringify([...storage.rows.values()].map((r) => r.buster)),
  );

  // --- No account, nothing kept or read -------------------------------------------------------
  const anonymousStorage = memoryStorage();
  const anonymous = visit(anonymousStorage, null);
  await anonymous.fetchQuery(bundleQueryOptions(HOSTED));
  await settle(anonymous);
  check("a signed-out or unnamed session keeps nothing", anonymousStorage.rows.size === 0);

  // --- A local project is never kept ------------------------------------------------------------
  setProvider({
    getProject: async (id) => makeBundle(id, ["V-l"]),
    readProject: async (id) => ({ status: "fresh", value: makeBundle(id, ["V-l"]), etag: null }),
  });
  const localStorage = memoryStorage();
  const local = visit(localStorage, "u1");
  await local.fetchQuery(bundleQueryOptions("local-1"));
  await settle(local);
  check("a local project's read is not persisted — it already lives in IndexedDB", localStorage.rows.size === 0);

  for (const client of clients) client.clear();
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`\n${failures} query-persistence test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll query-persistence tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

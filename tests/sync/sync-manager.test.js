#!/usr/bin/env node

/**
 * Unit tests for lib/sync/sync-manager.ts (issue #244, docs/spec/services.md
 * § Synk → Client sync engine). Pure logic only — every side effect (fetch,
 * the mutation channel, the provider's exportProject, hashing, timers) is
 * stubbed via `createSyncManager()`'s dependency-injection, per the loader's
 * doc comment. No DOM, no IndexedDB, no real network.
 *
 * Coverage (the acceptance list from issue #244):
 *  - dormant when signed out / unconfigured: no timers, no fetches
 *  - debounce: a mutation notification arms exactly one per-project timer;
 *    repeated mutations before it fires coalesce into one
 *  - "Back up now" bypasses the debounce timer
 *  - export → serialize → hash → PUT, with the correct method/URL/header
 *  - status transitions: pending → syncing → backed-up / error / limit-exceeded
 *  - 403 renders the structured { limit, actual, tier } body
 *  - network failure and 401 leave the local bundle untouched and simply
 *    wait for the next mutation (or manual backupNow) to retry — no
 *    automatic retry timer of the engine's own
 *  - hash failure never blocks the PUT (advisory-only header)
 *  - server-list hydration seeds "backed-up" status without clobbering a
 *    status already known this session
 *  - subscribe/unsubscribe, stop() teardown, start() idempotency
 *  - the REAL @arkaik/schema canonical serialize + real Web Crypto SHA-256
 *    produce a correct, verifiable hash end-to-end
 */

const crypto = require("crypto");
const fs = require("fs");
const { loadSyncManager, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-sync-manager");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fakeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

/** A controllable fake `setTimeout`/`clearTimeout` pair — records the
 * requested delay per handle and lets tests fire callbacks on demand instead
 * of waiting out a real 60s debounce. */
function makeFakeTimers() {
  let nextId = 1;
  const pending = new Map(); // id -> { cb, ms }
  return {
    setTimeoutFn: (cb, ms) => {
      const id = nextId++;
      pending.set(id, { cb, ms });
      return id;
    },
    clearTimeoutFn: (id) => {
      pending.delete(id);
    },
    fireAll: () => {
      const entries = Array.from(pending.entries());
      pending.clear();
      for (const [, { cb }] of entries) cb();
    },
    pendingCount: () => pending.size,
    pendingMs: () => Array.from(pending.values()).map((t) => t.ms),
  };
}

/** Drains the microtask queue (a real macrotask boundary guarantees every
 * currently-queued promise continuation — however many hops — has run). */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function noopUnsubscribe() {}

async function main() {
  const { createSyncManager } = loadSyncManager();

  // --- A. dormant when signed out: no timer armed, backupNow no-ops -------
  {
    let exportCalled = false;
    let fetchCalled = false;
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: false }),
      listServerProjects: async () => [],
      exportProject: async () => {
        exportCalled = true;
        return { project: { id: "p1", title: "T" }, nodes: [], edges: [] };
      },
      fetchImpl: async () => {
        fetchCalled = true;
        return fakeResponse(201, { id: "b1", deduped: false });
      },
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();
    capturedOnMutation({ projectId: "p1" });
    check("signed-out: mutation arms no timer", timers.pendingCount() === 0);
    check("signed-out: status stays idle", manager.getStatus("p1").state === "idle");

    await manager.backupNow("p1");
    check("signed-out: backupNow does not call exportProject", !exportCalled);
    check("signed-out: backupNow does not call fetch", !fetchCalled);
    check("signed-out: status still idle after backupNow", manager.getStatus("p1").state === "idle");
  }

  // --- B. dormant when unconfigured (no DATABASE_URL / auth unset) --------
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    let fetchCalled = false;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: false, signedIn: false }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      fetchImpl: async () => {
        fetchCalled = true;
        return fakeResponse(201, {});
      },
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();
    capturedOnMutation({ projectId: "p1" });
    check("unconfigured: mutation arms no timer", timers.pendingCount() === 0);
    await manager.backupNow("p1");
    check("unconfigured: backupNow never calls fetch", !fetchCalled);
  }

  // --- C/D. debounce: one timer per project, coalesces repeats ------------
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      fetchImpl: async () => fakeResponse(201, { id: "b1", deduped: false }),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      debounceMs: 61234,
    });
    manager.start();
    await manager.refreshAuth();

    capturedOnMutation({ projectId: "p1" });
    check("signed-in: mutation sets pending status", manager.getStatus("p1").state === "pending");
    check("signed-in: exactly one timer armed", timers.pendingCount() === 1);
    check("debounce delay matches configured debounceMs", timers.pendingMs()[0] === 61234);

    capturedOnMutation({ projectId: "p1" });
    check(
      "a second mutation before the timer fires coalesces (still one timer)",
      timers.pendingCount() === 1,
    );

    capturedOnMutation({ projectId: "p2" });
    check("a different project gets its own timer", timers.pendingCount() === 2);
  }

  // --- E. backupNow bypasses the debounce ----------------------------------
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    let fetchCallCount = 0;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "stub-hash",
      fetchImpl: async () => {
        fetchCallCount++;
        return fakeResponse(201, { id: "b1", deduped: false });
      },
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();

    capturedOnMutation({ projectId: "p1" });
    check("backupNow test: timer armed before bypass", timers.pendingCount() === 1);

    await manager.backupNow("p1");
    check("backupNow clears the pending debounce timer", timers.pendingCount() === 0);
    check("backupNow performed exactly one PUT", fetchCallCount === 1);
    check("backupNow: final status is backed-up", manager.getStatus("p1").state === "backed-up");
  }

  // --- F/G. status transitions + request shape -----------------------------
  {
    let captured = null;
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return fakeResponse(201, { id: "b1", deduped: false });
      },
      now: () => Date.parse("2026-07-13T12:00:00.000Z"),
    });

    const transitions = [];
    manager.subscribe(() => transitions.push(manager.getStatus("p1").state));

    await manager.backupNow("p1");
    check("request method is PUT", captured.init.method === "PUT");
    check("request URL targets the project's backup endpoint", captured.url === "/api/synk/projects/p1");
    check(
      "request carries the advisory x-bundle-sha256 header",
      captured.init.headers["x-bundle-sha256"] === "abc123",
    );
    check("content-type is application/json", captured.init.headers["content-type"] === "application/json");
    check(
      "status transitions syncing → backed-up",
      transitions.includes("syncing") && transitions[transitions.length - 1] === "backed-up",
      JSON.stringify(transitions),
    );
    const status = manager.getStatus("p1");
    check(
      "stored (201) sets backed-up with the injected now() as ISO",
      status.state === "backed-up" && status.at === "2026-07-13T12:00:00.000Z",
      JSON.stringify(status),
    );
  }

  // --- G. deduped (200) also reads as backed-up ----------------------------
  {
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async () => fakeResponse(200, { deduped: true }),
      now: () => Date.parse("2026-07-13T12:00:00.000Z"),
    });
    await manager.backupNow("p1");
    check("deduped 200 also sets backed-up", manager.getStatus("p1").state === "backed-up");
  }

  // --- H. 403 renders the structured limit body ----------------------------
  {
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async () =>
        fakeResponse(403, { error: "limit_exceeded", limit: 250, actual: 312, tier: "synk" }),
    });
    await manager.backupNow("p1");
    const status = manager.getStatus("p1");
    check(
      "403 sets limit-exceeded with { limit, actual, tier }",
      status.state === "limit-exceeded" && status.limit === 250 && status.actual === 312 && status.tier === "synk",
      JSON.stringify(status),
    );
  }

  // --- I. network failure: error status, no auto-retry timer, retries on the next mutation ---
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    let attempt = 0;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async () => {
        attempt++;
        throw new Error("network down");
      },
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();

    await manager.backupNow("p1");
    let status = manager.getStatus("p1");
    check(
      "network failure sets an error status carrying the failure message",
      status.state === "error" && status.message.includes("network down"),
      JSON.stringify(status),
    );
    check("a network failure does not arm its own retry timer", timers.pendingCount() === 0);

    // The local bundle was never lost — it's still in exportProject's backing
    // store, untouched. The next mutation is what retries.
    capturedOnMutation({ projectId: "p1" });
    status = manager.getStatus("p1");
    check(
      "the next mutation notification re-arms the debounce (retry-on-next-mutation)",
      status.state === "pending" && timers.pendingCount() === 1,
      JSON.stringify(status),
    );
  }

  // --- J. 401 mid-flight marks the session signed-out; further mutations stay dormant ---
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async () => fakeResponse(401, { error: "unauthorized" }),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();

    await manager.backupNow("p1");
    check("401 sets an error status", manager.getStatus("p1").state === "error");
    check("401 flips the cached auth state to signed-out", manager.getAuthState().signedIn === false);

    capturedOnMutation({ projectId: "p1" });
    check(
      "after a 401, a further mutation stays dormant (no timer)",
      timers.pendingCount() === 0,
    );
  }

  // --- K. 503 renders a clear "not available" message ----------------------
  {
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc123",
      fetchImpl: async () =>
        fakeResponse(503, { error: "services_unavailable", message: "arkaik services (Synk) are not configured." }),
    });
    await manager.backupNow("p1");
    const status = manager.getStatus("p1");
    check(
      "503 sets an error status mentioning unavailability",
      status.state === "error" && /not available/i.test(status.message),
      JSON.stringify(status),
    );
  }

  // --- L. a hash failure never blocks the PUT (advisory-only header) -------
  {
    let captured = null;
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => {
        throw new Error("crypto unavailable");
      },
      fetchImpl: async (url, init) => {
        captured = init;
        return fakeResponse(201, { id: "b1", deduped: false });
      },
    });
    await manager.backupNow("p1");
    check("a hash failure still results in a PUT", captured !== null);
    check(
      "the advisory header is simply omitted when hashing fails",
      !("x-bundle-sha256" in captured.headers),
    );
    check("backup still succeeds despite the hash failure", manager.getStatus("p1").state === "backed-up");
  }

  // --- M. exportProject failure never calls fetch ---------------------------
  {
    let fetchCalled = false;
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => {
        throw new Error("project not found");
      },
      fetchImpl: async () => {
        fetchCalled = true;
        return fakeResponse(201, {});
      },
    });
    await manager.backupNow("p1");
    check("an exportProject failure never calls fetch", !fetchCalled);
    check(
      "an exportProject failure sets an error status with its message",
      manager.getStatus("p1").state === "error" && manager.getStatus("p1").message.includes("project not found"),
    );
  }

  // --- N. server-list hydration seeds backed-up status without clobbering ---
  {
    let resolveList;
    const listPromise = new Promise((resolve) => {
      resolveList = resolve;
    });
    let capturedOnMutation = null;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: () => listPromise,
      exportProject: async () => ({ project: { id: "p2", title: "T" }, nodes: [], edges: [] }),
    });
    manager.start();
    await manager.refreshAuth(); // resolves auth; hydrateFromServer is now in flight (awaiting listPromise)

    // p2 gets a locally-known status (pending) BEFORE the server list resolves.
    capturedOnMutation({ projectId: "p2" });
    check("p2 has a local pending status before hydration resolves", manager.getStatus("p2").state === "pending");

    resolveList([
      { projectId: "p1", lastBackupAt: "2026-01-01T00:00:00.000Z" },
      { projectId: "p2", lastBackupAt: "2026-01-02T00:00:00.000Z" },
    ]);
    await flush();

    const p1 = manager.getStatus("p1");
    check(
      "hydration seeds a never-locally-known project as backed-up",
      p1.state === "backed-up" && p1.at === "2026-01-01T00:00:00.000Z",
      JSON.stringify(p1),
    );
    check(
      "hydration does NOT clobber a status already known this session",
      manager.getStatus("p2").state === "pending",
      JSON.stringify(manager.getStatus("p2")),
    );
  }

  // --- O. subscribe/unsubscribe ----------------------------------------------
  {
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      hashBundle: async () => "abc",
      fetchImpl: async () => fakeResponse(201, { id: "b1", deduped: false }),
    });
    let calls = 0;
    const unsubscribe = manager.subscribe(() => {
      calls++;
    });
    await manager.backupNow("p1");
    check("subscriber is notified on status changes", calls > 0);

    unsubscribe();
    const callsAtUnsubscribe = calls;
    await manager.backupNow("p1");
    check("unsubscribe() actually stops delivery", calls === callsAtUnsubscribe);
  }

  // --- P. stop() unsubscribes and clears pending timers -----------------------
  {
    const timers = makeFakeTimers();
    let capturedOnMutation = null;
    let unsubscribeCalled = false;
    const manager = createSyncManager({
      subscribeToMutations: (cb) => {
        capturedOnMutation = cb;
        return () => {
          unsubscribeCalled = true;
        };
      },
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.start();
    await manager.refreshAuth();
    capturedOnMutation({ projectId: "p1" });
    check("stop() test: a timer is pending before stop()", timers.pendingCount() === 1);

    manager.stop();
    check("stop() unsubscribes from the mutation channel", unsubscribeCalled);
    check("stop() clears every pending debounce timer", timers.pendingCount() === 0);
  }

  // --- Q. start() is idempotent ------------------------------------------------
  {
    let subscribeCallCount = 0;
    const manager = createSyncManager({
      subscribeToMutations: () => {
        subscribeCallCount++;
        return noopUnsubscribe;
      },
      getAuthState: async () => ({ configured: false, signedIn: false }),
      listServerProjects: async () => [],
      exportProject: async () => ({ project: { id: "p1", title: "T" }, nodes: [], edges: [] }),
    });
    manager.start();
    manager.start();
    manager.start();
    check("start() only subscribes once even when called repeatedly", subscribeCallCount === 1);
  }

  // --- R. real canonical serialize + real Web Crypto hash, cross-checked ------
  {
    let capturedBody = null;
    let capturedHeaders = null;
    const bundle = {
      schema_version: 2,
      project: {
        id: "p-real",
        title: "Real Bundle",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
      },
      nodes: [
        { id: "V-b", project_id: "p-real", species: "view", title: "B", status: "idea", platforms: ["web"] },
        { id: "V-a", project_id: "p-real", species: "view", title: "A", status: "idea", platforms: ["web"] },
      ],
      edges: [],
    };
    const manager = createSyncManager({
      subscribeToMutations: () => noopUnsubscribe,
      getAuthState: async () => ({ configured: true, signedIn: true }),
      listServerProjects: async () => [],
      exportProject: async () => bundle,
      // serializeBundle and hashBundle are NOT overridden — the real
      // @arkaik/schema canonical serializer and real Web Crypto SHA-256 run.
      fetchImpl: async (url, init) => {
        capturedBody = init.body;
        capturedHeaders = init.headers;
        return fakeResponse(201, { id: "b-real", deduped: false });
      },
    });

    await manager.backupNow("p-real");

    check("real serializeBundle sorted the nodes by id", capturedBody.indexOf('"V-a"') < capturedBody.indexOf('"V-b"'));
    const expectedHash = crypto.createHash("sha256").update(capturedBody, "utf8").digest("hex");
    check(
      "the real Web Crypto hash matches an independent Node sha256 of the exact bytes sent",
      capturedHeaders["x-bundle-sha256"] === expectedHash,
      `${capturedHeaders["x-bundle-sha256"]} !== ${expectedHash}`,
    );
    check("real end-to-end backup still lands on backed-up", manager.getStatus("p-real").state === "backed-up");
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} sync-manager test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll sync-manager tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Unit tests for the mutation-notification channel (lib/data/local-provider.ts
 * `subscribeToMutations`, issue #243) — the other half of the provider-
 * injection seam `docs/spec/services.md` § Synk "Client sync engine" needs to
 * trigger its debounced backup, and the exact seam `docs/rfcs/arkaik-dev.md`
 * (Option B.1) calls for.
 *
 * Exercises the real local-provider.ts mutation methods (via
 * load-local-provider.js's hand-written in-memory fake `./db`, deliberately
 * IndexedDB-free) and asserts, per issue #243's acceptance criteria:
 *  - a node update fires exactly one notification with the right projectId;
 *  - the notification fires AFTER the mutation's transaction resolves, never
 *    on a failed/thrown mutation;
 *  - create/delete node, create/delete edge, importProject, and saveProject
 *    each fire exactly one notification for their project;
 *  - deleteNodes (batch) fires one notification per affected project, not one
 *    per node;
 *  - archiveProject does not fire a notification (deliberately excluded from
 *    the acceptance list — see local-provider.ts's module doc);
 *  - unsubscribe() actually stops delivery.
 */

const fs = require("fs");
const { loadLocalProvider, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-local-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";

function makeBundle(projectId, nodes = [], edges = []) {
  return {
    schema_version: 2, // current — migrateBundle returns it untouched
    project: {
      id: projectId,
      title: `Project ${projectId}`,
      created_at: ISO,
      updated_at: ISO,
      archived_at: null,
    },
    nodes,
    edges,
  };
}

function makeNode(id, projectId, overrides = {}) {
  return {
    id,
    project_id: projectId,
    species: "view",
    title: id,
    status: "idea",
    platforms: ["web"],
    ...overrides,
  };
}

async function main() {
  const { localProvider, subscribeToMutations, __makeFakeDb, __setFakeDb } = loadLocalProvider();

  function withRecorder() {
    const received = [];
    const unsubscribe = subscribeToMutations((e) => received.push(e));
    return { received, unsubscribe };
  }

  // --- setup: a fresh fake db seeded with one project/node via saveProject ---
  const db = __makeFakeDb();
  __setFakeDb(db);

  const PROJECT_A = "p-a";
  await localProvider.saveProject(makeBundle(PROJECT_A, [makeNode("V-home", PROJECT_A)]));

  // --- updateNode: exactly one notification, right projectId (the acceptance
  // criteria's named unit test) ---
  {
    const { received, unsubscribe } = withRecorder();
    const updated = await localProvider.updateNode("V-home", { title: "Home v2" });
    unsubscribe();
    check("updateNode returns the updated node", updated.title === "Home v2");
    check("updateNode fires exactly one notification", received.length === 1, JSON.stringify(received));
    check(
      "updateNode's notification carries the right projectId",
      received[0]?.projectId === PROJECT_A,
      JSON.stringify(received),
    );
  }

  // --- unsubscribe actually stops delivery ---
  {
    const { received, unsubscribe } = withRecorder();
    unsubscribe();
    await localProvider.updateNode("V-home", { title: "Home v3" });
    check("no notification is delivered after unsubscribe()", received.length === 0, JSON.stringify(received));
  }

  // --- createNode fires exactly one notification ---
  {
    const { received, unsubscribe } = withRecorder();
    await localProvider.createNode(makeNode("V-settings", PROJECT_A));
    unsubscribe();
    check("createNode fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("createNode's notification carries the right projectId", received[0]?.projectId === PROJECT_A);
  }

  // --- createEdge / deleteEdge fire exactly one notification each ---
  {
    const { received, unsubscribe } = withRecorder();
    const edge = await localProvider.createEdge({
      id: "ignored-on-create",
      project_id: PROJECT_A,
      source_id: "V-home",
      target_id: "V-settings",
      edge_type: "composes",
    });
    check("createEdge fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("createEdge's notification carries the right projectId", received[0]?.projectId === PROJECT_A);

    received.length = 0;
    await localProvider.deleteEdge(edge.id);
    check("deleteEdge fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("deleteEdge's notification carries the right projectId", received[0]?.projectId === PROJECT_A);
    unsubscribe();
  }

  // --- deleteNode fires exactly one notification ---
  {
    const { received, unsubscribe } = withRecorder();
    await localProvider.deleteNode("V-settings");
    unsubscribe();
    check("deleteNode fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("deleteNode's notification carries the right projectId", received[0]?.projectId === PROJECT_A);
  }

  // --- importProject fires exactly one notification ---
  {
    const { received, unsubscribe } = withRecorder();
    const PROJECT_IMPORTED = "p-imported";
    await localProvider.importProject(makeBundle(PROJECT_IMPORTED, [makeNode("V-x", PROJECT_IMPORTED)]));
    unsubscribe();
    check("importProject fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("importProject's notification carries the right projectId", received[0]?.projectId === PROJECT_IMPORTED);
  }

  // --- saveProject fires exactly one notification ---
  {
    const { received, unsubscribe } = withRecorder();
    const current = await localProvider.getProject(PROJECT_A);
    await localProvider.saveProject({
      ...current,
      project: { ...current.project, title: "Renamed" },
    });
    unsubscribe();
    check("saveProject fires exactly one notification", received.length === 1, JSON.stringify(received));
    check("saveProject's notification carries the right projectId", received[0]?.projectId === PROJECT_A);
  }

  // --- archiveProject deliberately does NOT fire (not in issue #243's list) ---
  {
    const { received, unsubscribe } = withRecorder();
    await localProvider.archiveProject(PROJECT_A);
    unsubscribe();
    check("archiveProject fires no notification", received.length === 0, JSON.stringify(received));
  }

  // --- a failed mutation never fires (thrown before/without a resolved transaction) ---
  {
    const { received, unsubscribe } = withRecorder();
    let threw = false;
    try {
      await localProvider.updateNode("does-not-exist", { title: "x" });
    } catch {
      threw = true;
    }
    unsubscribe();
    check("updating a nonexistent node throws", threw);
    check("a failed mutation fires no notification", received.length === 0, JSON.stringify(received));
  }

  // --- deleteNodes (batch) fires one notification per affected project, not
  // one per node ---
  {
    const PROJECT_B = "p-b";
    const PROJECT_C = "p-c";
    await localProvider.saveProject(
      makeBundle(PROJECT_B, [makeNode("V-b1", PROJECT_B), makeNode("V-b2", PROJECT_B)]),
    );
    await localProvider.saveProject(makeBundle(PROJECT_C, [makeNode("V-c1", PROJECT_C)]));

    const { received, unsubscribe } = withRecorder();
    await localProvider.deleteNodes(["V-b1", "V-b2", "V-c1"]);
    unsubscribe();

    check(
      "deleteNodes fires exactly one notification per affected project (2 projects, 3 nodes)",
      received.length === 2,
      JSON.stringify(received),
    );
    const projectIds = received.map((e) => e.projectId).sort();
    check(
      "deleteNodes' notifications name exactly the affected projects",
      JSON.stringify(projectIds) === JSON.stringify([PROJECT_B, PROJECT_C]),
      JSON.stringify(projectIds),
    );
  }

  // --- deleteNodes with no ids affected fires nothing ---
  {
    const { received, unsubscribe } = withRecorder();
    await localProvider.deleteNodes(["does-not-exist"]);
    unsubscribe();
    check("deleteNodes affecting no project fires no notification", received.length === 0, JSON.stringify(received));
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} mutation-notification test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll mutation-notification tests passed.");
}

main();

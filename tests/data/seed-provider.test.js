#!/usr/bin/env node

/**
 * Unit tests for the in-memory seed provider (lib/data/seed-provider.ts,
 * self-map program cycle 4) — the sandbox mechanism behind the built-in public
 * `arkaik-self-map` project.
 *
 * The contract under test: `createSeedProvider(loadBundle)` returns a
 * `DataProvider` that behaves like a real project (every mutator succeeds and
 * runs through the SAME `applyOps` + journal derivation the local provider
 * uses) EXCEPT nothing persists — all state lives in a closure over the
 * bundle `loadBundle()` returns, so a fresh `createSeedProvider` call (what a
 * page refresh amounts to, since it re-imports/re-evaluates the module state)
 * is pristine again. One deliberate refusal (`archiveProject` — the public
 * project can't be "deleted") and one write path that looks like a refusal
 * but isn't (`importProject` — the raw-editor's save path for the sandbox,
 * routed here by the routing provider whenever a bundle carries the reserved
 * seed id; it replaces the in-memory bundle exactly like `saveProject`, and
 * both preserve an existing journal when a bundle omits one).
 *
 * Uses the real shipped seed (seed/arkaik-self-map.json) as its fixture, so
 * these tests also pin its shape: 15 nodes / 19 edges / 20 journal events.
 */

const fs = require("fs");
const path = require("path");
const { loadSeedProvider, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-seed-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SEED_PATH = path.join(__dirname, "..", "..", "seed", "arkaik-self-map.json");
const SEED = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
const PRISTINE_SEED_JSON = JSON.stringify(SEED);
const PROJECT_ID = "arkaik-self-map";

async function main() {
  const { createSeedProvider } = loadSeedProvider();

  const provider = createSeedProvider(() => SEED);

  // --- listProjects ----------------------------------------------------------
  {
    const summaries = await provider.listProjects();
    check("listProjects returns exactly one summary", summaries.length === 1, JSON.stringify(summaries));
    const [summary] = summaries;
    check("the summary's project id is arkaik-self-map", summary.project.id === PROJECT_ID);
    check("the summary is marked seed: true", summary.seed === true);
    check("the summary is marked hosted: false", summary.hosted === false);
    check("the summary's nodeCount matches the bundle", summary.nodeCount === SEED.nodes.length, String(summary.nodeCount));
    check("the summary's edgeCount matches the bundle", summary.edgeCount === SEED.edges.length, String(summary.edgeCount));
  }

  // --- getProject --------------------------------------------------------------
  {
    const bundle = await provider.getProject(PROJECT_ID);
    check("getProject returns the bundle", bundle !== undefined && bundle.project.id === PROJECT_ID);
    check("getProject's node count matches the seed", bundle.nodes.length === SEED.nodes.length);
    check("getProject's edge count matches the seed", bundle.edges.length === SEED.edges.length);

    const unknown = await provider.getProject("does-not-exist");
    check("getProject on an unknown id returns undefined", unknown === undefined);

    // Mutating the returned object must not affect a subsequent read (clone,
    // not alias).
    bundle.project.title = "MUTATED BY TEST";
    bundle.nodes.push({ id: "INTRUDER", project_id: PROJECT_ID, species: "view", title: "x", status: "idea", platforms: ["web"] });
    const again = await provider.getProject(PROJECT_ID);
    check(
      "mutating a returned bundle does not affect a later read",
      again.project.title !== "MUTATED BY TEST" && again.nodes.every((n) => n.id !== "INTRUDER"),
      JSON.stringify({ title: again.project.title, nodeCount: again.nodes.length }),
    );
  }

  // --- getJournal --------------------------------------------------------------
  {
    const journal = await provider.getJournal(PROJECT_ID);
    check(
      "getJournal serves the embedded journal",
      journal.length === (SEED.journal ?? []).length,
      `expected ${(SEED.journal ?? []).length}, got ${journal.length}`,
    );
  }

  // --- createNode ----------------------------------------------------------
  const sandboxNode = {
    id: "V-sandbox",
    project_id: PROJECT_ID,
    species: "view",
    title: "Sandbox View",
    status: "idea",
    platforms: ["web"],
  };
  {
    const journalBefore = await provider.getJournal(PROJECT_ID);
    const created = await provider.createNode(sandboxNode);
    check("createNode returns the created node", created.id === "V-sandbox");

    const nodes = await provider.getNodes(PROJECT_ID);
    check("createNode's node is readable back via getNodes", nodes.some((n) => n.id === "V-sandbox"));

    const journalAfter = await provider.getJournal(PROJECT_ID);
    check(
      "createNode grows the journal by a node.created event",
      journalAfter.length === journalBefore.length + 1,
      `before ${journalBefore.length}, after ${journalAfter.length}`,
    );
    const newEvent = journalAfter[journalAfter.length - 1];
    check(
      "the new journal event is node.created for V-sandbox",
      newEvent.type === "node.created" && newEvent.node_id === "V-sandbox",
      JSON.stringify(newEvent),
    );
  }

  // --- createNode does not alias sandbox-internal state (OUTPUT side) ---------
  // applyOps stores the exact `node` object the caller passed in; createNode
  // must hand back a CLONE of the stored node, not that same reference, or a
  // caller mutating the returned object would silently corrupt the in-memory
  // store without going through applyOps or the journal.
  {
    const created = await provider.createNode({
      id: "V-alias-check",
      project_id: PROJECT_ID,
      species: "view",
      title: "Original Title",
      status: "idea",
      platforms: ["web"],
    });
    created.title = "MUTATED BY TEST";
    const nodes = await provider.getNodes(PROJECT_ID);
    const stored = nodes.find((n) => n.id === "V-alias-check");
    check(
      "mutating createNode's returned object does not affect a later getNodes read",
      stored?.title === "Original Title",
      JSON.stringify(stored),
    );
    await provider.deleteNode(PROJECT_ID, "V-alias-check");
  }

  // --- createNode does not alias sandbox-internal state (INPUT side) ----------
  // `runOps` must clone `ops` before handing them to `applyOps`, or a caller
  // mutating the object it passed IN (after the call returns) would reach
  // into the same object `applyOps` stored by reference.
  {
    const input = {
      id: "V-alias-input-check",
      project_id: PROJECT_ID,
      species: "view",
      title: "Original Input Title",
      status: "idea",
      platforms: ["web"],
    };
    await provider.createNode(input);
    input.title = "MUTATED INPUT AFTER CALL";
    const nodes = await provider.getNodes(PROJECT_ID);
    const stored = nodes.find((n) => n.id === "V-alias-input-check");
    check(
      "mutating createNode's INPUT object after the call does not affect getNodes",
      stored?.title === "Original Input Title",
      JSON.stringify(stored),
    );
    await provider.deleteNode(PROJECT_ID, "V-alias-input-check");
  }

  // --- updateNode ------------------------------------------------------------
  {
    const updated = await provider.updateNode(PROJECT_ID, "V-sandbox", { title: "Sandbox View (edited)" });
    check("updateNode returns the updated node", updated.title === "Sandbox View (edited)");
    const nodes = await provider.getNodes(PROJECT_ID);
    const stored = nodes.find((n) => n.id === "V-sandbox");
    check("the update is reflected in getNodes", stored?.title === "Sandbox View (edited)");
  }

  // --- updateNode's patch does not alias sandbox-internal state ---------------
  // `update_node` spreads `patch` onto the current node — if `patch.metadata`
  // (a nested object) survives that spread by reference, mutating it after
  // the call corrupts the stored node without going through applyOps.
  {
    const patch = { metadata: { note: "original note" } };
    await provider.updateNode(PROJECT_ID, "V-sandbox", patch);
    patch.metadata.note = "MUTATED AFTER CALL";
    const nodes = await provider.getNodes(PROJECT_ID);
    const stored = nodes.find((n) => n.id === "V-sandbox");
    check(
      "mutating patch.metadata after updateNode does not affect the stored node",
      stored?.metadata?.note === "original note",
      JSON.stringify(stored?.metadata),
    );
  }

  // --- createEdge / deleteEdge -------------------------------------------------
  let sandboxEdgeId;
  {
    const existingSourceId = SEED.nodes[0].id;
    const edgeInput = {
      id: "ignored-on-create",
      project_id: PROJECT_ID,
      source_id: existingSourceId,
      target_id: "V-sandbox",
      edge_type: "calls",
    };
    const edge = await provider.createEdge(edgeInput);
    sandboxEdgeId = edge.id;
    check(
      "createEdge's returned id follows applyOps' e-{source}-{target} normalization",
      edge.id === `e-${existingSourceId}-V-sandbox`,
      edge.id,
    );

    // Mutate the caller's edge input object after the call — the stored edge
    // must not alias it.
    edgeInput.edge_type = "displays";
    const edgesAfterInputMutation = await provider.getEdges(PROJECT_ID);
    const storedEdge = edgesAfterInputMutation.find((e) => e.id === sandboxEdgeId);
    check(
      "mutating createEdge's INPUT object after the call does not affect getEdges",
      storedEdge?.edge_type === "calls",
      JSON.stringify(storedEdge),
    );
    const edges = await provider.getEdges(PROJECT_ID);
    check("the new edge is readable back via getEdges", edges.some((e) => e.id === sandboxEdgeId));

    await provider.deleteEdge(PROJECT_ID, sandboxEdgeId);
    const edgesAfterDelete = await provider.getEdges(PROJECT_ID);
    check("deleteEdge removes it", edgesAfterDelete.every((e) => e.id !== sandboxEdgeId));
  }

  // --- deleteNode --------------------------------------------------------------
  {
    await provider.deleteNode(PROJECT_ID, "V-sandbox");
    const nodes = await provider.getNodes(PROJECT_ID);
    check("deleteNode removes V-sandbox", nodes.every((n) => n.id !== "V-sandbox"));
  }

  // --- deleteNodes (plural) ----------------------------------------------------
  {
    const batchIds = ["V-batch-del-1", "V-batch-del-2"];
    for (const id of batchIds) {
      await provider.createNode({
        id,
        project_id: PROJECT_ID,
        species: "view",
        title: id,
        status: "idea",
        platforms: ["web"],
      });
    }
    await provider.deleteNodes(PROJECT_ID, batchIds);
    const nodesAfter = await provider.getNodes(PROJECT_ID);
    check(
      "deleteNodes removes every id it was given",
      batchIds.every((id) => nodesAfter.every((n) => n.id !== id)),
      JSON.stringify(nodesAfter.map((n) => n.id)),
    );

    // The `ids.length === 0` early return: must not throw and must not touch
    // the stored graph.
    const beforeEmptyCall = await provider.getNodes(PROJECT_ID);
    let emptyCallThrew = false;
    try {
      await provider.deleteNodes(PROJECT_ID, []);
    } catch {
      emptyCallThrew = true;
    }
    const afterEmptyCall = await provider.getNodes(PROJECT_ID);
    check("deleteNodes([]) does not throw", !emptyCallThrew);
    check(
      "deleteNodes([]) leaves the graph unchanged",
      afterEmptyCall.length === beforeEmptyCall.length,
      `before ${beforeEmptyCall.length}, after ${afterEmptyCall.length}`,
    );
  }

  // --- applyMutations ------------------------------------------------------
  {
    const batchNode = {
      id: "V-batch",
      project_id: PROJECT_ID,
      species: "view",
      title: "Batch View",
      status: "idea",
      platforms: ["web"],
    };
    const outcome = await provider.applyMutations(PROJECT_ID, [{ op: "create_node", node: batchNode }]);
    check(
      "applyMutations with one create_node op returns the graph",
      Array.isArray(outcome.nodes) && Array.isArray(outcome.edges) && outcome.nodes.some((n) => n.id === "V-batch"),
    );
    // Clean up so later "current state" assertions aren't polluted.
    await provider.deleteNode(PROJECT_ID, "V-batch");
  }

  // --- saveProject -----------------------------------------------------------
  {
    const bundle = await provider.getProject(PROJECT_ID);
    bundle.project.description = "Edited via saveProject in the sandbox.";
    await provider.saveProject(bundle);
    const reread = await provider.getProject(PROJECT_ID);
    check(
      "saveProject replaces the in-memory bundle",
      reread.project.description === "Edited via saveProject in the sandbox.",
      reread.project.description,
    );

    let mismatchedIdThrew = false;
    try {
      await provider.saveProject({ ...bundle, project: { ...bundle.project, id: "some-other-project" } });
    } catch {
      mismatchedIdThrew = true;
    }
    check("saveProject with a mismatched project.id rejects", mismatchedIdThrew);

    // A save that omits the journal must not erase the sandbox's history
    // mid-session — mirrors the local provider's preserve-on-save intent.
    const journalBeforeSave = await provider.getJournal(PROJECT_ID);
    const bundleNoJournal = await provider.getProject(PROJECT_ID);
    delete bundleNoJournal.journal;
    await provider.saveProject(bundleNoJournal);
    const journalAfterSave = await provider.getJournal(PROJECT_ID);
    check(
      "saveProject with a journal-less bundle preserves the existing journal",
      journalAfterSave.length === journalBeforeSave.length,
      `before ${journalBeforeSave.length}, after ${journalAfterSave.length}`,
    );
  }

  // --- exportProject reflects current (edited) state --------------------------
  {
    const exported = await provider.exportProject(PROJECT_ID);
    check(
      "exportProject reflects sandbox edits (serves current state)",
      exported.project.description === "Edited via saveProject in the sandbox.",
    );
  }

  // --- archiveProject rejects; importProject replaces in memory ---------------
  {
    let archiveThrew = false;
    try {
      await provider.archiveProject(PROJECT_ID);
    } catch {
      archiveThrew = true;
    }
    check("archiveProject rejects", archiveThrew);

    // importProject with a seed-id bundle is the raw-editor's save path,
    // routed here by id — it replaces the in-memory sandbox, same as
    // saveProject, and hands back the (cloned) stored project.
    const exported = await provider.exportProject(PROJECT_ID);
    const importBundle = {
      ...exported,
      project: { ...exported.project, description: "Edited via importProject in the sandbox." },
    };
    const returnedProject = await provider.importProject(importBundle);
    check("importProject returns the imported project", returnedProject.id === PROJECT_ID);
    const rereadAfterImport = await provider.getProject(PROJECT_ID);
    check(
      "importProject with a seed-id bundle replaces the in-memory sandbox",
      rereadAfterImport.project.description === "Edited via importProject in the sandbox.",
      rereadAfterImport.project.description,
    );

    // A raw edit that omits the journal must not erase the sandbox's history
    // mid-session.
    const journalBeforeImport = await provider.getJournal(PROJECT_ID);
    const importBundleNoJournal = await provider.exportProject(PROJECT_ID);
    delete importBundleNoJournal.journal;
    await provider.importProject(importBundleNoJournal);
    const journalAfterImport = await provider.getJournal(PROJECT_ID);
    check(
      "importProject with a journal-less bundle preserves the existing journal",
      journalAfterImport.length === journalBeforeImport.length,
      `before ${journalBeforeImport.length}, after ${journalAfterImport.length}`,
    );

    // importProject with a NON-seed id rejects — it is the sandbox's save
    // path, not a general import mechanism.
    let nonSeedImportThrew = false;
    try {
      const foreignBundle = await provider.exportProject(PROJECT_ID);
      await provider.importProject({ ...foreignBundle, project: { ...foreignBundle.project, id: "some-other-project" } });
    } catch {
      nonSeedImportThrew = true;
    }
    check("importProject with a non-seed id rejects", nonSeedImportThrew);
  }

  // --- unknown project id: reads empty, mutation rejects -----------------------
  {
    const UNKNOWN = "not-a-real-project";
    const nodes = await provider.getNodes(UNKNOWN);
    const edges = await provider.getEdges(UNKNOWN);
    const journal = await provider.getJournal(UNKNOWN);
    const project = await provider.getProject(UNKNOWN);
    check("getNodes on an unknown project returns []", Array.isArray(nodes) && nodes.length === 0);
    check("getEdges on an unknown project returns []", Array.isArray(edges) && edges.length === 0);
    check("getJournal on an unknown project returns []", Array.isArray(journal) && journal.length === 0);
    check("getProject on an unknown project returns undefined", project === undefined);

    let mutationThrew = false;
    try {
      await provider.createNode({
        id: "V-nope",
        project_id: UNKNOWN,
        species: "view",
        title: "Nope",
        status: "idea",
        platforms: ["web"],
      });
    } catch {
      mutationThrew = true;
    }
    check("a mutation on an unknown project id rejects", mutationThrew);
  }

  // --- pristine source object never mutated ------------------------------------
  check(
    "the pristine SEED source object was never mutated by any of the above",
    JSON.stringify(SEED) === PRISTINE_SEED_JSON,
  );

  // --- a fresh createSeedProvider (= a refresh) is pristine again ---------------
  {
    const fresh = createSeedProvider(() => SEED);
    const nodes = await fresh.getNodes(PROJECT_ID);
    const journal = await fresh.getJournal(PROJECT_ID);
    check(
      "a fresh createSeedProvider has the original node count",
      nodes.length === SEED.nodes.length,
      `expected ${SEED.nodes.length}, got ${nodes.length}`,
    );
    check(
      "a fresh createSeedProvider has the original journal count",
      journal.length === (SEED.journal ?? []).length,
      `expected ${(SEED.journal ?? []).length}, got ${journal.length}`,
    );
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} seed-provider test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll seed-provider tests passed.");
}

main();

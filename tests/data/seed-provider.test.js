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
 * is pristine again. Two deliberate refusals: `archiveProject` (the public
 * project can't be "deleted") and `importProject` (unreachable — the routing
 * provider always sends imports to the local provider).
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

  // --- updateNode ------------------------------------------------------------
  {
    const updated = await provider.updateNode(PROJECT_ID, "V-sandbox", { title: "Sandbox View (edited)" });
    check("updateNode returns the updated node", updated.title === "Sandbox View (edited)");
    const nodes = await provider.getNodes(PROJECT_ID);
    const stored = nodes.find((n) => n.id === "V-sandbox");
    check("the update is reflected in getNodes", stored?.title === "Sandbox View (edited)");
  }

  // --- createEdge / deleteEdge -------------------------------------------------
  let sandboxEdgeId;
  {
    const existingSourceId = SEED.nodes[0].id;
    const edge = await provider.createEdge({
      id: "ignored-on-create",
      project_id: PROJECT_ID,
      source_id: existingSourceId,
      target_id: "V-sandbox",
      edge_type: "calls",
    });
    sandboxEdgeId = edge.id;
    check(
      "createEdge's returned id follows applyOps' e-{source}-{target} normalization",
      edge.id === `e-${existingSourceId}-V-sandbox`,
      edge.id,
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
  }

  // --- exportProject reflects current (edited) state --------------------------
  {
    const exported = await provider.exportProject(PROJECT_ID);
    check(
      "exportProject reflects sandbox edits (serves current state)",
      exported.project.description === "Edited via saveProject in the sandbox.",
    );
  }

  // --- archiveProject / importProject reject -----------------------------------
  {
    let archiveThrew = false;
    try {
      await provider.archiveProject(PROJECT_ID);
    } catch {
      archiveThrew = true;
    }
    check("archiveProject rejects", archiveThrew);

    let importThrew = false;
    try {
      await provider.importProject(await provider.exportProject(PROJECT_ID));
    } catch {
      importThrew = true;
    }
    check("importProject rejects", importThrew);
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

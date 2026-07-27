#!/usr/bin/env node

/**
 * Unit tests for the shared mutation core (packages/schema/src/mutate.ts).
 *
 * `applyOps` is where the app, the MCP server, and the hosted store now agree on
 * what a graph edit means. These tests pin the invariants that used to live in
 * only one of them:
 *   - composes-edge synthesis (was MCP-only)
 *   - the flow-cycle guard (was app-only)
 *   - edge-id normalization and the delete cascade
 *   - batch atomicity: a refusal partway through leaves the caller's graph alone
 *
 * Pure functions over plain objects — no store, no IndexedDB, no filesystem.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROJECT = "p1";

function node(id, species, extra = {}) {
  return {
    id,
    project_id: PROJECT,
    species,
    title: id,
    status: "idea",
    platforms: ["web"],
    ...extra,
  };
}

function flowWithPlaylist(id, refIds) {
  return node(id, "flow", {
    metadata: {
      playlist: {
        entries: refIds.map((refId) =>
          refId.startsWith("F-") ? { type: "flow", flow_id: refId } : { type: "view", view_id: refId },
        ),
      },
    },
  });
}

function graph(nodes = [], edges = []) {
  return { projectId: PROJECT, nodes, edges };
}

function main() {
  const schema = loadSchema();
  const { applyOps, MutationError, wouldCreateCycle, synthesizeComposesEdges } = schema;

  // --- create_node ---------------------------------------------------------
  {
    const out = applyOps(graph(), [{ op: "create_node", node: node("V-a", "view") }]);
    check("create_node appends the node", out.nodes.length === 1 && out.nodes[0].id === "V-a");
    check("create_node emits node.created", out.eventInputs.length === 1 && out.eventInputs[0].type === "node.created");
    check("create_node synthesizes nothing for a view", out.synthesizedEdges.length === 0);
  }
  {
    let threw = null;
    try {
      applyOps(graph([node("V-a", "view")]), [{ op: "create_node", node: node("V-a", "view") }]);
    } catch (err) {
      threw = err;
    }
    check("create_node refuses a duplicate id", threw instanceof MutationError && threw.code === "duplicate_node");
  }

  // --- composes synthesis (was MCP-only) -----------------------------------
  {
    const out = applyOps(graph([node("V-a", "view"), node("V-b", "view")]), [
      { op: "create_node", node: flowWithPlaylist("F-x", ["V-a", "V-b"]) },
    ]);
    check("a populated flow lands in one op", out.nodes.length === 3);
    check("one composes edge per playlist ref", out.synthesizedEdges.length === 2, String(out.synthesizedEdges.length));
    check(
      "synthesized edges are composes flow→ref",
      out.synthesizedEdges.every((e) => e.edge_type === "composes" && e.source_id === "F-x"),
    );
    check(
      "each synthesized edge emits edge.added",
      out.eventInputs.filter((e) => e.type === "edge.added").length === 2,
    );
  }
  {
    // A repeated reference must not produce two identical edges.
    const out = applyOps(graph([node("V-a", "view")]), [
      { op: "create_node", node: flowWithPlaylist("F-x", ["V-a", "V-a"]) },
    ]);
    check("a repeated playlist ref yields one edge", out.synthesizedEdges.length === 1);
  }
  {
    // An edge that already exists is left alone.
    const existing = {
      id: "e-F-x-V-a",
      project_id: PROJECT,
      source_id: "F-x",
      target_id: "V-a",
      edge_type: "composes",
    };
    const out = applyOps(graph([node("V-a", "view"), node("F-x", "flow")], [existing]), [
      { op: "update_node", node_id: "F-x", patch: flowWithPlaylist("F-x", ["V-a"]).metadata ? { metadata: flowWithPlaylist("F-x", ["V-a"]).metadata } : {} },
    ]);
    check("an existing composes edge is not duplicated", out.edges.length === 1, String(out.edges.length));
  }

  // --- cycle guard (was app-only) ------------------------------------------
  {
    check(
      "wouldCreateCycle catches a direct self-reference",
      wouldCreateCycle("F-x", "F-x", [node("F-x", "flow")]) === true,
    );
    const nodes = [flowWithPlaylist("F-a", ["F-b"]), flowWithPlaylist("F-b", [])];
    check("wouldCreateCycle catches an indirect loop", wouldCreateCycle("F-b", "F-a", nodes) === true);
    check("wouldCreateCycle allows an acyclic add", wouldCreateCycle("F-a", "F-b", nodes) === false);
  }
  {
    let threw = null;
    try {
      applyOps(graph([flowWithPlaylist("F-a", ["F-b"]), node("F-b", "flow")]), [
        { op: "update_node", node_id: "F-b", patch: { metadata: { playlist: { entries: [{ type: "flow", flow_id: "F-a" }] } } } },
      ]);
    } catch (err) {
      threw = err;
    }
    check(
      "applyOps refuses a playlist cycle (the MCP server's new guard)",
      threw instanceof MutationError && threw.code === "playlist_cycle",
      threw && threw.message,
    );
  }

  // --- update_node ---------------------------------------------------------
  {
    const out = applyOps(graph([node("V-a", "view")]), [
      { op: "update_node", node_id: "V-a", patch: { status: "live" } },
    ]);
    check("update_node applies the patch", out.nodes[0].status === "live");
    check(
      "a status change emits node.status_changed",
      out.eventInputs.some((e) => e.type === "node.status_changed"),
    );
  }
  {
    const out = applyOps(graph([node("V-a", "view")]), [
      { op: "update_node", node_id: "V-a", patch: { status: "idea" } },
    ]);
    check("a no-op patch emits nothing", out.eventInputs.length === 0);
  }
  {
    let threw = null;
    try {
      applyOps(graph(), [{ op: "update_node", node_id: "V-missing", patch: { status: "live" } }]);
    } catch (err) {
      threw = err;
    }
    check("update_node refuses an unknown node", threw instanceof MutationError && threw.code === "node_not_found");
  }

  // --- delete cascade ------------------------------------------------------
  {
    const edges = [
      { id: "e-F-x-V-a", project_id: PROJECT, source_id: "F-x", target_id: "V-a", edge_type: "composes" },
      { id: "e-V-a-DM-z", project_id: PROJECT, source_id: "V-a", target_id: "DM-z", edge_type: "displays" },
    ];
    const out = applyOps(graph([node("V-a", "view"), node("F-x", "flow"), node("DM-z", "data-model")], edges), [
      { op: "delete_node", node_id: "V-a" },
    ]);
    check("delete_node removes the node", out.nodes.every((n) => n.id !== "V-a"));
    check("delete_node cascades both attached edges", out.edges.length === 0);
    check("the cascade is reported", out.cascadedEdgeIds.length === 2);
    check(
      "the cascade emits node.deleted ONLY (journal.md:71)",
      out.eventInputs.length === 1 && out.eventInputs[0].type === "node.deleted",
      JSON.stringify(out.eventInputs.map((e) => e.type)),
    );
  }
  {
    const out = applyOps(graph([node("V-a", "view"), node("V-b", "view")]), [
      { op: "delete_nodes", node_ids: ["V-a", "V-missing"] },
    ]);
    check("delete_nodes ignores ids that are not present", out.nodes.length === 1 && out.nodes[0].id === "V-b");
    check("delete_nodes events name only real deletions", out.eventInputs.length === 1);
  }

  // --- edges ---------------------------------------------------------------
  {
    const out = applyOps(graph([node("V-a", "view"), node("DM-z", "data-model")]), [
      {
        op: "create_edge",
        edge: { id: "whatever-the-caller-said", project_id: PROJECT, source_id: "V-a", target_id: "DM-z", edge_type: "displays" },
      },
    ]);
    check("create_edge normalizes the id to e-{source}-{target}", out.edges[0].id === "e-V-a-DM-z", out.edges[0].id);
  }
  {
    const existing = { id: "e-V-a-DM-z", project_id: PROJECT, source_id: "V-a", target_id: "DM-z", edge_type: "displays" };
    const out = applyOps(graph([node("V-a", "view"), node("DM-z", "data-model")], [existing]), [
      { op: "create_edge", edge: { ...existing } },
    ]);
    check("re-creating an identical edge is a no-op", out.edges.length === 1 && out.eventInputs.length === 0);

    let threw = null;
    try {
      applyOps(graph([node("V-a", "view"), node("DM-z", "data-model")], [existing]), [
        { op: "create_edge", edge: { ...existing, edge_type: "queries" } },
      ]);
    } catch (err) {
      threw = err;
    }
    check(
      "the same endpoints with a different edge_type IS a conflict",
      threw instanceof MutationError && threw.code === "edge_type_conflict",
    );
  }
  {
    let threw = null;
    try {
      applyOps(graph(), [{ op: "delete_edge", edge_id: "e-nope" }]);
    } catch (err) {
      threw = err;
    }
    check("delete_edge refuses an unknown edge", threw instanceof MutationError && threw.code === "edge_not_found");
  }

  // --- batching (the reason applyMutations exists) -------------------------
  {
    const before = graph([node("V-anchor", "view")]);
    const out = applyOps(before, [
      { op: "create_node", node: node("AC-x", "acceptance") },
      {
        op: "create_edge",
        edge: { id: "", project_id: PROJECT, source_id: "AC-x", target_id: "V-anchor", edge_type: "covers" },
      },
    ]);
    check("a batch sees its own earlier ops", out.nodes.length === 2 && out.edges.length === 1);
    check("the batch emits both events", out.eventInputs.length === 2);
  }
  {
    // The whole point: a refusal partway through must not leave half applied.
    const nodes = [node("V-a", "view")];
    const edges = [];
    const before = graph(nodes, edges);
    let threw = null;
    try {
      applyOps(before, [
        { op: "create_node", node: node("V-new", "view") },
        { op: "delete_edge", edge_id: "e-nope" },
      ]);
    } catch (err) {
      threw = err;
    }
    check("a refused batch throws", threw instanceof MutationError);
    check("the caller's nodes are untouched by a refused batch", nodes.length === 1 && nodes[0].id === "V-a");
    check("the caller's edges are untouched by a refused batch", edges.length === 0);
  }

  // --- purity --------------------------------------------------------------
  {
    const nodes = [node("V-a", "view")];
    const edges = [];
    applyOps(graph(nodes, edges), [{ op: "create_node", node: node("V-b", "view") }]);
    check("applyOps never mutates the input arrays", nodes.length === 1 && edges.length === 0);
  }
  {
    const flow = flowWithPlaylist("F-x", ["V-a"]);
    const synthesized = synthesizeComposesEdges(flow, [], PROJECT);
    check("synthesizeComposesEdges is exported and pure", synthesized.length === 1 && synthesized[0].edge_type === "composes");
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll mutate-core checks passed.");
}

main();

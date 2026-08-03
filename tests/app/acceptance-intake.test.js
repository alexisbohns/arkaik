#!/usr/bin/env node

/**
 * Acceptance-first intake rules (lib/utils/acceptance-intake.ts) — issue #316.
 *
 * The claim these tests exist to defend is the one the issue is actually about:
 * **the product survives the workflow**. Membership is anchors-first, so
 * "preserve the product across a split" is two separate carries — the stored key
 * for a piece still in intake, and the `covers` anchors for a piece that has
 * them — and a plan that carried only one of them would look right in a diff and
 * be wrong on screen. So the split assertions do not inspect the ops and stop:
 * they run the plan through the real `applyOps` and then ask
 * `productsOfAcceptance`, the same function every read surface asks, whether
 * each piece landed where the original was.
 *
 * The second load-bearing group is the interaction § Decision 5 flagged and left
 * open: attaching an *unassigned* anchor empties an intake idea's membership and
 * drops it into triage. `attachEmptiesMembership` is what lets the panel say so,
 * and `inheritedProductFor` is what keeps the common path — decompose an idea
 * into a view created in the same gesture — from tripping it at all.
 *
 * Everything else here is data-loss shaped: ids that must not collide inside one
 * batch, dangling anchors that must not be multiplied across pieces, evidence
 * (gherkin, per-platform statuses) that must not be copied onto a piece that has
 * not earned it.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const { loadAcceptanceIntake, BUILD_DIR } = require("./load-acceptance-intake");

const {
  isAnchorSpecies,
  planAcceptanceAttach,
  planAcceptanceDetach,
  planAnchorForAcceptance,
  inheritedProductFor,
  attachEmptiesMembership,
  splitPieces,
  planAcceptanceSplit,
  productsOfAcceptance,
  applyOps,
} = loadAcceptanceIntake();

const PROJECT = "p1";

function node(id, species, extra = {}) {
  return { id, project_id: PROJECT, species, title: id, status: "idea", platforms: [], ...extra };
}

function covers(acceptanceId, anchorId) {
  return {
    id: `e-${acceptanceId}-${anchorId}`,
    project_id: PROJECT,
    source_id: acceptanceId,
    target_id: anchorId,
    edge_type: "covers",
  };
}

function byId(nodes) {
  return new Map(nodes.map((n) => [n.id, n]));
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Attach / detach
// ---------------------------------------------------------------------------

console.log("\nattach");

test("attaching an intake idea to a view creates one covers edge", () => {
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const view = node("V-notes", "view", { metadata: { product: "admin" } });
  assert.deepEqual(planAcceptanceAttach(acceptance, view, PROJECT, []), [
    { op: "create_edge", edge: covers("A-export", "V-notes") },
  ]);
});

test("attaching a node it already covers is a no-op", () => {
  const acceptance = node("A-export", "acceptance");
  const view = node("V-notes", "view");
  assert.deepEqual(planAcceptanceAttach(acceptance, view, PROJECT, [covers("A-export", "V-notes")]), []);
});

test("only views and flows can be covered", () => {
  // The `covers` grammar admits nothing else, and the row is read from
  // VALID_EDGE_SEMANTICS rather than restated, so this also guards the day a
  // sixth species arrives.
  assert.equal(isAnchorSpecies("view"), true);
  assert.equal(isAnchorSpecies("flow"), true);
  assert.equal(isAnchorSpecies("data-model"), false);
  const acceptance = node("A-export", "acceptance");
  assert.deepEqual(planAcceptanceAttach(acceptance, node("DM-note", "data-model"), PROJECT, []), []);
  assert.deepEqual(planAcceptanceAttach(acceptance, node("A-other", "acceptance"), PROJECT, []), []);
});

test("an acceptance cannot cover itself", () => {
  const acceptance = node("A-export", "acceptance");
  assert.deepEqual(planAcceptanceAttach(acceptance, acceptance, PROJECT, []), []);
});

console.log("\ndetach");

test("detach removes every covers edge to that anchor, and only those", () => {
  // `e-{source}-{target}` makes a duplicate unreachable through the app, but a
  // hand-edited bundle can carry one, and leaving it behind would put the anchor
  // straight back on screen after the user detached it.
  const edges = [
    covers("A-export", "V-notes"),
    { ...covers("A-export", "V-notes"), id: "legacy-uuid" },
    covers("A-export", "V-other"),
    covers("A-second", "V-notes"),
    { id: "e-V-notes-DM-note", project_id: PROJECT, source_id: "V-notes", target_id: "DM-note", edge_type: "displays" },
  ];
  assert.deepEqual(planAcceptanceDetach("A-export", "V-notes", edges), [
    { op: "delete_edge", edge_id: "e-A-export-V-notes" },
    { op: "delete_edge", edge_id: "legacy-uuid" },
  ]);
});

test("detaching a node it does not cover writes nothing", () => {
  assert.deepEqual(planAcceptanceDetach("A-export", "V-ghost", [covers("A-export", "V-notes")]), []);
});

// ---------------------------------------------------------------------------
// Creating an anchor for an idea
// ---------------------------------------------------------------------------

console.log("\ncreate-and-attach");

test("a view created for an intake idea is born into that idea's product", () => {
  // The whole point: anchors govern membership, so a view created with no
  // product would derive an empty membership for the acceptance covering it and
  // drop the idea back into triage the moment it was decomposed.
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const nodes = [acceptance];
  const plan = planAnchorForAcceptance(acceptance, "view", "  Session notes  ", PROJECT, [], byId(nodes));

  assert.equal(plan.node.id, "V-session-notes");
  assert.equal(plan.node.title, "Session notes");
  assert.equal(plan.node.species, "view");
  assert.equal(plan.node.status, "idea");
  assert.deepEqual(plan.node.platforms, []);
  assert.equal(plan.node.metadata.product, "admin");

  const next = applyOps({ projectId: PROJECT, nodes, edges: [] }, plan.ops);
  assert.deepEqual(
    [...productsOfAcceptance(acceptance, next.edges, byId(next.nodes))],
    ["admin"],
    "the idea must still be in Admin once it has an anchor",
  );
});

test("an acceptance spanning two products picks neither for the new node", () => {
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const nodes = [acceptance, node("V-a", "view", { metadata: { product: "admin" } }), node("V-b", "view", { metadata: { product: "care" } })];
  const edges = [covers("A-export", "V-a"), covers("A-export", "V-b")];
  assert.equal(inheritedProductFor(acceptance, edges, byId(nodes)), null);
  const plan = planAnchorForAcceptance(acceptance, "flow", "Export", PROJECT, edges, byId(nodes));
  assert.equal(plan.node.metadata, undefined, "no metadata key at all, not product: \"\"");
});

test("with no products declared the new node carries no metadata", () => {
  // The degenerate-case guarantee: a project that has never heard of products
  // must come out of this path byte-identical to the plain create path.
  const acceptance = node("A-export", "acceptance");
  const plan = planAnchorForAcceptance(acceptance, "view", "Notes", PROJECT, [], byId([acceptance]));
  assert.equal(plan.node.metadata, undefined);
});

test("a blank title creates nothing rather than a hash-suffixed id", () => {
  const acceptance = node("A-export", "acceptance");
  assert.equal(planAnchorForAcceptance(acceptance, "view", "   ", PROJECT, [], byId([acceptance])), null);
});

test("a title colliding with an existing node gets a suffixed id", () => {
  const acceptance = node("A-export", "acceptance");
  const nodes = [acceptance, node("V-notes", "view")];
  const plan = planAnchorForAcceptance(acceptance, "view", "Notes", PROJECT, [], byId(nodes));
  assert.equal(plan.node.id, "V-notes-2");
});

// ---------------------------------------------------------------------------
// The interaction § Decision 5 left open
// ---------------------------------------------------------------------------

console.log("\nattach into triage");

test("attaching an unassigned view empties an intake idea's membership", () => {
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const view = node("V-notes", "view");
  assert.equal(attachEmptiesMembership(acceptance, view, [], byId([acceptance, view])), true);
});

test("an assigned anchor never empties anything", () => {
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const view = node("V-notes", "view", { metadata: { product: "care" } });
  assert.equal(attachEmptiesMembership(acceptance, view, [], byId([acceptance, view])), false);
});

test("an already-anchored acceptance cannot be emptied by one more anchor", () => {
  // Its membership is the union of its anchors' — adding an unassigned one
  // contributes nothing and takes nothing away.
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const anchored = node("V-a", "view", { metadata: { product: "admin" } });
  const fresh = node("V-b", "view");
  const nodes = [acceptance, anchored, fresh];
  assert.equal(attachEmptiesMembership(acceptance, fresh, [covers("A-export", "V-a")], byId(nodes)), false);
});

test("an idea already in triage has nothing left to lose", () => {
  const acceptance = node("A-export", "acceptance");
  const view = node("V-notes", "view");
  assert.equal(attachEmptiesMembership(acceptance, view, [], byId([acceptance, view])), false);
});

test("a dangling covers edge does not count as being anchored", () => {
  // `productsOfAcceptance` skips unresolvable anchors, so an acceptance whose
  // only edge points at a missing node still reads its membership from the
  // stored key — and can still be dropped into triage by a real one.
  const acceptance = node("A-export", "acceptance", { metadata: { product: "admin" } });
  const view = node("V-notes", "view");
  const nodes = byId([acceptance, view]);
  assert.equal(attachEmptiesMembership(acceptance, view, [covers("A-export", "V-gone")], nodes), true);
});

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

console.log("\nsplit pieces");

test("pieces are trimmed, blank-free and duplicate-free, first spelling wins", () => {
  assert.deepEqual(splitPieces(["  Export as PDF ", "", "   ", "export as pdf", "Export as CSV"]), [
    "Export as PDF",
    "Export as CSV",
  ]);
});

console.log("\nsplit");

test("a split into fewer than two pieces writes nothing", () => {
  const original = node("A-export", "acceptance", { title: "Export notes" });
  assert.deepEqual(planAcceptanceSplit(original, ["Export notes"], PROJECT, [], byId([original])), []);
  assert.deepEqual(planAcceptanceSplit(original, ["", "  "], PROJECT, [], byId([original])), []);
});

test("the first piece renames the original, and only when it changed", () => {
  const original = { ...node("A-export", "acceptance"), title: "Export notes" };
  const nodes = byId([original]);

  const renamed = planAcceptanceSplit(original, ["Export as PDF", "Export as CSV"], PROJECT, [], nodes);
  assert.deepEqual(renamed[0], { op: "update_node", node_id: "A-export", patch: { title: "Export as PDF" } });

  const kept = planAcceptanceSplit(original, ["Export notes", "Export as CSV"], PROJECT, [], nodes);
  assert.equal(kept.some((op) => op.op === "update_node"), false, "an unchanged title is not a write");
});

test("an anchored acceptance splits into pieces that stay in the same product", () => {
  // Both carries at once. The stored key alone would leave every piece in
  // triage (anchors govern); the anchors alone would be enough here but not for
  // the intake case below — and the issue asks for the product to survive both.
  const original = {
    ...node("A-export", "acceptance", { metadata: { product: "care", values: ["time"], gherkin: "When … Then …" } }),
    title: "Export notes",
    platforms: ["web"],
    status: "live",
  };
  const view = node("V-notes", "view", { metadata: { product: "admin" } });
  const nodes = [original, view];
  const edges = [covers("A-export", "V-notes")];

  const ops = planAcceptanceSplit(original, ["Export as PDF", "Export as CSV"], PROJECT, edges, byId(nodes));
  const next = applyOps({ projectId: PROJECT, nodes, edges }, ops);
  const nextById = byId(next.nodes);
  const piece = nextById.get("AC-export-as-csv");

  assert.ok(piece, "the second piece exists");
  assert.deepEqual([...productsOfAcceptance(piece, next.edges, nextById)], ["admin"]);
  assert.deepEqual(
    [...productsOfAcceptance(nextById.get("A-export"), next.edges, nextById)],
    ["admin"],
    "and so does the piece that renamed the original",
  );
  assert.deepEqual(piece.platforms, ["web"], "platform availability carries");
  assert.deepEqual(piece.metadata.values, ["time"], "the Why carries");
  assert.equal(piece.metadata.product, "care", "the stored key carries, for the day it stops covering anything");
  assert.equal(piece.status, "idea", "a new piece has not been verified, whatever it was split out of");
  assert.equal(piece.metadata.gherkin, undefined, "the How is about the specific piece, and is not duplicated");
});

test("an intake idea splits into pieces that keep the product it was filed under", () => {
  const original = { ...node("A-export", "acceptance", { metadata: { product: "admin" } }), title: "Export notes" };
  const nodes = [original];

  const ops = planAcceptanceSplit(original, ["Export as PDF", "Export as CSV"], PROJECT, [], byId(nodes));
  const next = applyOps({ projectId: PROJECT, nodes, edges: [] }, ops);
  const nextById = byId(next.nodes);

  for (const id of ["A-export", "AC-export-as-csv"]) {
    assert.deepEqual([...productsOfAcceptance(nextById.get(id), next.edges, nextById)], ["admin"], id);
  }
});

test("per-platform evidence is not copied onto a new piece", () => {
  const original = {
    ...node("A-export", "acceptance", {
      metadata: {
        platformStatuses: { web: "live" },
        platformNotes: { web: "shipped in 4.2" },
        platformScreenshots: { web: "shot.png" },
      },
    }),
    title: "Export notes",
    platforms: ["web"],
  };
  const ops = planAcceptanceSplit(original, ["A", "B"], PROJECT, [], byId([original]));
  const created = ops.find((op) => op.op === "create_node").node;
  assert.equal(created.metadata, undefined);
});

test("pieces whose titles kebab-case identically get distinct ids", () => {
  // `deriveNodeId` can only disambiguate against what it is handed, so ids
  // minted earlier in the same batch have to be fed back in — otherwise both
  // pieces claim `AC-export-pdf` and `applyOps` refuses the batch.
  const original = { ...node("A-x", "acceptance"), title: "Original" };
  const nodes = [original];
  const ops = planAcceptanceSplit(original, ["Keep", "Export/PDF", "Export PDF"], PROJECT, [], byId(nodes));
  const ids = ops.filter((op) => op.op === "create_node").map((op) => op.node.id);
  assert.deepEqual(ids, ["AC-export-pdf", "AC-export-pdf-2"]);
  assert.doesNotThrow(() => applyOps({ projectId: PROJECT, nodes, edges: [] }, ops));
});

test("a dangling anchor is not multiplied across the pieces", () => {
  // `applyOps` does not check that an edge's endpoints exist, so nothing
  // downstream would refuse three copies of one broken reference.
  const original = { ...node("A-export", "acceptance"), title: "Export notes" };
  const view = node("V-notes", "view");
  const nodes = [original, view];
  const edges = [covers("A-export", "V-notes"), covers("A-export", "V-gone")];

  const ops = planAcceptanceSplit(original, ["A", "B", "C"], PROJECT, edges, byId(nodes));
  const targets = ops.filter((op) => op.op === "create_edge").map((op) => op.edge.target_id);
  assert.deepEqual(targets, ["V-notes", "V-notes"]);
});

// The transpiled CommonJS is a build artefact, not a fixture.
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll acceptance-intake tests passed" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * The landing page's gates: every fixture id resolves in the seed it names,
 * every section's preview is in the catalogue, every part has sections, copy
 * is non-empty, and the slice is the induced sub-bundle it claims to be.
 */
const fs = require("fs");
const path = require("path");
const { loadLanding } = require("./load-landing");

const { PREVIEW_IDS, PREVIEW_META, PARTS, SECTIONS, FIXTURES, sliceBundle, prepareBundle, LANDING_QUALITY, LANDING_QUALITY_EVENTS } = loadLanding();
const { QualitySectionSchema, resolveKritikLibrary, deriveQualityMatrix, KnownJournalEventSchema } = require(path.join(require("../schema/load-schema").BUILD_DIR, "index.js"));

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else { failures++; console.log(`FAIL: ${message}`); }
}

const ROOT = path.join(__dirname, "..", "..");
const pebbles = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const SEEDS = {
  "self-map": JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8")),
  pebbles,
  // Mirrors lib/landing/seeds.ts: Pebbles plus the illustrative audit.
  "pilot-audit": { ...pebbles, quality: LANDING_QUALITY, journal: [...(pebbles.journal ?? []), ...LANDING_QUALITY_EVENTS] },
};
const nodeIds = Object.fromEntries(Object.entries(SEEDS).map(([k, b]) => [k, new Set(b.nodes.map((n) => n.id))]));
const versions = Object.fromEntries(
  Object.entries(SEEDS).map(([k, b]) => [k, new Set((b.journal ?? []).filter((e) => e.type === "release.tagged").map((e) => e.version))]),
);

// Catalogue
assert(PREVIEW_IDS.length > 0, "catalogue is non-empty");
for (const id of PREVIEW_IDS) {
  const meta = PREVIEW_META[id];
  assert(meta && ["self-map", "pebbles", "pilot-audit"].includes(meta.source), `${id}: names a seed source`);
  assert(meta && Number.isInteger(meta.height) && meta.height >= 160, `${id}: fixed frame height`);
  assert(meta && Array.isArray(meta.breadcrumb) && meta.breadcrumb.length > 0, `${id}: breadcrumb`);
  assert(meta && typeof meta.journal === "boolean", `${id}: journal flag`);
}

// Content
assert(PARTS.length > 0, "parts are non-empty");
for (const part of PARTS) {
  const sections = SECTIONS.filter((s) => s.part === part.id);
  assert(sections.length > 0, `part ${part.id}: has sections`);
  assert(part.title && part.intro, `part ${part.id}: title and intro`);
}
for (const s of SECTIONS) {
  assert(PARTS.some((p) => p.id === s.part), `${s.id}: known part`);
  assert(s.title && s.why && s.what && s.how, `${s.id}: why/what/how present`);
  assert(s.preview === "none" || PREVIEW_IDS.includes(s.preview), `${s.id}: preview in catalogue`);
}

// Fixtures: every id exists in the seed the fixture names
for (const [previewId, fixture] of Object.entries(FIXTURES)) {
  const ids = nodeIds[fixture.source];
  assert(ids, `${previewId}: fixture source known`);
  if (!ids) continue;
  for (const id of fixture.nodeIds ?? []) assert(ids.has(id), `${previewId}: node ${id} exists in ${fixture.source}`);
  for (const v of fixture.versions ?? []) assert(versions[fixture.source].has(v), `${previewId}: release ${v} exists in ${fixture.source}`);
  assert(PREVIEW_META[previewId] && PREVIEW_META[previewId].source === fixture.source, `${previewId}: fixture source matches catalogue`);
}

// Slice: induced sub-bundle
{
  const b = SEEDS["self-map"];
  const edge = b.edges.find((e) => e.edge_type === "covers");
  const keep = [edge.source_id, edge.target_id];
  const s = sliceBundle(b, keep);
  assert(s.nodes.length === 2 && s.nodes.every((n) => keep.includes(n.id)), "slice keeps exactly the requested nodes");
  assert(s.edges.every((e) => keep.includes(e.source_id) && keep.includes(e.target_id)), "slice keeps only induced edges");
  assert(s.edges.some((e) => e.id === edge.id), "slice keeps the inducing edge");
  const stray = (s.journal ?? []).find((e) => e.node_id && !keep.includes(e.node_id));
  assert(!stray, "slice keeps only events about kept nodes (plus node-less events)");
  assert((s.journal ?? []).some((e) => e.type === "release.tagged"), "slice keeps release.tagged events");
  assert(s.project === b.project, "slice reuses the project record");
}

// Prepare: client previews receive only their subgraph
{
  const self = SEEDS["self-map"];
  const journey = prepareBundle("journey-map", self);
  const [rootFlow] = FIXTURES["journey-map"].nodeIds;
  assert(journey.nodes.some((n) => n.id === rootFlow), "journey slice contains the root flow");
  assert(journey.nodes.length > 1 && journey.nodes.length < 60, `journey slice is small (${journey.nodes.length} nodes)`);
  {
    // Every `calls` edge touching a view of the closure survives, endpoint included.
    const journeyIds = new Set(journey.nodes.map((n) => n.id));
    const journeyEdgeIds = new Set(journey.edges.map((e) => e.id));
    const viewIds = new Set(journey.nodes.filter((n) => n.species === "view").map((n) => n.id));
    const calls = self.edges.filter((e) => e.edge_type === "calls" && (viewIds.has(e.source_id) || viewIds.has(e.target_id)));
    assert(calls.length > 0, `journey closure views have calls edges (${calls.length})`);
    assert(calls.every((e) => journeyEdgeIds.has(e.id)), "journey slice keeps every calls edge of its views");
    assert(calls.every((e) => journeyIds.has(e.source_id) && journeyIds.has(e.target_id)), "journey slice contains the endpoints those calls name");
  }

  const system = prepareBundle("system-map", self);
  const [anchor] = FIXTURES["system-map"].nodeIds;
  assert(system.nodes.some((n) => n.id === anchor), "system slice contains the anchor");
  assert(system.nodes.length > 1 && system.nodes.length < 60, `system slice is small (${system.nodes.length} nodes)`);

  const pebbles = SEEDS.pebbles;
  const matrix = prepareBundle("acceptance-matrix", pebbles);
  const matrixIds = new Set(matrix.nodes.map((n) => n.id));
  for (const id of FIXTURES["acceptance-matrix"].nodeIds) assert(matrixIds.has(id), `matrix slice contains pinned ${id}`);
  const acceptanceIds = new Set(pebbles.nodes.filter((n) => n.species === "acceptance").map((n) => n.id));
  const covered = pebbles.edges.filter((e) => e.edge_type === "covers" && acceptanceIds.has(e.source_id)).map((e) => e.target_id);
  assert(covered.length > 0 && covered.every((id) => matrixIds.has(id)), "matrix slice contains every covered node");
  assert([...acceptanceIds].every((id) => matrixIds.has(id)), "matrix slice contains every acceptance");

  for (const id of PREVIEW_IDS) {
    if (id === "journey-map" || id === "system-map" || id === "acceptance-matrix") continue;
    const seed = SEEDS[PREVIEW_META[id].source];
    assert(prepareBundle(id, seed).nodes.length === seed.nodes.length, `${id}: prepare leaves the bundle whole`);
  }
}

// Quality fixture: parses, resolves a library, derives a grade per surface, names real nodes
{
  const parsed = QualitySectionSchema.safeParse(LANDING_QUALITY);
  assert(parsed.success, `quality fixture parses (${parsed.success ? "ok" : JSON.stringify(parsed.error.issues[0])})`);
  const library = resolveKritikLibrary(LANDING_QUALITY);
  assert(library && library.criteria.length > 0, "quality fixture carries its own library");
  const matrix = deriveQualityMatrix({ quality: LANDING_QUALITY }, library);
  for (const surface of LANDING_QUALITY.profile.surfaces) {
    assert(typeof matrix.overall[surface.id] === "number", `quality fixture scores surface ${surface.id}`);
  }
  assert(LANDING_QUALITY.findings.some((f) => f.status === "open"), "quality fixture has an open finding");
  assert(LANDING_QUALITY.findings.some((f) => f.status === "resolved"), "quality fixture has a resolved finding");
  for (const f of LANDING_QUALITY.findings) {
    for (const id of f.node_ids ?? []) assert(nodeIds.pebbles.has(id), `finding ${f.id} names node ${id} in pebbles`);
  }
  for (const e of LANDING_QUALITY_EVENTS) {
    const ok = KnownJournalEventSchema.safeParse(e);
    assert(ok.success, `quality event ${e.type} is a known journal event`);
  }
  assert(LANDING_QUALITY_EVENTS.some((e) => e.type === "quality.signal.tripped"), "quality events include a tripped signal");
}

// Generated samples: present, shaped, and about the self-map
{
  const gen = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "landing", "generated", name), "utf8"));
  const cli = gen("cli-validate.json");
  assert(cli.command.startsWith("arkaik validate"), "cli sample records its command");
  assert(/Result: VALID/.test(cli.output), "cli sample is a VALID run");
  assert(cli.output.includes(`Nodes: ${SEEDS["self-map"].nodes.length}`), "cli sample counts the self-map's nodes");
  const mcp = gen("mcp-call.json");
  assert(mcp.tool === "list_nodes" && mcp.arguments && typeof mcp.arguments === "object", "mcp sample is a list_nodes call");
  assert(Array.isArray(mcp.result.nodes) && mcp.result.nodes.length > 0 && mcp.result.nodes.length <= mcp.arguments.limit, "mcp sample result is bounded by its limit");
  assert(mcp.result.nodes.every((n) => nodeIds["self-map"].has(n.id)), "mcp sample nodes exist in the self-map");
}

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll landing tests passed.");

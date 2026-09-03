#!/usr/bin/env node
/**
 * The landing page's gates: every fixture id resolves in the seed it names,
 * every section's preview is in the catalogue, every part has sections, copy
 * is non-empty, and the slice is the induced sub-bundle it claims to be.
 */
const fs = require("fs");
const path = require("path");
const { loadLanding } = require("./load-landing");

const { PREVIEW_IDS, PREVIEW_META, PARTS, SECTIONS, FIXTURES, sliceBundle } = loadLanding();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else { failures++; console.log(`FAIL: ${message}`); }
}

const ROOT = path.join(__dirname, "..", "..");
const SEEDS = {
  "self-map": JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8")),
  pebbles: JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8")),
};
const nodeIds = Object.fromEntries(Object.entries(SEEDS).map(([k, b]) => [k, new Set(b.nodes.map((n) => n.id))]));
const versions = Object.fromEntries(
  Object.entries(SEEDS).map(([k, b]) => [k, new Set((b.journal ?? []).filter((e) => e.type === "release.tagged").map((e) => e.version))]),
);

// Catalogue
assert(PREVIEW_IDS.length > 0, "catalogue is non-empty");
for (const id of PREVIEW_IDS) {
  const meta = PREVIEW_META[id];
  assert(meta && (meta.source === "self-map" || meta.source === "pebbles"), `${id}: names a seed source`);
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

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll landing tests passed.");

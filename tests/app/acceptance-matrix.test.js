const { loadAcceptanceMatrix, BUILD_DIR } = require("./load-acceptance-matrix");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { filterAcceptances, groupAcceptancesByAnchor, EMPTY_FILTERS } = loadAcceptanceMatrix();

const view = { id: "V-detail", project_id: "p", species: "view", title: "Detail", status: "live", platforms: ["web", "ios", "android"] };
const flow = { id: "F-swap", project_id: "p", species: "flow", title: "Swap", status: "live", platforms: ["web", "ios"], metadata: { playlist: { entries: [] } } };
const acc1 = { id: "AC-anim", project_id: "p", species: "acceptance", title: "Draw-in animation", status: "backlog",
  platforms: ["web", "ios", "android"], metadata: { gherkin: "When on Detail, Then animate.", values: ["fun-entertainment"], platformStatuses: { ios: "live", android: "development" } } };
const acc2 = { id: "AC-palette", project_id: "p", species: "acceptance", title: "Emotion palette", status: "live",
  platforms: ["web", "ios"], metadata: { values: ["reduces-anxiety"] } };
const accProduct = { id: "AC-offline", project_id: "p", species: "acceptance", title: "Offline capture", status: "development",
  platforms: ["ios"], metadata: { values: ["reduces-risk"] } };
const nodes = [view, flow, acc1, acc2, accProduct];
const acceptances = [acc1, acc2, accProduct];
const edges = [
  { id: "e-AC-anim-F-swap", project_id: "p", source_id: "AC-anim", target_id: "F-swap", edge_type: "covers" },
  { id: "e-AC-anim-V-detail", project_id: "p", source_id: "AC-anim", target_id: "V-detail", edge_type: "covers" },
  { id: "e-AC-palette-V-detail", project_id: "p", source_id: "AC-palette", target_id: "V-detail", edge_type: "covers" },
];
const nodesById = new Map(nodes.map((n) => [n.id, n]));

// --- filterAcceptances -------------------------------------------------------
check("no filters returns all", filterAcceptances(acceptances, edges, EMPTY_FILTERS).length === 3);
check("search matches title", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, search: "palette" }).map((a) => a.id).join() === "AC-palette");
check("search matches gherkin text", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, search: "animate" }).map((a) => a.id).join() === "AC-anim");
check("platform filter keeps only acceptances targeting it", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, platform: "android" }).map((a) => a.id).join() === "AC-anim");
check("status filter matches resolved status on any applicable platform",
  filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, status: "development" }).map((a) => a.id).sort().join() === "AC-anim,AC-offline");
check("platform+status filter matches that platform's resolved status",
  filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, platform: "ios", status: "live" }).map((a) => a.id).sort().join() === "AC-anim,AC-palette");
check("value filter", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, value: "reduces-anxiety" }).map((a) => a.id).join() === "AC-palette");
check("anchor filter keeps acceptances covering that anchor", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, anchor: "F-swap" }).map((a) => a.id).join() === "AC-anim");
check("parity_gap filter keeps only gapped acceptances", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, parityGap: true }).map((a) => a.id).join() === "AC-anim");

const accWithDesc = { ...acc2, id: "AC-desc", description: "supports quiet reflection", metadata: { values: ["reduces-anxiety"] } };
check("search matches description text",
  filterAcceptances([accWithDesc], edges, { ...EMPTY_FILTERS, search: "reflection" }).map((a) => a.id).join() === "AC-desc");
const danglingEdge = { id: "e-AC-offline-V-missing", project_id: "p", source_id: "AC-offline", target_id: "V-missing", edge_type: "covers" };
const dangGroups = groupAcceptancesByAnchor([accProduct], [danglingEdge], nodesById).groups;
check("acceptance whose only covers-edge targets a missing node falls to product-level",
  dangGroups.length === 1 && dangGroups[0].anchorId === null && dangGroups[0].acceptances[0].id === "AC-offline");

// --- groupAcceptancesByAnchor ------------------------------------------------
const { groups } = groupAcceptancesByAnchor(acceptances, edges, nodesById);
check("groups are ordered by anchor title, product-level last",
  groups.map((g) => g.anchorId ?? "__product__").join() === "V-detail,F-swap,__product__",
  groups.map((g) => g.anchorId ?? "__product__").join());
const productGroup = groups[groups.length - 1];
check("product group is the null-anchor bucket", productGroup.anchorId === null && productGroup.acceptances.map((a) => a.id).join() === "AC-offline");
const detailGroup = groups.find((g) => g.anchorId === "V-detail");
check("multi-anchor acceptance appears under each anchor", detailGroup.acceptances.some((a) => a.id === "AC-anim") && groups.find((g) => g.anchorId === "F-swap").acceptances.some((a) => a.id === "AC-anim"));
check("group carries anchor node + species + gap count", detailGroup.anchorNode.id === "V-detail" && detailGroup.anchorSpecies === "view" && detailGroup.gapCount === 1);
check("acceptance covering 2 anchors appears in exactly 2 groups",
  groups.filter((g) => g.acceptances.some((a) => a.id === "AC-anim")).length === 2);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} acceptance-matrix test(s) failed.`); process.exit(1); }
console.log("\nAll acceptance-matrix tests passed.");

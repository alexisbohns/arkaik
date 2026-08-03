const { loadAcceptanceMatrix, BUILD_DIR } = require("./load-acceptance-matrix");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const {
  filterAcceptances,
  groupAcceptancesByAnchor,
  productsOfAcceptance,
  EMPTY_FILTERS,
  UNANCHORED_GROUP_LABEL,
  UNANCHORED_FILTER,
} = loadAcceptanceMatrix();

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
check("no filters returns all", filterAcceptances(acceptances, edges, nodesById, EMPTY_FILTERS).length === 3);
check("search matches title", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, search: "palette" }).map((a) => a.id).join() === "AC-palette");
check("search matches gherkin text", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, search: "animate" }).map((a) => a.id).join() === "AC-anim");
check("platform filter keeps only acceptances targeting it", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, platform: "android" }).map((a) => a.id).join() === "AC-anim");
check("status filter matches resolved status on any applicable platform",
  filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, status: "development" }).map((a) => a.id).sort().join() === "AC-anim,AC-offline");
check("platform+status filter matches that platform's resolved status",
  filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, platform: "ios", status: "live" }).map((a) => a.id).sort().join() === "AC-anim,AC-palette");
check("value filter", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, value: "reduces-anxiety" }).map((a) => a.id).join() === "AC-palette");
check("anchor filter keeps acceptances covering that anchor", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, anchor: "F-swap" }).map((a) => a.id).join() === "AC-anim");
check("parity_gap filter keeps only gapped acceptances", filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, parityGap: true }).map((a) => a.id).join() === "AC-anim");
check("the unanchored filter is the intake inbox — acceptances covering nothing",
  filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, anchor: UNANCHORED_FILTER }).map((a) => a.id).join() === "AC-offline");
// The filter and the group it exists to reach must agree about a dangling edge,
// or "Unanchored (intake)" would hide an acceptance the matrix files under
// "Unanchored" a screen further down.
check("the unanchored filter counts a dangling covers edge as unanchored, like the group does",
  filterAcceptances(acceptances, [...edges, { id: "e-AC-offline-V-missing", project_id: "p", source_id: "AC-offline", target_id: "V-missing", edge_type: "covers" }],
    nodesById, { ...EMPTY_FILTERS, anchor: UNANCHORED_FILTER }).map((a) => a.id).join() === "AC-offline");
check("the sentinel did not swallow the named-anchor branch",
  filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, anchor: "V-detail" }).map((a) => a.id).sort().join() === "AC-anim,AC-palette");

const accWithDesc = { ...acc2, id: "AC-desc", description: "supports quiet reflection", metadata: { values: ["reduces-anxiety"] } };
check("search matches description text",
  filterAcceptances([accWithDesc], edges, nodesById, { ...EMPTY_FILTERS, search: "reflection" }).map((a) => a.id).join() === "AC-desc");
const danglingEdge = { id: "e-AC-offline-V-missing", project_id: "p", source_id: "AC-offline", target_id: "V-missing", edge_type: "covers" };
const dangGroups = groupAcceptancesByAnchor([accProduct], [danglingEdge], nodesById).groups;
check("acceptance whose only covers-edge targets a missing node falls to the unanchored bucket",
  dangGroups.length === 1 && dangGroups[0].anchorId === null && dangGroups[0].acceptances[0].id === "AC-offline");

// --- groupAcceptancesByAnchor ------------------------------------------------
const { groups } = groupAcceptancesByAnchor(acceptances, edges, nodesById);
check("groups are ordered by anchor title, unanchored last",
  groups.map((g) => g.anchorId ?? "__unanchored__").join() === "V-detail,F-swap,__unanchored__",
  groups.map((g) => g.anchorId ?? "__unanchored__").join());
const productGroup = groups[groups.length - 1];
check("the unanchored group is the null-anchor bucket", productGroup.anchorId === null && productGroup.acceptances.map((a) => a.id).join() === "AC-offline");
check("the unanchored bucket's user-facing label reads Unanchored", UNANCHORED_GROUP_LABEL === "Unanchored", String(UNANCHORED_GROUP_LABEL));
const detailGroup = groups.find((g) => g.anchorId === "V-detail");
check("multi-anchor acceptance appears under each anchor", detailGroup.acceptances.some((a) => a.id === "AC-anim") && groups.find((g) => g.anchorId === "F-swap").acceptances.some((a) => a.id === "AC-anim"));
check("group carries anchor node + species + gap count", detailGroup.anchorNode.id === "V-detail" && detailGroup.anchorSpecies === "view" && detailGroup.gapCount === 1);
check("acceptance covering 2 anchors appears in exactly 2 groups",
  groups.filter((g) => g.acceptances.some((a) => a.id === "AC-anim")).length === 2);

// --- product scope -----------------------------------------------------------
// Two products, and anchors that carry the membership. The acceptances are
// written so that "the anchor governs" is never vacuously true: AC-anchored's
// own metadata names the *other* product from the view it covers.
const adminView = { id: "V-console", project_id: "p", species: "view", title: "Console", status: "live", platforms: ["web"], metadata: { product: "admin" } };
const appView = { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web", "ios", "android"], metadata: { product: "end-user" } };
const looseView = { id: "V-orphan", project_id: "p", species: "view", title: "Orphan", status: "idea", platforms: ["web"], metadata: {} };

const accAnchored = { id: "AC-anchored", project_id: "p", species: "acceptance", title: "Bulk archive", status: "live",
  platforms: ["web"], metadata: { product: "end-user" } };
const accSpanning = { id: "AC-spanning", project_id: "p", species: "acceptance", title: "Session export", status: "development",
  platforms: ["web", "ios"], metadata: {} };
const accIntake = { id: "AC-intake", project_id: "p", species: "acceptance", title: "Therapist notes", status: "idea",
  platforms: ["web"], metadata: { product: "admin" } };
const accTriage = { id: "AC-triage", project_id: "p", species: "acceptance", title: "Someday maybe", status: "idea",
  platforms: ["web"], metadata: {} };
const accLooseAnchor = { id: "AC-loose", project_id: "p", species: "acceptance", title: "Orphan cover", status: "idea",
  platforms: ["web"], metadata: { product: "admin" } };

const scoped = [accAnchored, accSpanning, accIntake, accTriage, accLooseAnchor];
const scopedNodesById = new Map([adminView, appView, looseView, ...scoped].map((n) => [n.id, n]));
const scopedEdges = [
  { id: "e-AC-anchored-V-console", project_id: "p", source_id: "AC-anchored", target_id: "V-console", edge_type: "covers" },
  { id: "e-AC-spanning-V-console", project_id: "p", source_id: "AC-spanning", target_id: "V-console", edge_type: "covers" },
  { id: "e-AC-spanning-V-home", project_id: "p", source_id: "AC-spanning", target_id: "V-home", edge_type: "covers" },
  { id: "e-AC-loose-V-orphan", project_id: "p", source_id: "AC-loose", target_id: "V-orphan", edge_type: "covers" },
];
const inScope = (product) =>
  filterAcceptances(scoped, scopedEdges, scopedNodesById, { ...EMPTY_FILTERS, product }).map((a) => a.id).sort().join();

check("EMPTY_FILTERS scopes to All products", EMPTY_FILTERS.product === null);
check("product scope keeps its anchored and its anchorless members",
  inScope("admin") === "AC-anchored,AC-intake,AC-spanning", inScope("admin"));
check("product scope drops an anchorless acceptance with no membership",
  !inScope("admin").includes("AC-triage") && !inScope("end-user").includes("AC-triage"), inScope("end-user"));
check("All products keeps everything, unassigned included",
  inScope(null) === "AC-anchored,AC-intake,AC-loose,AC-spanning,AC-triage", inScope(null));
check("an anchored acceptance is scoped by its anchor's product, not its own metadata",
  inScope("admin").includes("AC-anchored") && !inScope("end-user").includes("AC-anchored"),
  `admin=${inScope("admin")} end-user=${inScope("end-user")}`);
check("an acceptance spanning two products appears under both",
  inScope("admin").includes("AC-spanning") && inScope("end-user").includes("AC-spanning"), inScope("end-user"));
check("an acceptance whose only anchor is unassigned is in triage, stored membership notwithstanding",
  !inScope("admin").includes("AC-loose"), inScope("admin"));
check("productsOfAcceptance returns every product an acceptance spans",
  [...productsOfAcceptance(accSpanning, scopedEdges, scopedNodesById)].sort().join() === "admin,end-user");
check("productsOfAcceptance returns an empty set for an unassigned anchorless acceptance",
  productsOfAcceptance(accTriage, scopedEdges, scopedNodesById).size === 0);

const scopedGroups = groupAcceptancesByAnchor(
  filterAcceptances(scoped, scopedEdges, scopedNodesById, { ...EMPTY_FILTERS, product: "admin" }),
  scopedEdges,
  scopedNodesById,
).groups;
check("a scoped list still ends with the null-anchor bucket",
  scopedGroups[scopedGroups.length - 1].anchorId === null &&
    scopedGroups[scopedGroups.length - 1].acceptances.map((a) => a.id).join() === "AC-intake",
  scopedGroups.map((g) => g.anchorId ?? "__unanchored__").join());

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} acceptance-matrix test(s) failed.`); process.exit(1); }
console.log("\nAll acceptance-matrix tests passed.");

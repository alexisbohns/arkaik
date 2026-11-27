// The Acceptances model (lib/utils/acceptances-model.ts): every rule the directory, the
// Parity monitor and the acceptance panel render instead of re-deriving.
const fs = require("fs");
const { loadAcceptancesModel, BUILD_DIR } = require("./load-acceptances-model");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { buildAcceptancesModel, buildAcceptancePanel } = loadAcceptancesModel();

const P = "p";
const view = (id, title) => ({ id, project_id: P, species: "view", title, status: "live", platforms: ["web", "ios", "android"] });
const flow = (id, title, viewIds) => ({
  id, project_id: P, species: "flow", title, status: "live", platforms: ["web", "ios", "android"],
  metadata: { playlist: { entries: viewIds.map((v) => ({ type: "view", view_id: v })) } },
});
const acc = (id, title, platforms, status, platformStatuses = {}) => ({
  id, project_id: P, species: "acceptance", title, status, platforms, metadata: { platformStatuses },
});
const covers = (a, t) => ({ id: `e-${a}-${t}`, project_id: P, source_id: a, target_id: t, edge_type: "covers" });
const composes = (s, t) => ({ id: `c-${s}-${t}`, project_id: P, source_id: s, target_id: t, edge_type: "composes" });

const nodes = [
  view("V-home", "Home"),
  view("V-detail", "Detail"),
  view("V-admin", "Admin"),
  view("V-lonely", "Lonely"),
  view("V-inner", "Inner"),
  flow("F-record", "Record", ["V-home"]),
  flow("F-empty", "Empty", []),
  // a web-only promise, live on web: kept, even with iOS and Android in scope
  acc("AC-web", "Admin opens on web", ["web"], "live", { web: "live" }),
  // live on web, behind on iOS: a parity gap
  acc("AC-gap", "Detail draws in", ["web", "ios"], "live", { web: "live", ios: "development" }),
  acc("AC-home", "Home greets you", ["web", "ios", "android"], "live", { web: "live", ios: "live", android: "live" }),
  acc("AC-free", "Nothing anchors this", ["web"], "idea"),
  acc("AC-outside", "On a screen no flow holds", ["web"], "idea"),
];
const edges = [
  composes("F-record", "V-detail"), // a flow composing a view: the view joins the journey
  composes("V-detail", "V-inner"), // view → view never pulls a screen into a flow
  covers("AC-web", "V-admin"),
  covers("AC-gap", "V-detail"),
  covers("AC-home", "V-home"),
  covers("AC-home", "F-record"),
  covers("AC-outside", "V-lonely"),
];
const nodesById = new Map(nodes.map((n) => [n.id, n]));
const acceptances = nodes.filter((n) => n.species === "acceptance");
const multi = { isMultiPlatform: true, platforms: ["web", "ios", "android"] };
const single = { isMultiPlatform: false, platforms: ["web"] };

const m = buildAcceptancesModel({ nodes, edges, nodesById, filtered: acceptances, scope: multi, weighingSection: undefined });
const pOf = (id) => m.promiseOf(nodesById.get(id));

// ── marks: the arity rule ──
check("multi-platform scope: one mark per platform", pOf("AC-home").marks.map((x) => x.platform).join() === "web,ios,android");
const one = buildAcceptancesModel({ nodes, edges, nodesById, filtered: acceptances, scope: single, weighingSection: undefined });
const lone = one.promiseOf(nodesById.get("AC-home")).marks;
check("single-platform scope: one mark, the project's one platform", lone.length === 1 && lone[0].platform === "web" && lone[0].live === true);

// ── kept everywhere ignores N/A ──
const web = pOf("AC-web");
check("a web-only promise has an N/A mark for iOS", web.marks.find((x) => x.platform === "ios").status === undefined);
check("a web-only promise live on web is kept everywhere (N/A never counts against it)", web.liveEverywhere === true);
const adminGroup = m.parity.groups.find((g) => g.anchor && g.anchor.id === "V-admin");
check("a group of web-only promises live on web is kept", adminGroup && adminGroup.allKept === true);
check("a promise with nothing live is not kept", pOf("AC-free").liveEverywhere === false);

// ── parity gaps ──
const gap = pOf("AC-gap");
check("live on web, in development on iOS is a parity gap", gap.hasGap === true);
check("the gap names the lagging platform", gap.lagging.map((l) => `${l.platform}:${l.status}`).join() === "ios:development");
check("a kept promise is not a gap", pOf("AC-home").hasGap === false);
check("a single-mark scope never shows a gap", one.promiseOf(nodesById.get("AC-gap")).hasGap === false);

// ── journeys ──
const record = m.mapping.journeys.find((j) => j.id === "F-record");
check("a journey holds its playlist's views and the views it composes", record.screens.map((s) => s.view.id).sort().join() === "V-detail,V-home");
check("a view→view compose does not pull a screen into the flow", !record.screens.some((s) => s.view.id === "V-inner"));
check("a promise covering the flow itself is a direct promise", record.direct.map((p) => p.id).join() === "AC-home");
check("a journey counts each promise once (flow + screen)", record.promises.filter((p) => p.id === "AC-home").length === 1);
check("a journey counts its gaps", record.gaps === 1);
check("a journey with no promise is still listed when nothing is filtered", m.mapping.journeys.some((j) => j.id === "F-empty"));
check("promises on screens no journey holds are 'outside'", m.mapping.outside.map((s) => s.view.id).sort().join() === "V-admin,V-lonely");
check("a promise covering nothing is unanchored", m.mapping.unanchored.map((p) => p.id).join() === "AC-free");
check("a promise knows the journeys it lives in", pOf("AC-gap").journeys.map((j) => j.id).join() === "F-record");

// ── filtering ──
const narrowed = buildAcceptancesModel({ nodes, edges, nodesById, filtered: [nodesById.get("AC-gap")], scope: multi, weighingSection: undefined });
check("a filter drops the journeys left with no promise", narrowed.mapping.journeys.map((j) => j.id).join() === "F-record");
check("the model says it is filtered", narrowed.filtered === true && narrowed.shown === 1 && narrowed.total === 5);

// ── value: no assessment yet means the default matrix, with nobody weighed ──
check("no weighing section: the default matrix still answers", m.value.available === true);
check("no assessment: every promise is unweighed, served nothing", m.value.unweighed === 5 && pOf("AC-home").unweighed === true && pOf("AC-home").weighing.served === 0);

// ── the panel ──
const panel = buildAcceptancePanel({ node: nodesById.get("AC-gap"), nodes, edges, scope: multi, weighingSection: undefined, readOnly: true });
check("the panel model carries the same promise and says read-only", panel.promise.hasGap === true && panel.readOnly === true);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall acceptances-model tests passed");

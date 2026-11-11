#!/usr/bin/env node

/**
 * The Screens map's wall model (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § The wall model): strips, frames, markers and jump tiles in Journey order;
 * per-platform states, stale reasons and live proof; counts and gaps; the
 * layout and its helpers; and the seed census the spec quotes.
 */

const fs = require("fs");
const path = require("path");
const { loadScreenWall } = require("./load-screen-wall");

const wallModule = loadScreenWall();
const { buildWall, resolveProductScope, buildProductGraph, getBaseNodeId } = wallModule;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
// Sections below append checks; the verdict is read once, as the process exits.
process.on("exit", () => {
  if (failures > 0) {
    console.log(`\n${failures} failing`);
    process.exitCode = 1;
  }
});

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const show = (value) => JSON.stringify(value);

const ROOT = path.join(__dirname, "..", "..");
const readSeed = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "seed", name), "utf8"));

const PRODUCTS = [
  { id: "app", title: "App", platforms: ["web", "ios", "android"], root_node_id: "V-home" },
  { id: "admin", title: "Admin", platforms: ["web"] },
];

const view = (id, title, extra = {}) => ({
  id,
  project_id: "p",
  species: "view",
  title,
  status: "live",
  platforms: ["web", "ios", "android"],
  ...extra,
  metadata: { product: "app", ...(extra.metadata ?? {}) },
});
const flow = (id, title, entries, product = "app") => ({
  id,
  project_id: "p",
  species: "flow",
  title,
  status: "development",
  platforms: ["web", "ios", "android"],
  metadata: { product, playlist: { entries } },
});
const node = (id, species, title, extra = {}) => ({ id, project_id: "p", species, title, status: "live", platforms: ["web"], ...extra });
const edge = (source_id, edge_type, target_id) => ({ id: `${source_id}-${edge_type}-${target_id}`, project_id: "p", source_id, target_id, edge_type });
const V = (view_id) => ({ type: "view", view_id });
const F = (flow_id) => ({ type: "flow", flow_id });

/** A wall over a hand-made snapshot. `root` is the project's front door. */
function wallOf({ nodes, edges = [], events = [], products = PRODUCTS, productId = null, root = "V-home", definition = null }) {
  const project = { root_node_id: root, metadata: { products } };
  const scope = resolveProductScope({ project }, productId);
  const graph = buildProductGraph(nodes, edges);
  return buildWall({ nodes, edges, events, project, definition, scope, graph });
}

// --- Strips: ordering rules 1–6, ids, jump tiles, markers ------------------

const ORDER_NODES = [
  view("V-home", "Home"),
  flow("F-zeta", "Zeta", [V("V-c")]),
  flow("F-a", "Onboard", [
    V("V-a"),
    F("F-c"),
    {
      type: "condition",
      label: "Has a streak?",
      if_true: [
        V("V-b"),
        { type: "junction", label: "Which?", cases: [{ label: "One", entries: [V("V-c")] }, { label: "Two", entries: [] }] },
      ],
      if_false: [F("F-e")],
    },
    V("V-a"),
    V("V-admin"),
    V("V-missing"),
  ]),
  flow("F-b", "Browse", [F("F-b"), V("V-d")]),
  flow("F-c", "Settle", [F("F-d")]),
  flow("F-d", "Drift", []),
  flow("F-e", "Explore", [V("V-d")]),
  flow("F-adm", "Moderate", [V("V-admin")], "admin"),
  view("V-a", "Alpha"),
  view("V-b", "Bravo"),
  view("V-c", "Charlie"),
  view("V-d", "Delta"),
  view("V-e", "apple"),
  view("V-f", "Banana"),
  view("V-g", "Apple"),
  view("V-admin", "Admin home", { platforms: ["web", "ios"], metadata: { product: "admin" } }),
  node("API-z", "api-endpoint", "Zed"),
  node("API-a", "api-endpoint", "Alpha endpoint"),
  node("DM-m", "data-model", "Model"),
];
const ORDER_EDGES = [
  edge("V-home", "composes", "F-a"),
  edge("V-home", "composes", "F-b"),
  edge("V-a", "calls", "API-z"),
  edge("V-a", "displays", "DM-m"),
  edge("V-a", "calls", "API-a"),
  edge("V-a", "calls", "API-a"),
  edge("API-z", "calls", "V-b"),
];

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const stripIds = wall.strips.map((strip) => strip.id);
  check("app scope: anchor's compose children, their sub-flows depth first, then the rest, then loose views",
    same(stripIds, ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "loose-strip"]), show(stripIds));
  check("platforms: the scope's menu, in PLATFORMS order", same(wall.platforms, ["web", "ios", "android"]), show(wall.platforms));
  check("a wall with flows is not empty", wall.empty === null);

  const onboard = wall.strips[0];
  check("a strip carries its flow id and title", onboard.flowId === "F-a" && onboard.title === "Onboard");
  const items = onboard.items.map((item) => item.id);
  check("strip items follow the playlist: frames, jump tiles, arm and end markers; other products and missing nodes skipped",
    same(items, [
      "V-a@F-a:0",
      "jump:F-a:1",
      "arm:F-a:2.0",
      "V-b@F-a:2.0.0",
      "arm:F-a:2.0.1.0",
      "V-c@F-a:2.0.1.0.0",
      "arm:F-a:2.0.1.1",
      "end:F-a:2.0.1",
      "arm:F-a:2.1",
      "jump:F-a:2.1.0",
      "end:F-a:2",
      "V-a@F-a:3",
    ]), show(items));
  const arms = onboard.items.filter((item) => item.kind === "arm");
  check("arm markers: branch kind, label, arm label, first, empty",
    same(arms.map((a) => [a.branch, a.label, a.arm, a.first, a.empty]), [
      ["condition", "Has a streak?", "Yes", true, false],
      ["junction", "Which?", "One", true, false],
      ["junction", "Which?", "Two", false, true],
      ["condition", "Has a streak?", "No", false, false],
    ]), show(arms));
  const jumps = onboard.items.filter((item) => item.kind === "jump");
  check("jump tiles name their flow and count the distinct views of its own strip",
    same(jumps.map((j) => [j.flowId, j.title, j.screenCount]), [["F-c", "Settle", 0], ["F-e", "Explore", 1]]), show(jumps));
  check("viewIds: distinct views in first-appearance order", same(onboard.viewIds, ["V-a", "V-b", "V-c"]), show(onboard.viewIds));

  const browse = wall.strips.find((strip) => strip.id === "strip:F-b");
  check("a flow that lists itself is a jump tile to its own strip",
    same(browse.items.map((i) => [i.kind, i.id, i.flowId ?? null, i.screenCount ?? null]), [["jump", "jump:F-b:0", "F-b", 1], ["frame", "V-d@F-b:1", null, null]]),
    show(browse.items));
  const drift = wall.strips.find((strip) => strip.id === "strip:F-d");
  check("a flow with nothing to show gets one empty item", same(drift.items, [{ kind: "empty", id: "empty:F-d" }]), show(drift.items));

  const loose = wall.strips[wall.strips.length - 1];
  check("Not in a flow: unlisted views by title (case-insensitive), then id",
    loose.flowId === null && loose.title === "Not in a flow" && same(loose.items.map((i) => i.id), ["V-e@loose", "V-g@loose", "V-f@loose", "V-home@loose"]),
    show(loose.items));

  const ids = [...wall.strips.map((s) => s.id), ...wall.strips.flatMap((s) => s.items.map((i) => i.id))];
  check("every id on the wall is unique", new Set(ids).size === ids.length);
  const frames = wall.strips.flatMap((s) => s.items).filter((i) => i.kind === "frame");
  check("every frame id decodes to its view", frames.every((f) => getBaseNodeId(f.id) === f.viewId));

  check("one screen per view in scope, in snapshot order",
    same([...wall.screens.keys()], ["V-home", "V-a", "V-b", "V-c", "V-d", "V-e", "V-f", "V-g"]), show([...wall.screens.keys()]));
  check("a screen lists the strips it appears in, in strip order",
    same(wall.screens.get("V-c").stripIds, ["strip:F-a", "strip:F-zeta"]) && same(wall.screens.get("V-d").stripIds, ["strip:F-e", "strip:F-b"]));
  check("touches: endpoints then models, each by title, outbound only, once each",
    same(wall.screens.get("V-a").touches.map((t) => [t.nodeId, t.species, t.title, t.status]), [
      ["API-a", "api-endpoint", "Alpha endpoint", "live"],
      ["API-z", "api-endpoint", "Zed", "live"],
      ["DM-m", "data-model", "Model", "live"],
    ]) && wall.screens.get("V-b").touches.length === 0,
    show(wall.screens.get("V-a").touches));

  check("frameIdsOf: every frame of a view, strip order then item order",
    same(wallModule.frameIdsOf(wall, "V-a"), ["V-a@F-a:0", "V-a@F-a:3"]) && same(wallModule.frameIdsOf(wall, "V-d"), ["V-d@F-e:0", "V-d@F-b:1"]));
  check("frameIdsOf: none for a view not on the wall", same(wallModule.frameIdsOf(wall, "V-admin"), []));
  check("stripIdOf and LOOSE_STRIP_ID", wallModule.stripIdOf("F-a") === "strip:F-a" && wallModule.LOOSE_STRIP_ID === "loose-strip");
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null });
  check("All products: every product's flows, another product's view listed where its flow puts it",
    same(wall.strips.map((s) => s.id), ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "strip:F-adm", "loose-strip"]) &&
      wall.strips[0].items.some((i) => i.id === "V-admin@F-a:4"),
    show(wall.strips.map((s) => s.id)));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null, root: null });
  check("no anchor and no product named: parentless flows in snapshot order, each with its sub-flows, then the rest",
    same(wall.strips.map((s) => s.id), ["strip:F-zeta", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-adm", "strip:F-a", "strip:F-b", "loose-strip"]),
    show(wall.strips.map((s) => s.id)));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "admin" });
  check("admin scope (no anchor): its own flows only, one platform",
    same(wall.strips.map((s) => s.id), ["strip:F-adm"]) && same(wall.platforms, ["web"]), show(wall.strips.map((s) => s.id)));
  const viaDefinition = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null, definition: { product: "admin" } });
  check("the definition's product narrows like the scope's", same(viaDefinition.strips.map((s) => s.id), ["strip:F-adm"]));
}

{
  // Touches are scoped like the views and flows: a chip may only name a node
  // the wall's scope keeps (`mapScopedNodes` over the scope's ProductGraph),
  // or clicking it would open a panel for a node the scope hides. The graph
  // here places API-adm in Admin only, so under App the App view's call to
  // it is not a touch, while the endpoints App reaches stay. Under All
  // products, every one.
  const nodes = [...ORDER_NODES, node("API-adm", "api-endpoint", "Admin endpoint")];
  const edges = [...ORDER_EDGES, edge("V-admin", "calls", "API-adm"), edge("V-a", "calls", "API-adm")];
  const graphEdges = edges.filter((candidate) => candidate.id !== "V-a-calls-API-adm");
  const project = { root_node_id: "V-home", metadata: { products: PRODUCTS } };
  const scoped = (productId) =>
    buildWall({
      nodes,
      edges,
      events: [],
      project,
      definition: null,
      scope: resolveProductScope({ project }, productId),
      graph: buildProductGraph(nodes, graphEdges),
    });
  const touchIds = (wall, viewId) => wall.screens.get(viewId).touches.map((touch) => touch.nodeId);
  check("touches under a product scope: only the nodes the scope keeps",
    same(touchIds(scoped("app"), "V-a"), ["API-a", "API-z", "DM-m"]), show(touchIds(scoped("app"), "V-a")));
  check("touches under All products: every endpoint and model the view reaches",
    same(touchIds(scoped(null), "V-a"), ["API-adm", "API-a", "API-z", "DM-m"]), show(touchIds(scoped(null), "V-a")));
  check("touches under the other product: its own view's endpoint is in scope",
    same(touchIds(scoped("admin"), "V-admin"), ["API-adm"]), show(touchIds(scoped("admin"), "V-admin")));
}

{
  const noFlows = wallOf({ nodes: [view("V-x", "X"), view("V-y", "Y")], productId: "app" });
  check("views but no flow: empty is no-flows, and the loose strip holds them",
    noFlows.empty === "no-flows" && same(noFlows.strips.map((s) => s.id), ["loose-strip"]) && noFlows.strips[0].items.length === 2);
  const nothing = wallOf({ nodes: [], productId: null });
  check("no flow and no view: empty is nothing, no strips", nothing.empty === "nothing" && nothing.strips.length === 0 && nothing.screens.size === 0);
}

// --- Seed census (spec § Ordering rules), All products ---------------------

function seedWall(name) {
  const bundle = readSeed(name);
  const scope = resolveProductScope(bundle, null);
  const graph = buildProductGraph(bundle.nodes, bundle.edges);
  const events = (bundle.journal ?? []).filter((ev) => wallModule.STALENESS_EVENT_TYPES.includes(ev.type));
  const input = { nodes: bundle.nodes, edges: bundle.edges, events, project: bundle.project, definition: null, scope, graph };
  return { input, wall: buildWall(input) };
}

function census(wall) {
  const items = wall.strips.flatMap((strip) => strip.items.map((item) => ({ ...item, loose: strip.flowId === null })));
  const kind = (k) => items.filter((item) => item.kind === k).length;
  return {
    strips: wall.strips.length,
    frames: kind("frame"),
    loose: items.filter((item) => item.kind === "frame" && item.loose).length,
    arms: kind("arm"),
    ends: kind("end"),
    jumps: kind("jump"),
    empties: kind("empty"),
  };
}

{
  const pebbles = census(seedWall("pebbles.json").wall);
  check("Pebbles census: 11 strips, 61 frames (28 loose), 13 arm + 4 end markers, 0 jump tiles",
    same(pebbles, { strips: 11, frames: 61, loose: 28, arms: 13, ends: 4, jumps: 0, empties: 0 }), show(pebbles));
  const selfMap = census(seedWall("arkaik-self-map.json").wall);
  check("Self-map census: 39 strips, 56 frames (2 loose), 46 arm + 21 end markers, 14 jump tiles",
    same(selfMap, { strips: 39, frames: 56, loose: 2, arms: 46, ends: 21, jumps: 14, empties: 0 }), show(selfMap));
}

// --- Cells: the state truth table, shots, stale reasons, live proof --------

const T0 = "2026-11-01T10:00:00.000Z";
const T1 = "2026-11-01T11:00:00.000Z";
const T2 = "2026-11-01T12:00:00.000Z";
const T3 = "2026-11-01T13:00:00.000Z";
const ac = (id, platforms, status = "live", platformStatuses) =>
  node(id, "acceptance", id, { status, platforms, metadata: platformStatuses ? { platformStatuses } : {} });
const toLive = (id, node_id, ts, extra = {}) => ({ id, ts, type: "node.status_changed", node_id, from: "releasing", to: "live", ...extra });
const iosView = (id) => view(id, id, { status: "idea", platforms: ["ios"] });

const CELL_NODES = [
  view("V-live", "Live", {
    metadata: {
      platformScreenshots: { web: "https://x/web.png", ios: "data:image/png;base64,AAAA" },
      platformScreenshotMeta: { web: { ts: T0, source: "ci", form: "url", commit: "abc" } },
    },
  }),
  view("V-mixed", "Mixed", {
    status: "development",
    metadata: {
      platformStatuses: { web: "live" },
      platformScreenshots: { ios: "shots/ios.png" },
      platformScreenshotMeta: { ios: { ts: T0, source: "manual" } },
    },
  }),
  view("V-covered", "Covered", { status: "idea", metadata: { platformScreenshots: { ios: "http://cdn/x.png" } } }),
  view("V-admin", "Admin home", { platforms: ["web", "ios"], metadata: { product: "admin" } }),
  view("V-arch", "Archived", { status: "archived", platforms: ["web"] }),
  ac("AC-c1", ["web", "ios"]),
  ac("AC-c2", ["web"], "development"),
  iosView("V-p-actor"),
  iosView("V-p-detail"),
  iosView("V-p-hand"),
  iosView("V-p-unknown"),
  iosView("V-p-mixed"),
  iosView("V-p-partial"),
  iosView("V-p-both"),
  ac("AC-pa", ["ios"]),
  ac("AC-pd", ["ios"]),
  ac("AC-ph", ["ios"]),
  ac("AC-pu", ["ios"]),
  view("V-s", "Stale through", {
    status: "idea",
    platforms: ["ios"],
    metadata: { platformScreenshots: { ios: "https://x/s.png" }, platformScreenshotMeta: { ios: { ts: T0, source: "ci", form: "url" } } },
  }),
  ac("AC-s", ["ios"]),
  ac("AC-other", ["ios"]),
];
const CELL_EDGES = [
  edge("AC-c1", "covers", "V-covered"),
  edge("AC-c2", "covers", "V-covered"),
  edge("AC-pa", "covers", "V-p-actor"),
  edge("AC-pd", "covers", "V-p-detail"),
  edge("AC-ph", "covers", "V-p-hand"),
  edge("AC-pu", "covers", "V-p-unknown"),
  edge("AC-pa", "covers", "V-p-mixed"),
  edge("AC-ph", "covers", "V-p-mixed"),
  edge("AC-pa", "covers", "V-p-partial"),
  edge("AC-pu", "covers", "V-p-partial"),
  edge("AC-pa", "covers", "V-p-both"),
  edge("AC-pd", "covers", "V-p-both"),
  edge("AC-s", "covers", "V-s"),
];
const CELL_EVENTS = [
  toLive("e-live-web", "V-live", T1, { platform: "web", actor: "alexis" }),
  toLive("e-pa", "AC-pa", T1, { platform: "ios", actor: "arkaik-ci" }),
  toLive("e-pd", "AC-pd", T2, { actor: "arkaik-app", detail: "build 42" }),
  toLive("e-ph-old", "AC-ph", T0, { platform: "ios", actor: "arkaik-ci" }),
  toLive("e-ph", "AC-ph", T1, { platform: "ios", actor: "claude-code" }),
  toLive("e-pu-web", "AC-pu", T2, { platform: "web", actor: "arkaik-ci" }),
  { id: "e-s-merge", ts: T3, type: "ref.status_changed", node_id: "AC-s", ref_id: "gh-9", to: "merged", synced_at: T3 },
  toLive("e-s-status", "AC-s", T2, { platform: "ios", actor: "arkaik-ci", detail: "build 7" }),
  { id: "e-s-ship", ts: T1, type: "deliverable.shipped", deliverable_id: "d-1", title: "Weekly wrap", node_ids: ["V-s"] },
  toLive("e-other", "AC-other", T3, { platform: "ios", actor: "claude-code" }),
];

{
  const wall = wallOf({ nodes: CELL_NODES, edges: CELL_EDGES, events: CELL_EVENTS, productId: null });
  const cell = (viewId, platform) => wall.screens.get(viewId).cells[platform];
  const row = (viewId, platform) => {
    const c = cell(viewId, platform);
    return [c.state, c.status];
  };

  check("every screen has one cell per wall platform",
    [...wall.screens.values()].every((screen) => same(Object.keys(screen.cells), ["web", "ios", "android"])));
  check("live, a shot, a later event: live-stale", same(row("V-live", "web"), ["live-stale", "live"]));
  check("live, a legacy shot: live-current (never stale)", same(row("V-live", "ios"), ["live-current", "live"]));
  check("live, no shot: live-no-shot", same(row("V-live", "android"), ["live-no-shot", "live"]));
  check("not live, with a shot: not-live, shot kept", same(row("V-mixed", "ios"), ["not-live", "development"]) && cell("V-mixed", "ios").shot !== null);
  check("not live, no shot: not-live with its status", same(row("V-mixed", "android"), ["not-live", "development"]));
  check("a per-platform override makes one platform live", same(row("V-mixed", "web"), ["live-no-shot", "live"]));
  check("covered: the weakest covering status on a platform", same(row("V-covered", "web"), ["not-live", "development"]));
  check("covered: a platform no covering acceptance lists has no status", same(row("V-covered", "android"), ["not-live", null]));
  check("covered: live through its acceptance, unproven shot current", same(row("V-covered", "ios"), ["live-current", "live"]));
  check("an Admin view under All products is absent where its product does not ship", row("V-admin", "ios")[0] === "absent" && row("V-admin", "android")[0] === "absent");
  check("an Admin view under All products is live on web", same(row("V-admin", "web"), ["live-no-shot", "live"]));
  check("archived is not live", same(row("V-arch", "web"), ["not-live", "archived"]));
  check("absent and not-live cells carry no proof and no reasons",
    [cell("V-admin", "ios"), cell("V-mixed", "ios"), cell("V-covered", "android")].every((c) => c.proof === null && c.staleBecause.length === 0));

  check("shot: meta's form, source, ts and commit",
    same(cell("V-live", "web").shot, { value: "https://x/web.png", form: "url", source: "ci", ts: T0, commit: "abc" }), show(cell("V-live", "web").shot));
  check("shot: a data URI with no meta is data, unattributed",
    same(cell("V-live", "ios").shot, { value: "data:image/png;base64,AAAA", form: "data", source: null, ts: null, commit: null }));
  check("shot: anything else is a path", same(cell("V-mixed", "ios").shot, { value: "shots/ios.png", form: "path", source: "manual", ts: T0, commit: null }));
  check("shot: http is a url", cell("V-covered", "ios").shot.form === "url");
  check("no shot: null", cell("V-live", "android").shot === null);
  check("anyShot: true when any slot holds a value", wall.anyShot === true);

  check("stale reason from the view's own move", same(cell("V-live", "web").staleBecause, [
    { eventId: "e-live-web", ts: T1, kind: "status", nodeId: "V-live", label: "V-live moved to Live on Web" },
  ]), show(cell("V-live", "web").staleBecause));
  check("stale reasons through a covering acceptance, newest first; an unrelated acceptance ignored",
    same(cell("V-s", "ios").staleBecause, [
      { eventId: "e-s-merge", ts: T3, kind: "merge", nodeId: "AC-s", label: "Pull request merged on AC-s" },
      { eventId: "e-s-status", ts: T2, kind: "status", nodeId: "AC-s", label: "AC-s moved to Live on iOS" },
      { eventId: "e-s-ship", ts: T1, kind: "shipped", nodeId: "V-s", label: "Shipped: Weekly wrap" },
    ]) && cell("V-s", "ios").state === "live-stale",
    show(cell("V-s", "ios").staleBecause));

  const proof = (viewId, platform = "ios") => cell(viewId, platform).proof;
  check("proof: uncovered is by hand, from the view's latest move to live on the platform",
    same(proof("V-live", "web"), { kind: "hand", ts: T1, actor: "alexis", detail: null }));
  check("proof: uncovered with no matching move is by hand, undated", same(proof("V-live", "ios"), { kind: "hand", ts: null, actor: null, detail: null }));
  check("proof: deploy by actor", same(proof("V-p-actor"), { kind: "deploy", ts: T1, actor: "arkaik-ci", detail: null }), show(proof("V-p-actor")));
  check("proof: deploy by detail, from a project-wide move", same(proof("V-p-detail"), { kind: "deploy", ts: T2, actor: "arkaik-app", detail: "build 42" }));
  check("proof: the latest move decides (a person after CI is by hand)", same(proof("V-p-hand"), { kind: "hand", ts: T1, actor: "claude-code", detail: null }));
  check("proof: no move to live on the platform is unknown", same(proof("V-p-unknown"), { kind: "unknown", ts: null, actor: null, detail: null }));
  check("proof: deploy and hand mixed is by hand", same(proof("V-p-mixed"), { kind: "hand", ts: T1, actor: "claude-code", detail: null }));
  check("proof: deploy and unknown mixed is unknown", proof("V-p-partial").kind === "unknown");
  check("proof: deploy only if every acceptance is, dated by the newest", same(proof("V-p-both"), { kind: "deploy", ts: T2, actor: "arkaik-app", detail: "build 42" }));
  check("proof: on live-stale too", same(proof("V-s"), { kind: "deploy", ts: T2, actor: "arkaik-ci", detail: "build 7" }));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  check("anyShot: false when no slot holds a value", wall.anyShot === false);
}

// --- Counts, gaps, lens and words (spec § Counts and gaps) -----------------

const shotAt = (ts) => ({ ts, source: "ci", form: "url" });
const COUNT_NODES = [
  flow("F-count", "Count", [V("V-1"), V("V-2"), V("V-1"), V("V-3"), V("V-4")]),
  view("V-1", "One", {
    metadata: {
      platformScreenshots: { web: "https://x/1w.png", android: "https://x/1a.png" },
      platformScreenshotMeta: { web: shotAt(T0) },
    },
  }),
  view("V-2", "Two", { platforms: ["web", "ios"], metadata: { platformScreenshots: { web: "https://x/2w.png" }, platformScreenshotMeta: { web: shotAt(T2) } } }),
  view("V-3", "Three", { status: "development" }),
  view("V-4", "Four", { platforms: ["web"] }),
];
const COUNT_EVENTS = [toLive("e-1-web", "V-1", T1, { platform: "web", actor: "alexis" })];

{
  const {
    countStrip, isGapCell, isGapFrame, gapCount, resolveLens, lensPlatforms, cellWord, stripCountsLine,
  } = wallModule;
  const wall = wallOf({ nodes: COUNT_NODES, events: COUNT_EVENTS, productId: "app" });
  const strip = wall.strips[0];
  const states = (viewId) => wall.platforms.map((p) => wall.screens.get(viewId).cells[p].state);
  check("count fixture: the states the counts below read",
    same(states("V-1"), ["live-stale", "live-no-shot", "live-current"]) &&
      same(states("V-2"), ["live-current", "live-no-shot", "absent"]) &&
      same(states("V-3"), ["not-live", "not-live", "not-live"]) &&
      same(states("V-4"), ["live-no-shot", "absent", "absent"]),
    show(["V-1", "V-2", "V-3", "V-4"].map(states)));

  check("countStrip on one platform: distinct views; on excludes absent; stale and no-shot pairs",
    same(countStrip(wall, strip, "web"), { views: 4, perPlatform: { web: { on: 4, live: 3 } }, stale: 1, noShot: 1 }),
    show(countStrip(wall, strip, "web")));
  check("countStrip side by side: every platform, pairs summed",
    same(countStrip(wall, strip, "side"), {
      views: 4,
      perPlatform: { web: { on: 4, live: 3 }, ios: { on: 3, live: 2 }, android: { on: 2, live: 1 } },
      stale: 1,
      noShot: 3,
    }),
    show(countStrip(wall, strip, "side")));

  check("stripCountsLine: live over on, then the non-zero stale and no-shot counts",
    stripCountsLine(wall, strip, "web") === "3/4 live on Web · 1 stale · 1 without a shot" &&
      stripCountsLine(wall, strip, "ios") === "2/3 live on iOS · 2 without a shot" &&
      stripCountsLine(wall, strip, "android") === "1/2 live on Android",
    show(["web", "ios", "android"].map((lens) => stripCountsLine(wall, strip, lens))));
  check("stripCountsLine side by side: per platform, then the totals",
    stripCountsLine(wall, strip, "side") === "Web 3/4 · iOS 2/3 · Android 1/2 · 1 stale · 3 without a shot",
    stripCountsLine(wall, strip, "side"));

  check("isGapCell: live-stale and live-no-shot only",
    ["live-stale", "live-no-shot"].every((state) => isGapCell({ state })) &&
      ["live-current", "not-live", "absent"].every((state) => !isGapCell({ state })));
  check("isGapFrame: a gap on any lens platform",
    isGapFrame(wall, "V-1", "web") && !isGapFrame(wall, "V-1", "android") && isGapFrame(wall, "V-2", "side") && !isGapFrame(wall, "V-3", "side"));
  check("isGapFrame: false for a view not on the wall", !isGapFrame(wall, "V-missing", "side"));
  check("gapCount: distinct (view, lens platform) pairs, a repeated view once",
    gapCount(wall, "web") === 2 && gapCount(wall, "ios") === 2 && gapCount(wall, "android") === 0 && gapCount(wall, "side") === 4,
    show(["web", "ios", "android", "side"].map((lens) => gapCount(wall, lens))));

  check("lensPlatforms: the lens, or every wall platform side by side",
    same(lensPlatforms(wall, "ios"), ["ios"]) && same(lensPlatforms(wall, "side"), ["web", "ios", "android"]));

  check("resolveLens: a stored platform or side is kept when the wall has it",
    resolveLens("ios", wall) === "ios" && resolveLens("side", wall) === "side");
  check("resolveLens: nothing stored is the first platform", resolveLens(null, wall) === "web");
  const twoPlatforms = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: ["ios", "android"] }], productId: "app" });
  check("resolveLens: a platform the scope lacks falls back to the first",
    same(twoPlatforms.platforms, ["ios", "android"]) && resolveLens("web", twoPlatforms) === "ios");
  const onePlatform = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: ["ios"] }], productId: "app" });
  check("resolveLens: one platform is that platform, whatever is stored",
    resolveLens("side", onePlatform) === "ios" && resolveLens("web", onePlatform) === "ios");
  const noPlatforms = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: [] }], productId: "app" });
  check("resolveLens: an empty menu reads as web", same(noPlatforms.platforms, []) && resolveLens(null, noPlatforms) === "web");

  check("cellWord: the side-by-side word for every state",
    cellWord({ state: "live-current", status: "live" }) === "Live" &&
      cellWord({ state: "live-stale", status: "live" }) === "Stale" &&
      cellWord({ state: "live-no-shot", status: "live" }) === "No shot" &&
      cellWord({ state: "not-live", status: null }) === "Unset" &&
      cellWord({ state: "not-live", status: "releasing" }) === "Releasing" &&
      cellWord({ state: "not-live", status: "archived" }) === "Archived" &&
      cellWord({ state: "absent", status: "live" }) === "Absent");
}

// --- Layout (spec § Layout) -------------------------------------------------

{
  const L = wallModule;
  check("layout constants",
    same(
      [L.FRAME_H, L.CAPTION_GAP, L.CAPTION_H, L.FRAME_NODE_H, L.FRAME_MIN_W, L.ASPECT_MIN, L.ASPECT_MAX, L.ITEM_GAP, L.ARM_W, L.END_W,
        L.JUMP_W, L.JUMP_H, L.JUMP_Y, L.EMPTY_W, L.HEADER_H, L.HEADER_GAP, L.HEADER_MIN_W, L.STRIP_GAP, L.LOOSE_PER_ROW, L.ROW_GAP,
        L.SIDE_ROW_GAP, L.SIDE_TAG_W, L.SIDE_WORD_W, L.CHIP_W, L.CHIP_H, L.CHIP_GAP, L.CHIP_MAX, L.CHIP_OFFSET, L.LOD_ZOOM],
      [280, 8, 36, 324, 144, 0.3, 2.4, 24, 24, 12, 144, 96, 92, 280, 44, 12, 360, 72, 8, 40, 6, 28, 72, 220, 28, 6, 8, 16, 0.35],
    ) && same(L.DEFAULT_ASPECT, { web: 1.6, ios: 0.4615, android: 0.45 }));
  check("clampAspect: into [ASPECT_MIN, ASPECT_MAX]", L.clampAspect(0.1) === 0.3 && L.clampAspect(3) === 2.4 && L.clampAspect(1) === 1);

  const noAspect = () => undefined;
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const web = L.layoutWall(wall, "web", noAspect);
  const box = (layout, id) => layout.boxes.find((b) => b.id === id);
  const pick = (b) => [b.kind, b.x, b.y, b.width, b.height, b.row, b.shotWidth];

  check("boxes: each strip's header, then its items, strip by strip",
    same(web.boxes.map((b) => b.id), wall.strips.flatMap((strip) => [strip.id, ...strip.items.map((item) => item.id)])));
  check("a header box is the strip id, at the strip's y, as wide as the strip",
    same(pick(box(web, "strip:F-a")), ["header", 0, 0, 2464, 44, 0, null]), show(box(web, "strip:F-a")));
  check("web frame: 448 box, items under the header",
    same(pick(box(web, "V-a@F-a:0")), ["frame", 0, 56, 448, 324, 0, 448]), show(box(web, "V-a@F-a:0")));
  check("jump tile: 144 × 96, centred on the box",
    same(pick(box(web, "jump:F-a:1")), ["jump", 472, 148, 144, 96, 0, null]), show(box(web, "jump:F-a:1")));
  check("arm and end markers: FRAME_H tall, top-aligned",
    same(pick(box(web, "arm:F-a:2.0")), ["arm", 640, 56, 24, 280, 0, null]) &&
      same(pick(box(web, "end:F-a:2.0.1")), ["end", box(web, "end:F-a:2.0.1").x, 56, 12, 280, 0, null]));
  check("strip rect: content width, one row tall",
    same(web.strips.get("strip:F-a"), { x: 0, y: 0, width: 2464, height: 380 }), show(web.strips.get("strip:F-a")));
  check("one-row pitch is 452", web.strips.get("strip:F-c").y === 452 && web.strips.get("strip:F-d").y === 904);
  check("a header is at least HEADER_MIN_W", box(web, "strip:F-c").width === 360 && web.strips.get("strip:F-c").width === 360);
  check("the empty item: 280 wide, FRAME_H tall", same(pick(box(web, "empty:F-d")), ["empty", 0, 960, 280, 280, 0, null]));

  const ios = L.layoutWall(wall, "ios", noAspect);
  const android = L.layoutWall(wall, "android", noAspect);
  check("iOS and Android defaults: 129 and 126 boxes in 144 nodes",
    same(pick(box(ios, "V-a@F-a:0")), ["frame", 0, 56, 144, 324, 0, 129]) && same(pick(box(android, "V-a@F-a:0")), ["frame", 0, 56, 144, 324, 0, 126]));
  const side = L.layoutWall(wall, "side", noAspect);
  check("side by side, three platforms: 257", same(pick(box(side, "V-a@F-a:0")), ["frame", 0, 56, 257, 324, 0, 257]));
  check("the lens changes widths, never the vertical rhythm",
    [ios, android, side].every((layout) => same(layout.boxes.map((b) => [b.y, b.height]), web.boxes.map((b) => [b.y, b.height]))) &&
      [...ios.strips.values()].every((rect, i) => rect.y === [...web.strips.values()][i].y));
  const last = [...web.strips.values()].pop();
  check("bounds: the widest strip, down to the last strip's bottom",
    same(web.bounds, { x: 0, y: 0, width: Math.max(...[...web.strips.values()].map((r) => r.width)), height: last.y + last.height }));

  const twoWall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, products: [{ id: "app", platforms: ["web", "ios"], root_node_id: "V-home" }], productId: "app" });
  check("side by side, web + iOS: 333", box(L.layoutWall(twoWall, "side", noAspect), "V-a@F-a:0").width === 333);
  check("sideGeometry: row height and minis at n = 2 and n = 3",
    same(L.sideGeometry(twoWall, "V-a", noAspect), { rowHeight: 137, miniWidths: { web: 219, ios: 63 }, shotWidth: 333 }) &&
      L.sideGeometry(wall, "V-a", noAspect).rowHeight === 268 / 3 &&
      same(L.sideGeometry(wall, "V-a", noAspect).miniWidths, { web: 143, ios: 41, android: 40 }),
    show([L.sideGeometry(twoWall, "V-a", noAspect), L.sideGeometry(wall, "V-a", noAspect)]));

  const looseWall = wallOf({ nodes: Array.from({ length: 10 }, (_, i) => view(`V-${String(i).padStart(2, "0")}`, `View ${i}`)), productId: "app" });
  const loose = L.layoutWall(looseWall, "web", noAspect);
  check("Not in a flow wraps after eight frames",
    same(pick(box(loose, "V-07@loose")), ["frame", 7 * 472, 56, 448, 324, 0, 448]) &&
      same(pick(box(loose, "V-08@loose")), ["frame", 0, 420, 448, 324, 1, 448]) &&
      same(loose.strips.get("loose-strip"), { x: 0, y: 0, width: 8 * 448 + 7 * 24, height: 744 }),
    show(loose.strips.get("loose-strip")));

  const counted = wallOf({ nodes: COUNT_NODES, events: COUNT_EVENTS, productId: "app" });
  const measured = (viewId, platform) =>
    ({ "V-1|web": 5, "V-1|android": 0.5, "V-2|web": 1, "V-3|web": 0.5, "V-4|web": 0.5 })[`${viewId}|${platform}`];
  const sized = L.layoutWall(counted, "web", measured);
  check("a measured aspect sizes a frame with a shot; clamped; ignored without a shot",
    box(sized, "V-2@F-count:1").shotWidth === 280 && box(sized, "V-1@F-count:0").shotWidth === 672 &&
      box(sized, "V-3@F-count:3").shotWidth === 448 && box(sized, "V-4@F-count:4").shotWidth === 448);
  const tiny = L.layoutWall(counted, "web", () => 0.1);
  check("a clamped narrow shot stays centred in a FRAME_MIN_W node",
    box(tiny, "V-2@F-count:1").shotWidth === 84 && box(tiny, "V-2@F-count:1").width === 144);
  check("side by side: each mini keeps its own aspect, the widest sets the box",
    same(L.sideGeometry(counted, "V-1", measured).miniWidths, { web: 214, ios: 41, android: 45 }) &&
      L.sideGeometry(counted, "V-1", measured).shotWidth === 328);

  const empty = L.layoutWall(wallOf({ nodes: [], productId: null }), "web", noAspect);
  check("an empty wall lays out nothing", empty.boxes.length === 0 && empty.strips.size === 0 && same(empty.bounds, { x: 0, y: 0, width: 0, height: 0 }));
}

// --- Time budget (spec § Performance 1) -------------------------------------

{
  for (const name of ["pebbles.json", "arkaik-self-map.json"]) {
    const { input } = seedWall(name);
    const lens = "web";
    wallModule.layoutWall(buildWall(input), lens, () => undefined); // warm-up, not timed
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) wallModule.layoutWall(buildWall(input), lens, () => undefined);
    const mean = (performance.now() - start) / runs;
    check(`${name}: buildWall + layoutWall under 25 ms on average (${mean.toFixed(2)} ms)`, mean < 25);
  }
}

// --- Camera, keyboard neighbours, chips (spec § Layout helpers) -----------

{
  const L = wallModule;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const nearView = (actual, expected) => ["x", "y", "zoom"].every((key) => near(actual[key], expected[key]));
  const viewport = { width: 1000, height: 800 };
  const options = { padding: 32, bottomInset: 72, minZoom: 0.4, maxZoom: 1 };

  const fits = L.frameViewport({ x: 100, y: 200, width: 400, height: 300 }, viewport, options);
  check("frameViewport: a rect that fits is centred above the bottom inset, at maxZoom", nearView(fits, { x: 200, y: 14, zoom: 1 }), show(fits));
  const between = L.frameViewport({ x: 0, y: 0, width: 1200, height: 400 }, viewport, options);
  check("frameViewport: zoom is the tighter of the two fits", nearView(between, { x: 32, y: (728 - 400 * 0.78) / 2, zoom: 0.78 }), show(between));
  const wide = L.frameViewport({ x: 0, y: 452, width: 5000, height: 380 }, viewport, options);
  check("frameViewport: a strip wider than the view starts at the left edge, at minZoom",
    nearView(wide, { x: 32, y: (728 - 380 * 0.4) / 2 - 452 * 0.4, zoom: 0.4 }), show(wide));
  const tall = L.frameViewport({ x: 10, y: 100, width: 300, height: 2000 }, viewport, options);
  check("frameViewport: a rect taller than the view starts at the top edge",
    nearView(tall, { x: (1000 - 300 * 0.4) / 2 - 10 * 0.4, y: 32 - 100 * 0.4, zoom: 0.4 }), show(tall));

  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const layout = L.layoutWall(wall, "web", () => undefined);
  const move = (id, dir) => L.neighbourFrame(layout, id, dir);
  check("neighbourFrame: right and left skip markers and jump tiles",
    move("V-a@F-a:0", "right") === "V-b@F-a:2.0.0" && move("V-b@F-a:2.0.0", "left") === "V-a@F-a:0");
  check("neighbourFrame: null at a row's ends", move("V-a@F-a:0", "left") === null && move("V-a@F-a:3", "right") === null);
  check("neighbourFrame: down skips strips with no frames, to the nearest centre", move("V-a@F-a:0", "down") === "V-d@F-e:0");
  check("neighbourFrame: up to the nearest centre in the previous row", move("V-d@F-e:0", "up") === "V-a@F-a:0");
  check("neighbourFrame: null above the first row and below the last",
    move("V-a@F-a:0", "up") === null && move("V-home@loose", "down") === null);
  check("neighbourFrame: null for anything but a frame", move("jump:F-a:1", "right") === null && move("nope", "down") === null);

  const looseWall = wallOf({ nodes: Array.from({ length: 10 }, (_, i) => view(`V-${String(i).padStart(2, "0")}`, `View ${i}`)), productId: "app" });
  const looseLayout = L.layoutWall(looseWall, "web", () => undefined);
  check("neighbourFrame: wrapped rows are rows",
    L.neighbourFrame(looseLayout, "V-02@loose", "down") === "V-09@loose" && L.neighbourFrame(looseLayout, "V-09@loose", "up") === "V-01@loose");

  const frame = { id: "V-a@F-a:0", kind: "frame", stripId: "strip:F-a", row: 0, x: 100, y: 56, width: 448, height: 324, shotWidth: 448 };
  check("chipRects: a column at the frame's x, CHIP_OFFSET below it",
    same(L.chipRects(frame, 3), [
      { x: 100, y: 396, width: 220, height: 28 },
      { x: 100, y: 430, width: 220, height: 28 },
      { x: 100, y: 464, width: 220, height: 28 },
    ]) && same(L.chipRects(frame, 0), []),
    show(L.chipRects(frame, 3)));
}

// --- Time budget at scale: a grown journal (review S1) ----------------------
//
// Measured on the review machine before the fix: 18 ms with no journal, 160 ms
// with 20,000 events of which 5,000 shipped, 458 ms with 18,000 shipped — every
// cell copied the whole shipped list, and every view's effective statuses
// scanned every node and edge. The budget leaves room for slower CI machines.

function grownProject({ shippedCount = 5000, statusCount = 15000 } = {}) {
  const VIEWS = 500;
  const platformsAll = ["web", "ios", "android"];
  const nodes = [];
  const edges = [];
  for (let f = 0; f < 50; f += 1) {
    nodes.push(flow(`F-${f}`, `Flow ${f}`, Array.from({ length: 10 }, (_, i) => V(`V-${f * 10 + i}`))));
  }
  for (let v = 0; v < VIEWS; v += 1) {
    nodes.push(view(`V-${v}`, `View ${v}`, {
      metadata: {
        platformScreenshots: { web: `https://x/${v}w.png`, ios: `https://x/${v}i.png`, android: `https://x/${v}a.png` },
        platformScreenshotMeta: { web: shotAt(T0), ios: shotAt(T0), android: shotAt(T0) },
      },
    }));
  }
  for (let a = 0; a < VIEWS; a += 1) nodes.push(ac(`AC-${a}`, platformsAll));
  for (let k = 0; k < 100; k += 1) nodes.push(node(`API-${k}`, "api-endpoint", `Endpoint ${k}`));
  for (let a = 0; a < VIEWS; a += 1) {
    edges.push(edge(`AC-${a}`, "covers", `V-${a}`));
    edges.push(edge(`AC-${a}`, "covers", `V-${(a + 1) % VIEWS}`));
  }
  for (let v = 0; v < VIEWS; v += 1) {
    for (let c = 0; c < 6; c += 1) edges.push(edge(`V-${v}`, "calls", `API-${(v * 7 + c * 13) % 100}`));
  }
  const events = [];
  const stamp = (i) => new Date(Date.parse(T1) + i * 1000).toISOString();
  for (let i = 0; i < statusCount; i += 1) {
    const subject = i % 2 === 0 ? `V-${i % VIEWS}` : `AC-${i % VIEWS}`;
    events.push(toLive(`s-${String(i).padStart(6, "0")}`, subject, stamp(i), { platform: platformsAll[i % 3], actor: i % 5 === 0 ? "arkaik-ci" : "alexis" }));
  }
  for (let i = 0; i < shippedCount; i += 1) {
    events.push({
      id: `d-${String(i).padStart(6, "0")}`,
      ts: stamp(statusCount + i),
      type: "deliverable.shipped",
      deliverable_id: `del-${i}`,
      title: `Deliverable ${i}`,
      node_ids: [`V-${(i * 3) % VIEWS}`, `AC-${(i * 11) % VIEWS}`],
      ...(i % 4 === 0 ? { platform: platformsAll[i % 3] } : {}),
    });
  }
  return { nodes, edges, events };
}

{
  const project = grownProject();
  check("grown project: 500 views, 500 acceptances, 4,000 edges, 20,000 events of which 5,000 shipped",
    project.nodes.filter((n) => n.species === "view").length === 500 &&
      project.nodes.filter((n) => n.species === "acceptance").length === 500 &&
      project.edges.length === 4000 &&
      project.events.length === 20000 &&
      project.events.filter((ev) => ev.type === "deliverable.shipped").length === 5000);
  const bundleProject = { root_node_id: null, metadata: { products: PRODUCTS } };
  const input = {
    ...project,
    project: bundleProject,
    definition: null,
    scope: resolveProductScope({ project: bundleProject }, null),
    graph: buildProductGraph(project.nodes, project.edges),
  };
  const build = () => buildWall(input);
  const warm = build(); // warm-up, not timed
  check("grown project: every view on the wall, with a shot on every platform",
    warm.screens.size === 500 && [...warm.screens.values()].every((screen) => Object.values(screen.cells).every((cell) => cell.shot !== null)));
  const runs = 5;
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) build();
  const mean = (performance.now() - start) / runs;
  // 250 ms, not 60: CI's shared runners measured 79 ms for this (about 3.5 times a
  // laptop), and a wall-clock budget that fails on a slow runner teaches nothing.
  // The regression it guards cost about 200 ms on a laptop, so roughly 700 ms there.
  check(`grown project: buildWall under 250 ms on average (${mean.toFixed(1)} ms)`, mean < 250);
}

// Equivalence: indexing shipped events by the ids they name changes no answer.
// EQUIV_EXPECTED was captured from the code before that index existed.

const EQUIV_NODES = [
  flow("F-eq", "Equivalence", [V("V-e1"), V("V-e2"), V("V-e3")]),
  view("V-e1", "E one", {
    metadata: { platformScreenshots: { web: "https://x/e1w.png", ios: "https://x/e1i.png" }, platformScreenshotMeta: { web: shotAt(T0), ios: shotAt(T0) } },
  }),
  view("V-e2", "E two", {
    metadata: { platformScreenshots: { web: "https://x/e2w.png", ios: "https://x/e2i.png" }, platformScreenshotMeta: { web: shotAt(T0), ios: shotAt(T2) } },
  }),
  view("V-e3", "E three", {
    metadata: { platformScreenshots: { android: "https://x/e3a.png" }, platformScreenshotMeta: { android: shotAt(T0) } },
  }),
  ac("AC-e1", ["web", "ios"]),
  ac("AC-e2", ["web"]),
  ac("AC-e3", ["android"]),
  ac("AC-unrelated", ["web", "ios", "android"]),
];
const EQUIV_EDGES = [
  edge("AC-e1", "covers", "V-e1"),
  edge("AC-e2", "covers", "V-e1"),
  edge("AC-e3", "covers", "V-e3"),
];
const shipped = (id, ts, node_ids, extra = {}) => ({ id, ts, type: "deliverable.shipped", deliverable_id: `del-${id}`, title: `Ship ${id}`, node_ids, ...extra });
const EQUIV_EVENTS = [
  shipped("ship-1", T1, ["V-e1", "AC-e1"]),
  shipped("ship-2", T2, ["AC-e2"], { platform: "web" }),
  shipped("ship-3", T1, ["V-e2"], { platform: "ios" }),
  shipped("ship-4", T3, ["AC-e3", "V-e2"]),
  shipped("ship-5", T0, ["V-e1"]),
  shipped("ship-6", T3, ["AC-unrelated"]),
  shipped("ship-7", T2, ["V-e3", 42], { title: "" }),
  toLive("e-eq-ac1", "AC-e1", T2, { platform: "ios", actor: "arkaik-ci" }),
  toLive("e-eq-v2", "V-e2", T1, { platform: "web", actor: "alexis" }),
];
const EQUIV_EXPECTED = {
  "V-e1": {
    web: ["live-stale", "live", [{"eventId": "ship-2", "ts": "2026-11-01T12:00:00.000Z", "kind": "shipped", "nodeId": "AC-e2", "label": "Shipped: Ship ship-2"}, {"eventId": "ship-1", "ts": "2026-11-01T11:00:00.000Z", "kind": "shipped", "nodeId": "V-e1", "label": "Shipped: Ship ship-1"}], {"kind": "unknown", "ts": null, "actor": null, "detail": null}],
    ios: ["live-stale", "live", [{"eventId": "e-eq-ac1", "ts": "2026-11-01T12:00:00.000Z", "kind": "status", "nodeId": "AC-e1", "label": "AC-e1 moved to Live on iOS"}, {"eventId": "ship-1", "ts": "2026-11-01T11:00:00.000Z", "kind": "shipped", "nodeId": "V-e1", "label": "Shipped: Ship ship-1"}], {"kind": "deploy", "ts": "2026-11-01T12:00:00.000Z", "actor": "arkaik-ci", "detail": null}],
    android: ["not-live", null, [], null],
  },
  "V-e2": {
    web: ["live-stale", "live", [{"eventId": "ship-4", "ts": "2026-11-01T13:00:00.000Z", "kind": "shipped", "nodeId": "V-e2", "label": "Shipped: Ship ship-4"}, {"eventId": "e-eq-v2", "ts": "2026-11-01T11:00:00.000Z", "kind": "status", "nodeId": "V-e2", "label": "V-e2 moved to Live on Web"}], {"kind": "hand", "ts": "2026-11-01T11:00:00.000Z", "actor": "alexis", "detail": null}],
    ios: ["live-stale", "live", [{"eventId": "ship-4", "ts": "2026-11-01T13:00:00.000Z", "kind": "shipped", "nodeId": "V-e2", "label": "Shipped: Ship ship-4"}], {"kind": "hand", "ts": null, "actor": null, "detail": null}],
    android: ["live-no-shot", "live", [], {"kind": "hand", "ts": null, "actor": null, "detail": null}],
  },
  "V-e3": {
    web: ["not-live", null, [], null],
    ios: ["not-live", null, [], null],
    android: ["live-stale", "live", [{"eventId": "ship-4", "ts": "2026-11-01T13:00:00.000Z", "kind": "shipped", "nodeId": "AC-e3", "label": "Shipped: Ship ship-4"}, {"eventId": "ship-7", "ts": "2026-11-01T12:00:00.000Z", "kind": "shipped", "nodeId": "V-e3", "label": "Shipped: del-ship-7"}], {"kind": "unknown", "ts": null, "actor": null, "detail": null}],
  },
};

{
  const wall = wallOf({ nodes: EQUIV_NODES, edges: EQUIV_EDGES, events: EQUIV_EVENTS, productId: null, root: null });
  const actual = Object.fromEntries(
    [...wall.screens.values()].map((screen) => [
      screen.viewId,
      Object.fromEntries(Object.entries(screen.cells).map(([platform, c]) => [platform, [c.state, c.status, c.staleBecause, c.proof]])),
    ]),
  );
  check("indexed shipped events: every cell's state, stale reasons and proof as before", same(actual, EQUIV_EXPECTED), show(actual));
}

// --- Live proof ignores an archived covering acceptance (review S2) ---------

{
  const nodes = [
    iosView("V-arch-none"),
    iosView("V-arch-hand"),
    iosView("V-arch-only"),
    ac("AC-deployed", ["ios"]),
    ac("AC-retired", ["ios"], "archived"),
    ac("AC-retired-hand", ["ios"], "archived"),
    ac("AC-retired-web", ["ios"], "live", { ios: "archived" }),
  ];
  const edges = [
    edge("AC-deployed", "covers", "V-arch-none"),
    edge("AC-retired", "covers", "V-arch-none"),
    edge("AC-deployed", "covers", "V-arch-hand"),
    edge("AC-retired-hand", "covers", "V-arch-hand"),
    edge("AC-retired-hand", "covers", "V-arch-only"),
    edge("AC-deployed", "covers", "V-arch-only"),
    edge("AC-retired-web", "covers", "V-arch-only"),
  ];
  const events = [
    toLive("e-deployed", "AC-deployed", T2, { platform: "ios", actor: "arkaik-ci" }),
    toLive("e-retired-hand", "AC-retired-hand", T3, { platform: "ios", actor: "alexis" }),
    toLive("e-retired-web", "AC-retired-web", T3, { actor: "alexis" }),
  ];
  const wall = wallOf({ nodes, edges, events, productId: null, root: null });
  const cell = (viewId) => wall.screens.get(viewId).cells.ios;
  const deployed = { kind: "deploy", ts: T2, actor: "arkaik-ci", detail: null };
  check("proof: a live acceptance deployed and an archived one never moved: deploy",
    cell("V-arch-none").status === "live" && same(cell("V-arch-none").proof, deployed), show(cell("V-arch-none")));
  check("proof: an archived acceptance's later move by hand does not decide",
    cell("V-arch-hand").status === "live" && same(cell("V-arch-hand").proof, deployed), show(cell("V-arch-hand").proof));
  check("proof: archived on the platform by override counts as archived there",
    cell("V-arch-only").status === "live" && same(cell("V-arch-only").proof, deployed), show(cell("V-arch-only").proof));
}

// --- A flow named `loose` keeps its own strip (review S3) -------------------

{
  const wall = wallOf({
    nodes: [flow("loose", "Loose ends", [V("V-in")]), view("V-in", "In a flow"), view("V-out", "Out of every flow")],
    productId: null,
    root: null,
  });
  const ids = wall.strips.map((strip) => strip.id);
  check("a flow whose id is loose and the Not in a flow strip get different ids",
    ids.length === 2 && new Set(ids).size === 2 && ids[0] === wallModule.stripIdOf("loose") && ids[1] === wallModule.LOOSE_STRIP_ID, show(ids));
  check("LOOSE_STRIP_ID is outside the strip:<flowId> space", !wallModule.LOOSE_STRIP_ID.startsWith("strip:"), wallModule.LOOSE_STRIP_ID);
  const layout = wallModule.layoutWall(wall, "web", () => undefined);
  check("…and the layout keeps both strips' rects", layout.strips.size === 2, show([...layout.strips.keys()]));
}

// --- The side-by-side gaps are shared (review S4) ---------------------------

{
  const L = wallModule;
  check("SIDE_TAG_GAP and SIDE_WORD_GAP are exported: 6 and 8", L.SIDE_TAG_GAP === 6 && L.SIDE_WORD_GAP === 8, show([L.SIDE_TAG_GAP, L.SIDE_WORD_GAP]));
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const geometry = L.sideGeometry(wall, "V-a", () => undefined);
  const widest = Math.max(...Object.values(geometry.miniWidths));
  check("sideGeometry's box is the tag column, the tag gap, the widest mini, the word gap and the word column",
    geometry.shotWidth === L.SIDE_TAG_W + L.SIDE_TAG_GAP + widest + L.SIDE_WORD_GAP + L.SIDE_WORD_W, show(geometry));
}

// --- The opening camera (review S5) ----------------------------------------

{
  const L = wallModule;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const nearView = (actual, expected) => ["x", "y", "zoom"].every((key) => near(actual[key], expected[key]));
  const layoutOf = (...rects) => ({
    boxes: [],
    strips: new Map(rects.map((rect, i) => [`strip:${i}`, rect])),
    bounds: { x: 0, y: 0, width: Math.max(...rects.map((r) => r.width)), height: 1000 },
  });
  const INSETS = { top: 0, bottom: 72 };

  // 1440 wide: a 1500 px strip fits at 1376 / 1500, between the bounds.
  const wide = L.openingViewport(layoutOf({ x: 0, y: 0, width: 1500, height: 380 }, { x: 0, y: 452, width: 5000, height: 380 }), { width: 1440, height: 900 }, INSETS);
  check("openingViewport, wide canvas: the first strip's full width, its header at the top-left padding",
    nearView(wide, { x: 32, y: 32, zoom: 1376 / 1500 }), show(wide));

  // 390 wide: the first strip would need 0.22; the floor is 0.7, left-aligned, overflowing right.
  const narrow = L.openingViewport(layoutOf({ x: 0, y: 0, width: 1500, height: 380 }), { width: 390, height: 844 }, INSETS);
  check("openingViewport, narrow canvas: never below 0.7, still left-aligned at the padding",
    nearView(narrow, { x: 32, y: 32, zoom: 0.7 }), show(narrow));

  // A strip narrower than the canvas: zoom 1 at most, and left-aligned, not centred.
  const small = L.openingViewport(layoutOf({ x: 0, y: 0, width: 400, height: 380 }), { width: 1000, height: 800 }, INSETS);
  check("openingViewport, a strip narrower than the canvas: never above 1, left-aligned",
    nearView(small, { x: 32, y: 32, zoom: 1 }), show(small));

  // Insets move the usable canvas: the header sits below the top inset and right of the left one,
  // and the side insets narrow the width the zoom fits.
  const inset = L.openingViewport(layoutOf({ x: 100, y: 200, width: 1200, height: 380 }), { width: 1300, height: 800 }, { top: 60, left: 10, right: 30, bottom: 72 });
  const insetZoom = (1300 - 10 - 30 - 64) / 1200;
  check("openingViewport: insets shift the corner and narrow the fit; the strip's own origin is honoured",
    nearView(inset, { x: 10 + 32 - 100 * insetZoom, y: 60 + 32 - 200 * insetZoom, zoom: insetZoom }), show(inset));
  check("openingViewport: insets are optional",
    nearView(L.openingViewport(layoutOf({ x: 0, y: 0, width: 400, height: 380 }), { width: 1000, height: 800 }), { x: 32, y: 32, zoom: 1 }));

  const emptyLayout = L.layoutWall(wallOf({ nodes: [], productId: null }), "web", () => undefined);
  check("openingViewport, empty layout: the identity viewport",
    same(L.openingViewport(emptyLayout, { width: 1440, height: 900 }, INSETS), { x: 0, y: 0, zoom: 1 }));

  // On a real wall: the first strip is the first header's.
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const layout = L.layoutWall(wall, "web", () => undefined);
  const real = L.openingViewport(layout, { width: 1160, height: 888 }, INSETS);
  check("openingViewport on a laid-out wall: the first strip (2464 wide) at the 0.7 floor, header at (32, 32)",
    nearView(real, { x: 32, y: 32, zoom: 0.7 }), show(real));
}

// --- Test gaps (review S6): seed screens, untested truth-table rows ---------

{
  for (const [name, expected] of [["pebbles.json", 58], ["arkaik-self-map.json", 35]]) {
    const { input, wall } = seedWall(name);
    const views = input.nodes.filter((n) => n.species === "view");
    check(`${name}: the wall holds exactly the ${expected} views in scope (All products)`,
      wall.screens.size === expected && views.length === expected && views.every((v) => wall.screens.has(v.id)),
      `${wall.screens.size} screens, ${views.length} views`);
  }
}

{
  const nodes = [
    view("V-gap-nostatus", "No status, a shot", {
      status: "idea",
      metadata: { platformScreenshots: { android: "https://x/ga.png" }, platformScreenshotMeta: { android: shotAt(T0) } },
    }),
    ac("AC-gap-web", ["web"]),
    view("V-gap-absent", "Admin with a shot", {
      platforms: ["web", "ios"],
      metadata: { product: "admin", platformScreenshots: { ios: "https://x/gi.png" }, platformScreenshotMeta: { ios: shotAt(T0) } },
    }),
    view("V-gap-tie", "Tied", {
      status: "idea",
      platforms: ["ios"],
      metadata: { platformScreenshots: { ios: "https://x/gt.png" }, platformScreenshotMeta: { ios: shotAt(T1) } },
    }),
    ac("AC-gap-tie", ["ios"]),
    view("V-gap-wide", "Project-wide move", { platforms: ["web", "ios"] }),
  ];
  const edges = [edge("AC-gap-web", "covers", "V-gap-nostatus"), edge("AC-gap-tie", "covers", "V-gap-tie")];
  const events = [
    toLive("e-gap-tie", "AC-gap-tie", T1, { platform: "ios", actor: "arkaik-ci" }),
    shipped("ship-gap-tie", T1, ["AC-gap-tie"]),
    toLive("e-gap-wide-old", "V-gap-wide", T0, { platform: "ios", actor: "arkaik-ci" }),
    toLive("e-gap-wide", "V-gap-wide", T2, { actor: "alexis", detail: "all platforms" }),
  ];
  const wall = wallOf({ nodes, edges, events, productId: null, root: null });
  const cell = (viewId, platform) => wall.screens.get(viewId).cells[platform];

  const noStatus = cell("V-gap-nostatus", "android");
  check("on the platform, no status, a shot: not-live, status null, shot kept, no proof",
    noStatus.state === "not-live" && noStatus.status === null && noStatus.shot?.value === "https://x/ga.png" && noStatus.proof === null && noStatus.staleBecause.length === 0,
    show(noStatus));
  const absent = cell("V-gap-absent", "ios");
  check("an absent cell keeps its shot",
    absent.state === "absent" && absent.shot?.value === "https://x/gi.png" && absent.proof === null && absent.staleBecause.length === 0, show(absent));
  const tie = cell("V-gap-tie", "ios");
  check("a related acceptance's events at exactly the shot's ts do not make it stale, through the wall",
    tie.state === "live-current" && tie.staleBecause.length === 0, show(tie));
  check("an uncovered view's latest move to live, project-wide, is its proof on every platform",
    ["web", "ios"].every((p) => same(cell("V-gap-wide", p).proof, { kind: "hand", ts: T2, actor: "alexis", detail: "all platforms" })),
    show(["web", "ios"].map((p) => cell("V-gap-wide", p).proof)));
}

// --- Keeping the reader's strip through a lens change ----------------------

{
  const L = wallModule;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const nearView = (actual, expected) => actual !== null && ["x", "y", "zoom"].every((key) => near(actual[key], expected[key]));
  const layoutOf = (...rects) => ({
    boxes: [],
    strips: new Map(rects.map((rect, i) => [`strip:${i}`, rect])),
    bounds: { x: 0, y: 0, width: Math.max(...rects.map((r) => r.width)), height: 2000 },
  });
  const SIZE = { width: 1000, height: 800 };
  // Three strips: rows 0–380, 452–832, 904–1284.
  const before = layoutOf(
    { x: 0, y: 0, width: 6000, height: 380 },
    { x: 0, y: 452, width: 6000, height: 380 },
    { x: 0, y: 904, width: 6000, height: 380 },
  );

  // The viewport's vertical centre, in flow coordinates, is (400 - y) / zoom.
  check("stripNearViewport: the strip whose row holds the viewport's vertical centre",
    L.stripNearViewport(before, { x: 0, y: -242, zoom: 1 }, SIZE) === "strip:1",
    L.stripNearViewport(before, { x: 0, y: -242, zoom: 1 }, SIZE));
  check("stripNearViewport: in the gap between two rows, the nearer one",
    L.stripNearViewport(before, { x: 0, y: 400 - 430 * 0.5, zoom: 0.5 }, SIZE) === "strip:1",
    L.stripNearViewport(before, { x: 0, y: 400 - 430 * 0.5, zoom: 0.5 }, SIZE));
  check("stripNearViewport: below the last row, the last strip",
    L.stripNearViewport(before, { x: 0, y: -5000, zoom: 1 }, SIZE) === "strip:2");
  check("stripNearViewport: above the first row, the first strip",
    L.stripNearViewport(before, { x: 0, y: 5000, zoom: 1 }, SIZE) === "strip:0");
  check("stripNearViewport: an equal distance goes to the first strip in layout order",
    L.stripNearViewport(before, { x: 0, y: 400 - 416, zoom: 1 }, SIZE) === "strip:0",
    L.stripNearViewport(before, { x: 0, y: 400 - 416, zoom: 1 }, SIZE));
  check("stripNearViewport: no strip, null",
    L.stripNearViewport(layoutOf(), { x: 0, y: 0, zoom: 1 }, SIZE) === null);

  // The new lens shrinks strip:1 to 2000 wide.
  const after = layoutOf(
    { x: 0, y: 0, width: 2000, height: 380 },
    { x: 0, y: 452, width: 2000, height: 380 },
    { x: 0, y: 904, width: 2000, height: 380 },
  );
  // Far along the old strip: centre x = (500 - x) / zoom = 5000.
  const far = { x: 500 - 5000 * 0.8, y: -200, zoom: 0.8 };
  check("keepStripViewport: a centre past the strip's new end pans so its start sits at the left padding, same zoom and y",
    nearView(L.keepStripViewport(after, "strip:1", far, SIZE, 32), { x: 32, y: -200, zoom: 0.8 }),
    show(L.keepStripViewport(after, "strip:1", far, SIZE, 32)));
  const inside = { x: 500 - 1500 * 0.8, y: -200, zoom: 0.8 };
  check("keepStripViewport: a centre still inside the strip's new extent moves nothing (null)",
    L.keepStripViewport(after, "strip:1", inside, SIZE, 32) === null,
    show(L.keepStripViewport(after, "strip:1", inside, SIZE, 32)));
  const edge = { x: 500 - 2000 * 0.8, y: -200, zoom: 0.8 };
  check("keepStripViewport: a centre exactly on the strip's end is inside",
    L.keepStripViewport(after, "strip:1", edge, SIZE, 32) === null);
  const shifted = layoutOf({ x: 300, y: 0, width: 900, height: 380 });
  const left = { x: 500 - 100 * 0.5, y: 10, zoom: 0.5 };
  check("keepStripViewport: a centre before the strip's start pans too, honouring the strip's own x",
    nearView(L.keepStripViewport(shifted, "strip:0", left, SIZE, 32), { x: 32 - 300 * 0.5, y: 10, zoom: 0.5 }),
    show(L.keepStripViewport(shifted, "strip:0", left, SIZE, 32)));
  check("keepStripViewport: a strip the new layout lacks, null",
    L.keepStripViewport(after, "strip:9", far, SIZE, 32) === null);

  // On a real wall: Web is several times wider than iOS.
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const web = L.layoutWall(wall, "web", () => undefined);
  const ios = L.layoutWall(wall, "ios", () => undefined);
  const firstId = wall.strips[0].id;
  const webRect = web.strips.get(firstId);
  const atEnd = { x: 500 - (webRect.x + webRect.width - 50), y: 400 - (webRect.y + 100), zoom: 1 };
  check("on a real wall: at the end of a Web strip, the strip is the one in view",
    L.stripNearViewport(web, atEnd, SIZE) === firstId, L.stripNearViewport(web, atEnd, SIZE));
  const kept = L.keepStripViewport(ios, firstId, atEnd, SIZE, 32);
  check("…and switching to iOS brings its start back to the left padding",
    nearView(kept, { x: 32 - ios.strips.get(firstId).x, y: atEnd.y, zoom: 1 }), show(kept));
}

// --- Map counts: the index and the Overview count what the wall draws ------
// (Screens map stack, part 2.) The screens kind selects every scoped flow and
// view and no edge, so its card count is exactly the wall's flow strips plus
// its screens — under every scope, including Pebbles' Admin product, which has
// views and no flow.
{
  const SCREENS = { id: "screens", title: "Screens", kind: "screens" };
  const bundle = readSeed("pebbles.json");
  const graph = buildProductGraph(bundle.nodes, bundle.edges);
  for (const productId of [null, "admin", "app"]) {
    const scope = resolveProductScope(bundle, productId);
    const wall = buildWall({
      nodes: bundle.nodes,
      edges: bundle.edges,
      events: [],
      project: bundle.project,
      definition: SCREENS,
      scope,
      graph,
    });
    const flows = wall.strips.filter((strip) => strip.flowId !== null).length;
    const counts = wallModule.computeMapCounts(SCREENS, {
      dataNodes: bundle.nodes,
      dataEdges: bundle.edges,
      project: bundle.project,
      scope,
      graph,
    });
    check(
      `computeMapCounts(screens) under ${productId ?? "All products"} = the wall's flows + views, 0 edges`,
      counts.nodes === flows + wall.screens.size && counts.edges === 0,
      `${counts.nodes} nodes / ${counts.edges} edges vs ${flows} flows + ${wall.screens.size} views`,
    );
  }
}

// --- The shot cache: fingerprints, not whole values; failures remembered ----
// (Screens map stack, part 2.) components/maps/screens/aspect-cache.ts runs in
// the browser; here `window.requestAnimationFrame` is a queue the test flushes.
{
  const cache = wallModule.aspectCache;
  const frames = [];
  global.window = { requestAnimationFrame: (callback) => frames.push(callback) };
  const flushFrames = () => {
    while (frames.length > 0) frames.shift()();
  };

  const big = `data:image/png;base64,${"A".repeat(2_000_000)}`;
  const bigTail = `${big.slice(0, -1)}B`;
  const shotOf = (value, ts = null) => ({ value, form: "data", source: null, ts, commit: null });

  const key = cache.shotKey(shotOf(big, "2026-11-01T00:00:00Z"));
  check("shotKey: a multi-megabyte data URI keys in a few hundred characters", key.length < 300, key.length);
  check("shotKey: the same shot keys the same", key === cache.shotKey(shotOf(big, "2026-11-01T00:00:00Z")));
  check("shotKey: a different meta.ts keys differently",
    key !== cache.shotKey(shotOf(big, "2026-11-02T00:00:00Z")) && key !== cache.shotKey(shotOf(big)));
  check("shotKey: a change in the last characters keys differently", key !== cache.shotKey(shotOf(bigTail, "2026-11-01T00:00:00Z")));
  check("shotKey: a change of length keys differently", cache.shotKey(shotOf("https://x/a.png")) !== cache.shotKey(shotOf("https://x/a.pngg")));
  check("shotKey: a short URL keeps every character in its key",
    cache.shotKey(shotOf("https://x/one.png")) !== cache.shotKey(shotOf("https://x/two.png")));

  // Aspects: batched per frame, keyed by the fingerprint, never holding the value.
  const before = cache.getAspectSnapshot();
  let heard = 0;
  const unsubscribe = cache.subscribeAspects(() => {
    heard += 1;
  });
  cache.reportAspect("V-big", "web", key, 1.5);
  check("reportAspect: nothing applies before the animation frame",
    cache.getAspectSnapshot() === before && cache.aspectFrom(cache.getAspectSnapshot(), "V-big", "web", key) === undefined);
  flushFrames();
  const after = cache.getAspectSnapshot();
  check("reportAspect: applied on the frame, listeners told once", after !== before && heard === 1, heard);
  check("aspectFrom: answers for the slot's current key", cache.aspectFrom(after, "V-big", "web", key) === 1.5);
  check("aspectFrom: a new shot in the slot starts from the default",
    cache.aspectFrom(after, "V-big", "web", cache.shotKey(shotOf(bigTail, "2026-11-01T00:00:00Z"))) === undefined);
  check("aspectFrom: another platform's slot is its own", cache.aspectFrom(after, "V-big", "ios", key) === undefined);
  check("the cache keeps the fingerprint, never the multi-megabyte value",
    JSON.stringify([...after.values()]).length < 1000, JSON.stringify([...after.values()]).length);
  cache.reportAspect("V-big", "web", key, 1.5);
  flushFrames();
  check("reportAspect: the same report again changes nothing", cache.getAspectSnapshot() === after && heard === 1, heard);
  unsubscribe();

  // Failures: remembered for the tab, so a frame that comes back shows its ghost at once.
  const urlKey = cache.shotKey(shotOf("https://x/broken.png", "2026-11-01T00:00:00Z"));
  let told = 0;
  const stop = cache.subscribeShotFailures(() => {
    told += 1;
  });
  check("hasShotFailed: nothing has failed yet", cache.hasShotFailed("V-broken", "web", urlKey) === false);
  cache.reportShotFailure("V-broken", "web", urlKey);
  check("reportShotFailure: remembered at once, listeners told", cache.hasShotFailed("V-broken", "web", urlKey) === true && told === 1, told);
  check("hasShotFailed: keyed like the aspects — another platform, another view or a new shot has not failed",
    !cache.hasShotFailed("V-broken", "ios", urlKey) &&
      !cache.hasShotFailed("V-other", "web", urlKey) &&
      !cache.hasShotFailed("V-broken", "web", cache.shotKey(shotOf("https://x/broken.png", "2026-11-02T00:00:00Z"))));
  cache.reportShotFailure("V-broken", "web", urlKey);
  check("reportShotFailure: a repeat tells nobody", told === 1, told);
  stop();
  delete global.window;
}

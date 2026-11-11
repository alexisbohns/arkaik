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
    same(stripIds, ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "strip:loose"]), show(stripIds));
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
  check("stripIdOf and LOOSE_STRIP_ID", wallModule.stripIdOf("F-a") === "strip:F-a" && wallModule.LOOSE_STRIP_ID === "strip:loose");
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null });
  check("All products: every product's flows, another product's view listed where its flow puts it",
    same(wall.strips.map((s) => s.id), ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "strip:F-adm", "strip:loose"]) &&
      wall.strips[0].items.some((i) => i.id === "V-admin@F-a:4"),
    show(wall.strips.map((s) => s.id)));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null, root: null });
  check("no anchor and no product named: parentless flows in snapshot order, each with its sub-flows, then the rest",
    same(wall.strips.map((s) => s.id), ["strip:F-zeta", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-adm", "strip:F-a", "strip:F-b", "strip:loose"]),
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
  const noFlows = wallOf({ nodes: [view("V-x", "X"), view("V-y", "Y")], productId: "app" });
  check("views but no flow: empty is no-flows, and the loose strip holds them",
    noFlows.empty === "no-flows" && same(noFlows.strips.map((s) => s.id), ["strip:loose"]) && noFlows.strips[0].items.length === 2);
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

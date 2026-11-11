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

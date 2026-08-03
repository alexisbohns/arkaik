#!/usr/bin/env node

/**
 * Delivery board grouping (lib/utils/delivery.ts) — (node × platform) item
 * expansion via per-platform statuses, flow exclusion, and status-column
 * grouping with the counted preset vs all statuses.
 */

const fs = require("fs");
const { loadDelivery, BUILD_DIR } = require("./load-delivery");

const {
  computeDeliveryItems,
  groupItemsByStatus,
  resolveProductScope,
  buildProductUsageIndex,
  filterAcceptances,
  EMPTY_FILTERS,
} = loadDelivery();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const nodes = [
  {
    // The headline case: live on iOS, backlog on Android, idea on web.
    id: "V-split",
    project_id: "p",
    species: "view",
    title: "Split",
    status: "idea",
    platforms: ["web", "ios", "android"],
    metadata: { platformStatuses: { ios: "live", android: "backlog" } },
  },
  {
    // No explicit platform statuses — every platform falls back to node.status.
    id: "V-plain",
    project_id: "p",
    species: "view",
    title: "Plain",
    status: "development",
    platforms: ["web", "ios"],
  },
  {
    // Flows are never delivery items.
    id: "F-flow",
    project_id: "p",
    species: "flow",
    title: "Flow",
    status: "live",
    platforms: ["web"],
    metadata: { playlist: { entries: [{ type: "view", view_id: "V-plain" }] } },
  },
  {
    id: "API-x",
    project_id: "p",
    species: "api-endpoint",
    title: "X",
    status: "releasing",
    platforms: ["web", "ios"],
  },
  {
    id: "DM-y",
    project_id: "p",
    species: "data-model",
    title: "Y",
    status: "backlog",
    platforms: ["web"],
  },
  {
    // Acceptances carry their own per-platform statuses — one item per platform.
    id: "AC-z",
    project_id: "p",
    species: "acceptance",
    title: "Z",
    status: "backlog",
    platforms: ["web", "ios"],
    metadata: { platformStatuses: { web: "live" } },
  },
];

const DELIVERY_PRESET = ["backlog", "development", "releasing", "live"];
const ALL_STATUSES = ["idea", "discovery", "backlog", "development", "releasing", "live", "archived"];

const key = (item) => `${item.node.id}:${item.platform}=${item.status}`;

// --- computeDeliveryItems ----------------------------------------------------
{
  const items = computeDeliveryItems(nodes, ["view"]);
  const keys = items.map(key).sort();
  assert(
    JSON.stringify(keys) ===
      JSON.stringify([
        "V-plain:ios=development",
        "V-plain:web=development",
        "V-split:android=backlog",
        "V-split:ios=live",
        "V-split:web=idea",
      ]),
    "views expand to one item per platform (override where present, node.status fallback elsewhere)",
  );

  assert(
    computeDeliveryItems(nodes, ["flow", "view"]).every((item) => item.node.species !== "flow"),
    "flows are excluded even when asked for (rollups are not deliverables)",
  );

  const apiAndDm = computeDeliveryItems(nodes, ["api-endpoint", "data-model"]).map(key).sort();
  assert(
    JSON.stringify(apiAndDm) ===
      JSON.stringify(["API-x:ios=releasing", "API-x:web=releasing", "DM-y:web=backlog"]),
    "APIs and data models yield one item per platform at node.status",
  );

  const acceptances = computeDeliveryItems(nodes, ["acceptance"]).map(key).sort();
  assert(
    JSON.stringify(acceptances) === JSON.stringify(["AC-z:ios=backlog", "AC-z:web=live"]),
    "acceptances expand to one item per platform (override where present, node.status fallback elsewhere)",
  );
}

// --- groupItemsByStatus ------------------------------------------------------
{
  const items = computeDeliveryItems(nodes, ["view"]);

  const preset = groupItemsByStatus(items, DELIVERY_PRESET);
  assert(
    JSON.stringify([...preset.keys()]) === JSON.stringify(DELIVERY_PRESET),
    "columns come back in the given status order",
  );
  assert(
    preset.get("live").map(key).join() === "V-split:ios=live" &&
      preset.get("backlog").map(key).join() === "V-split:android=backlog",
    "the same node lands in two columns for two platforms (live on iOS, backlog on Android)",
  );
  assert(
    [...preset.values()].flat().every((item) => item.status !== "idea"),
    "statuses outside the preset are dropped (idea hidden by default)",
  );

  const all = groupItemsByStatus(items, ALL_STATUSES);
  assert(
    all.get("idea").map(key).join() === "V-split:web=idea",
    "the all-statuses column set surfaces the idea item",
  );

  const iosOnly = groupItemsByStatus(items, ALL_STATUSES, "ios");
  const iosItems = [...iosOnly.values()].flat();
  assert(
    iosItems.every((item) => item.platform === "ios") && iosItems.length === 2,
    "platform narrowing keeps only that platform's items",
  );

  const sorted = groupItemsByStatus(computeDeliveryItems(nodes, ["view"]), ["development"]);
  assert(
    JSON.stringify(sorted.get("development").map((item) => item.node.id + ":" + item.platform)) ===
      JSON.stringify(["V-plain:ios", "V-plain:web"]),
    "columns sort by title then id (stable board)",
  );
}

// --- Product scope: the RFC's headline complaint -----------------------------
//
// "Rollups lie": a web-only back office drags down an Android delivery number it
// was never part of. Two products of different arity, so the union under All
// products is genuinely wider than the admin menu.
//
// `V-admin-stale` is what makes the All-products assertion *discriminate*. Its
// stored `platforms` over-claims the admin menu (the containment case the
// validator only warns about), so intersecting against `scope.platforms` — the
// union — would leave it in the Android column, while intersecting against its
// own product's menu clips it to web. Without it every assertion below would
// pass unchanged against the bug.

const scopeBundle = {
  project: {
    id: "P",
    metadata: {
      products: [
        { id: "app", title: "Consumer app", platforms: ["web", "ios", "android"] },
        { id: "admin", title: "Back office", platforms: ["web"] },
      ],
    },
  },
};

const scopeNodes = [
  {
    id: "V-admin",
    project_id: "P",
    species: "view",
    title: "Console",
    status: "development",
    platforms: ["web"],
    metadata: { product: "admin" },
  },
  {
    // Declares three platforms while its product ships one — clipped, not honoured.
    id: "V-admin-stale",
    project_id: "P",
    species: "view",
    title: "Audit log",
    status: "live",
    platforms: ["web", "ios", "android"],
    metadata: { product: "admin" },
  },
  {
    id: "V-app",
    project_id: "P",
    species: "view",
    title: "Home",
    status: "live",
    platforms: ["web", "ios", "android"],
    metadata: { product: "app" },
  },
];

const allScope = resolveProductScope(scopeBundle, null);
const adminScope = resolveProductScope(scopeBundle, "admin");
const noProductScope = resolveProductScope({ project: { id: "Q", metadata: {} } }, null);

{
  assert(
    JSON.stringify(allScope.platforms) === JSON.stringify(["web", "ios", "android"]),
    "precondition: under All products the scope's platform list is the union of both products",
  );

  const scoped = computeDeliveryItems(scopeNodes, ["view"], { scope: allScope }).map(key).sort();
  assert(
    scoped.every((entry) => !entry.startsWith("V-admin") || entry.includes(":web=")),
    `THE FIX: under All products no admin view pairs with iOS or Android (got ${JSON.stringify(scoped)})`,
  );
  assert(
    JSON.stringify(scoped) ===
      JSON.stringify([
        "V-admin-stale:web=live",
        "V-admin:web=development",
        "V-app:android=live",
        "V-app:ios=live",
        "V-app:web=live",
      ]),
    "under All products every node still appears — scoping narrows platforms, it does not hide nodes",
  );

  const stale = computeDeliveryItems([scopeNodes[1]], ["view"], { scope: allScope }).map((item) => item.platform);
  assert(
    JSON.stringify(stale) === JSON.stringify(["web"]),
    `a node claiming more platforms than its product's menu is clipped to the menu (got ${JSON.stringify(stale)})`,
  );

  const admin = computeDeliveryItems(scopeNodes, ["view"], { scope: adminScope }).map(key).sort();
  assert(
    JSON.stringify(admin) === JSON.stringify(["V-admin-stale:web=live", "V-admin:web=development"]),
    `the admin scope yields the admin views only, on web only (got ${JSON.stringify(admin)})`,
  );
}

// --- The degenerate cases: no options, and a project with no products ---------
{
  const today = computeDeliveryItems(scopeNodes, ["view"]).map(key).sort();
  assert(
    JSON.stringify(today) ===
      JSON.stringify([
        "V-admin-stale:android=live",
        "V-admin-stale:ios=live",
        "V-admin-stale:web=live",
        "V-admin:web=development",
        "V-app:android=live",
        "V-app:ios=live",
        "V-app:web=live",
      ]),
    "omitting options is today's behaviour exactly — the stale admin view still lands on Android (the lie)",
  );

  assert(
    JSON.stringify(computeDeliveryItems(nodes, ["view"], {}).map(key).sort()) ===
      JSON.stringify(computeDeliveryItems(nodes, ["view"]).map(key).sort()),
    "an options object carrying no scope is the same as no options at all",
  );

  assert(
    JSON.stringify(computeDeliveryItems(nodes, ["view"], { scope: noProductScope }).map(key).sort()) ===
      JSON.stringify(computeDeliveryItems(nodes, ["view"]).map(key).sort()),
    "a project declaring no products renders exactly as today, scope passed or not",
  );
}

// --- One resolver: Delivery and Acceptances must agree -----------------------
//
// `productsOfNode` is the single answer to "which products does this node belong
// to?", so a graph-bearing Delivery scopes an acceptance by its **anchors**,
// exactly as the Acceptances matrix does. The fixture makes that non-vacuous:
// AC-anchored stores `app` while covering an `admin` view, so stored-membership
// and anchors-first disagree about it, and only one of them can be right on both
// surfaces at once.

const accAnchored = {
  id: "AC-anchored",
  project_id: "P",
  species: "acceptance",
  title: "Bulk archive",
  status: "live",
  platforms: ["web"],
  metadata: { product: "app" },
};
// Reached only from the admin view, so a correct usage index keeps it out of `app`.
const dmAudit = { id: "DM-audit", project_id: "P", species: "data-model", title: "Audit", status: "live", platforms: ["web"] };
// Reached by nothing at all — the orphan.
const dmOrphan = { id: "DM-orphan", project_id: "P", species: "data-model", title: "Orphan", status: "backlog", platforms: ["web"] };

const graphNodes = [...scopeNodes, accAnchored, dmAudit, dmOrphan];
const graphEdges = [
  { id: "e1", project_id: "P", source_id: "AC-anchored", target_id: "V-admin", edge_type: "covers" },
  { id: "e2", project_id: "P", source_id: "V-admin", target_id: "DM-audit", edge_type: "queries" },
];
const graphNodesById = new Map(graphNodes.map((node) => [node.id, node]));
const graph = {
  edges: graphEdges,
  nodesById: graphNodesById,
  usageIndex: buildProductUsageIndex(graphNodes, graphEdges),
};

{
  const deliveryScopes = (productId) =>
    computeDeliveryItems([accAnchored], ["acceptance"], {
      scope: resolveProductScope(scopeBundle, productId),
      graph,
    }).length > 0;
  const acceptancesScopes = (productId) =>
    filterAcceptances([accAnchored], graphEdges, graphNodesById, { ...EMPTY_FILTERS, product: productId }).length > 0;

  assert(
    accAnchored.metadata.product === "app" && graphNodesById.get("V-admin").metadata.product === "admin",
    "precondition: the acceptance stores `app` while covering an `admin` view — the two readings disagree",
  );
  assert(
    deliveryScopes("admin") === acceptancesScopes("admin") &&
      deliveryScopes("app") === acceptancesScopes("app"),
    `ONE RESOLVER: Delivery and Acceptances put the same acceptance in the same scope (delivery admin=${deliveryScopes(
      "admin",
    )}/app=${deliveryScopes("app")}, acceptances admin=${acceptancesScopes("admin")}/app=${acceptancesScopes("app")})`,
  );
  assert(
    deliveryScopes("admin") === true && deliveryScopes("app") === false,
    "and they agree on the anchor's product, not the stored key",
  );
}

// --- The system layer under a named scope ------------------------------------
//
// Replaces the earlier assertion that a named scope drops data models and
// endpoints outright. That was true of stored-key membership and is now wrong by
// decision: the system layer derives membership from its consumers, and an
// orphan belongs to no product rather than to none of them.
{
  const key2 = (item) => item.node.id;
  const scoped = (productId) =>
    computeDeliveryItems([dmAudit, dmOrphan], ["data-model"], {
      scope: resolveProductScope(scopeBundle, productId),
      graph,
    })
      .map(key2)
      .sort();

  assert(
    JSON.stringify(scoped(null)) === JSON.stringify(["DM-audit", "DM-orphan"]),
    "data models are untouched under All products",
  );
  assert(
    JSON.stringify(scoped("admin")) === JSON.stringify(["DM-audit", "DM-orphan"]),
    `a data model reached from admin appears under admin (got ${JSON.stringify(scoped("admin"))})`,
  );
  assert(
    JSON.stringify(scoped("app")) === JSON.stringify(["DM-orphan"]),
    `a data model reached only from admin does NOT appear under app — the over-broad-index catch (got ${JSON.stringify(
      scoped("app"),
    )})`,
  );
  assert(
    scoped("admin").includes("DM-orphan") && scoped("app").includes("DM-orphan"),
    "an orphan data model appears under every named scope — it belongs to no product, and hiding it would bury the node that needs attention",
  );
}

// --- Without a graph, the resolver degrades rather than lying ----------------
{
  assert(
    computeDeliveryItems([accAnchored], ["acceptance"], { scope: adminScope }).length === 0 &&
      computeDeliveryItems([accAnchored], ["acceptance"], { scope: adminScope, graph }).length === 1,
    "the graph is what makes anchors-first possible — without it the scope falls back to the stored key",
  );
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} delivery test(s) failed.`);
  process.exit(1);
}
console.log("\nAll delivery tests passed.");

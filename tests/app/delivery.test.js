#!/usr/bin/env node

/**
 * Delivery board grouping (lib/utils/delivery.ts) — (node × platform) item
 * expansion via per-platform statuses, flow exclusion, and status-column
 * grouping with the counted preset vs all statuses.
 */

const fs = require("fs");
const { loadDelivery, BUILD_DIR } = require("./load-delivery");

const { computeDeliveryItems, groupItemsByStatus } = loadDelivery();

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
    // The headline case: live on iOS, prioritized on Android, idea on web.
    id: "V-split",
    project_id: "p",
    species: "view",
    title: "Split",
    status: "idea",
    platforms: ["web", "ios", "android"],
    metadata: { platformStatuses: { ios: "live", android: "prioritized" } },
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
];

const DELIVERY_PRESET = ["prioritized", "development", "releasing", "live", "blocked"];
const ALL_STATUSES = ["idea", "backlog", "prioritized", "development", "releasing", "live", "archived", "blocked"];

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
        "V-split:android=prioritized",
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
      preset.get("prioritized").map(key).join() === "V-split:android=prioritized",
    "the same node lands in two columns for two platforms (live on iOS, prioritized on Android)",
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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} delivery test(s) failed.`);
  process.exit(1);
}
console.log("\nAll delivery tests passed.");

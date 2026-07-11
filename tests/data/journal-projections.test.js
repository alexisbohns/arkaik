#!/usr/bin/env node

/**
 * Unit tests for the journal read-path projections (lib/utils/journal.ts,
 * docs/spec/journal.md § Projections): node timeline, changelog, and backlog.
 *
 * Exercised over one fixture journal, deliberately stored out of order to prove
 * consumers tolerate unordered lines (the journal ordering rule). Every
 * projection is also checked against the empty journal — it must return empty,
 * never throw (issue #204 acceptance criteria).
 */

const { loadJournalProjections, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-journal-projections");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const ids = (events) => events.map((e) => e.id).join(",");

const { computeNodeTimeline, computeChangelog, computeBacklog } = loadJournalProjections();

// --- Fixture journal (stored shuffled; consumers must order it) ------------
// Timeline (by ts): V-home created → idea "Dark mode" → V-settings created →
// edge e1 (V-home→V-settings) → release 1.0 → V-home live → V-settings dev →
// request "Add search" → idea "Profile" (→V-profile) → V-profile created →
// release 1.1 → V-settings live on ios → V-home title edited → edge e1 removed →
// release 1.2 (ios).
const EVENTS = {
  create_home: { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
  idea_dark: { id: "01B", ts: "2026-01-01T01:00:00.000Z", type: "idea.proposed", title: "Dark mode" },
  create_settings: { id: "01C", ts: "2026-01-01T02:00:00.000Z", type: "node.created", node_id: "V-settings", species: "view", title: "Settings" },
  edge_add: { id: "01D", ts: "2026-01-01T03:00:00.000Z", type: "edge.added", edge_id: "e1", source_id: "V-home", target_id: "V-settings", edge_type: "composes" },
  release_10: { id: "01E", ts: "2026-01-02T00:00:00.000Z", type: "release.tagged", version: "1.0" },
  home_live: { id: "01F", ts: "2026-01-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "live" },
  settings_dev: { id: "01G", ts: "2026-01-03T01:00:00.000Z", type: "node.status_changed", node_id: "V-settings", from: "idea", to: "development" },
  request_search: { id: "01H", ts: "2026-01-03T02:00:00.000Z", type: "request.filed", title: "Add search", source: "user" },
  idea_profile: { id: "01I", ts: "2026-01-03T03:00:00.000Z", type: "idea.proposed", title: "Profile page", node_id: "V-profile" },
  create_profile: { id: "01J", ts: "2026-01-03T04:00:00.000Z", type: "node.created", node_id: "V-profile", species: "view", title: "Profile" },
  release_11: { id: "01K", ts: "2026-01-04T00:00:00.000Z", type: "release.tagged", version: "1.1" },
  settings_live_ios: { id: "01L", ts: "2026-01-05T00:00:00.000Z", type: "node.status_changed", node_id: "V-settings", from: "development", to: "live", platform: "ios" },
  home_title: { id: "01M", ts: "2026-01-05T01:00:00.000Z", type: "node.updated", node_id: "V-home", fields: ["title"], from: "Home", to: "Home v2" },
  edge_remove: { id: "01N", ts: "2026-01-05T02:00:00.000Z", type: "edge.removed", edge_id: "e1" },
  release_12_ios: { id: "01O", ts: "2026-01-06T00:00:00.000Z", type: "release.tagged", version: "1.2", platform: "ios" },
};
// Shuffled input order — the projections must sort it themselves.
const JOURNAL = [
  EVENTS.release_11, EVENTS.create_home, EVENTS.edge_remove, EVENTS.settings_dev,
  EVENTS.release_12_ios, EVENTS.idea_dark, EVENTS.home_live, EVENTS.create_settings,
  EVENTS.release_10, EVENTS.create_profile, EVENTS.idea_profile, EVENTS.home_title,
  EVENTS.edge_add, EVENTS.request_search, EVENTS.settings_live_ios,
];

// Snapshot node → platforms, used only for platform-scoped changelog filtering.
const NODES_BY_ID = new Map([
  ["V-home", { platforms: ["web", "ios"] }],
  ["V-settings", { platforms: ["ios"] }],
  ["V-profile", { platforms: ["web"] }],
]);

function main() {
  // --- Node timeline: ordered events touching a node, including edge events ---
  const homeTimeline = computeNodeTimeline(JOURNAL, "V-home");
  check(
    "timeline(V-home) returns its events in order (create, edge+, status, update, edge-)",
    ids(homeTimeline) === "01A,01D,01F,01M,01N",
    ids(homeTimeline),
  );

  const settingsTimeline = computeNodeTimeline(JOURNAL, "V-settings");
  check(
    "timeline(V-settings) attributes edge.removed back to its endpoint",
    ids(settingsTimeline) === "01C,01D,01G,01L,01N",
    ids(settingsTimeline),
  );

  check("timeline does not mutate the input array", JOURNAL[0].id === "01K");
  check("timeline(unknown node) is empty", computeNodeTimeline(JOURNAL, "V-ghost").length === 0);
  check("timeline(empty journal) is empty", computeNodeTimeline([], "V-home").length === 0);

  // --- Changelog: the ordered slice strictly between two release markers ---
  const clExplicit = computeChangelog(JOURNAL, "1.1", { fromVersion: "1.0" });
  check(
    "changelog 1.0→1.1 is exactly the between-markers slice",
    ids(clExplicit.events) === "01F,01G,01H,01I,01J",
    ids(clExplicit.events),
  );
  check("changelog reports fromVersion/toVersion", clExplicit.fromVersion === "1.0" && clExplicit.toVersion === "1.1");
  check("changelog excludes both release markers", !clExplicit.events.some((e) => e.type === "release.tagged"));

  const clDefault = computeChangelog(JOURNAL, "1.1");
  check(
    "changelog to 1.1 with no from defaults to the previous marker (1.0)",
    clDefault.fromVersion === "1.0" && ids(clDefault.events) === ids(clExplicit.events),
    `${clDefault.fromVersion} / ${ids(clDefault.events)}`,
  );

  const clFirst = computeChangelog(JOURNAL, "1.0");
  check(
    "changelog to the first release runs from the journal's beginning",
    clFirst.fromVersion === null && ids(clFirst.events) === "01A,01B,01C,01D",
    `${clFirst.fromVersion} / ${ids(clFirst.events)}`,
  );

  // --- Changelog: platform-scoped release filters to that platform's nodes ---
  const clIos = computeChangelog(JOURNAL, "1.2", { nodesById: NODES_BY_ID });
  check(
    "platform-scoped changelog 1.2 (ios) keeps the ios status change + the ios node's update",
    clIos.platform === "ios" && ids(clIos.events) === "01L,01M",
    `${clIos.platform} / ${ids(clIos.events)}`,
  );

  const clIosNoNodes = computeChangelog(JOURNAL, "1.2");
  check(
    "platform-scoped changelog without a snapshot keeps only self-declaring events",
    ids(clIosNoNodes.events) === "01L",
    ids(clIosNoNodes.events),
  );

  check("changelog to an unknown version is empty", computeChangelog(JOURNAL, "9.9").events.length === 0);
  check("changelog(empty journal) is empty", computeChangelog([], "1.0").events.length === 0);

  // --- Backlog: open ideas/requests; a gained linked node closes an item ---
  const backlog = computeBacklog(JOURNAL);
  check(
    "backlog excludes the idea that gained a linked node (V-profile)",
    ids(backlog.items) === "01B,01H",
    ids(backlog.items),
  );
  check("backlog splits ideas and requests", ids(backlog.ideas) === "01B" && ids(backlog.requests) === "01H");

  // Snapshot without V-profile → the linked node no longer exists → item reopens.
  const backlogNoProfile = computeBacklog(JOURNAL, { existingNodeIds: new Set(["V-home", "V-settings"]) });
  check(
    "backlog reopens an idea whose linked node is absent from the snapshot",
    ids(backlogNoProfile.items) === "01B,01H,01I",
    ids(backlogNoProfile.items),
  );

  check("backlog(empty journal) is empty", computeBacklog([]).items.length === 0);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} journal-projection test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll journal-projection tests passed.`);
}

main();

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

const { computeNodeTimeline, computeChangelog, computeBacklog, computeDeliverables, computeCommitments } =
  loadJournalProjections();

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

  // Platform-scoped changelog also walks deliverable.shipped node_ids, the
  // same way it walks edge.added endpoints (#293 unscoped-covers-all fix).
  const deliverableIos = { id: "01P", ts: "2026-01-05T12:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-ios", title: "iOS settings sync", node_ids: ["V-settings"] };
  const deliverableWeb = { id: "01Q", ts: "2026-01-05T13:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-web", title: "Profile web polish", node_ids: ["V-profile"] };
  const journalWithDeliverable = [...JOURNAL, deliverableIos, deliverableWeb];
  const clIosDeliverable = computeChangelog(journalWithDeliverable, "1.2", { nodesById: NODES_BY_ID });
  check(
    "platform-scoped changelog includes a deliverable.shipped event whose node_ids touch that platform",
    clIosDeliverable.events.some((e) => e.id === "01P"),
    ids(clIosDeliverable.events),
  );
  check(
    "platform-scoped changelog excludes a deliverable.shipped event whose node_ids are on a different platform only",
    !clIosDeliverable.events.some((e) => e.id === "01Q"),
    ids(clIosDeliverable.events),
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

  // --- computeDeliverables (cycle 3) -----------------------------------------
  const DELIVERABLES = {
    // First occurrence between 1.0 and 1.1 → belongs to 1.1.
    d1: { id: "02A", ts: "2026-01-03T00:30:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship home", summary: "v1", node_ids: ["V-home"] },
    // Re-append AFTER 1.2 — edits content, must NOT move the anchor.
    d1_edit: { id: "02B", ts: "2026-01-07T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship home", summary: "v2 (edited)", node_ids: ["V-home"] },
    // First occurrence after the last marker → unreleased.
    d2: { id: "02C", ts: "2026-01-08T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-2", title: "Ship settings", url: "https://example.com/pull/2" },
  };
  const WITH_DELIVERABLES = [...JOURNAL, DELIVERABLES.d1_edit, DELIVERABLES.d1, DELIVERABLES.d2]; // shuffled

  const deliverables = computeDeliverables(WITH_DELIVERABLES);
  check("computeDeliverables: one record per deliverable_id", deliverables.length === 2);
  const d1 = deliverables.find((d) => d.deliverable_id === "pr-1");
  const d2 = deliverables.find((d) => d.deliverable_id === "pr-2");
  check("content is latest-wins", d1 && d1.summary === "v2 (edited)");
  check("anchor is the FIRST occurrence ts", d1 && d1.ts === "2026-01-03T00:30:00.000Z");
  check("released deliverable resolves to its slice's release", d1 && d1.releaseVersion === "1.1");
  check("post-release edit does not un-release", d1 && d1.releaseVersion === "1.1");
  check("first occurrence after the last marker is unreleased", d2 && d2.releaseVersion === null);
  check("url passes through", d2 && d2.url === "https://example.com/pull/2");
  check("node_ids default to empty array", d2 && Array.isArray(d2.node_ids) && d2.node_ids.length === 0);
  check("shipped order (first-occurrence order)", deliverables[0].deliverable_id === "pr-1");
  check("empty journal yields no deliverables", computeDeliverables([]).length === 0);

  // Re-tagged release: the version's LAST marker is the `to` boundary, so a
  // deliverable between the superseded marker and the re-tag belongs to the
  // re-tagged version's window.
  const RETAG = { id: "02D", ts: "2026-01-09T00:00:00.000Z", type: "release.tagged", version: "1.1" };
  const BETWEEN = { id: "02E", ts: "2026-01-08T12:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-3", title: "Between old and new 1.1" };
  const retagged = computeDeliverables([...WITH_DELIVERABLES, RETAG, BETWEEN]);
  const d3 = retagged.find((d) => d.deliverable_id === "pr-3");
  check("re-tagged version window uses the LAST marker", d3 && d3.releaseVersion === "1.1", JSON.stringify(d3));

  const changelog11 = computeChangelog(WITH_DELIVERABLES, "1.1");
  check(
    "Changelog.deliverables carries the slice's deliverables",
    changelog11.deliverables.length === 1 && changelog11.deliverables[0].deliverable_id === "pr-1",
  );
  check("Changelog.deliverables is empty for an unknown version", computeChangelog([], "9.9").deliverables.length === 0);

  // --- computeCommitments (cycle 3) ------------------------------------------
  const COMMITS = [
    { id: "03A", ts: "2026-02-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "discovery" },
    { id: "03B", ts: "2026-02-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "discovery", to: "backlog" },
    { id: "03C", ts: "2026-02-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "backlog", to: "development" },
    { id: "03D", ts: "2026-02-04T00:00:00.000Z", type: "node.status_changed", node_id: "V-x", from: "prioritized", to: "development" },
  ];
  const commitments = computeCommitments([COMMITS[2], COMMITS[0], COMMITS[3], COMMITS[1]]); // shuffled
  check(
    "computeCommitments keeps only idea→discovery and discovery→backlog, ordered",
    commitments.length === 2 && commitments[0].id === "03A" && commitments[1].id === "03B",
    JSON.stringify(commitments.map((e) => e.id)),
  );
  check("computeCommitments on an empty journal is empty", computeCommitments([]).length === 0);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} journal-projection test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll journal-projection tests passed.`);
}

main();

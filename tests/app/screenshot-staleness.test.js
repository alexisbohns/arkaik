#!/usr/bin/env node

/** `isScreenshotStale` (lib/utils/screenshot-staleness.ts): derived, never stored (spec § 5). */

const { loadScreenshotStaleness } = require("./load-screenshot-staleness");
const { isScreenshotStale, staleReasons, stalenessRelatedIds, STALENESS_EVENT_TYPES } = loadScreenshotStaleness();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const T0 = "2026-11-01T10:00:00.000Z";
const before = "2026-11-01T09:00:00.000Z";
const after = "2026-11-01T11:00:00.000Z";
const meta = { ts: T0, source: "ci", form: "url" };
const status = (ts, platform) => ({ id: ts, ts, type: "node.status_changed", node_id: "V-home", from: "development", to: "releasing", ...(platform ? { platform } : {}) });
const merged = (ts) => ({ id: ts, ts, type: "ref.status_changed", node_id: "V-home", ref_id: "gh-1", to: "merged", synced_at: ts });

check("no meta: not stale (nothing to be stale about)", isScreenshotStale(undefined, [status(after, "ios")], "V-home", "ios") === false);
check("no later event: not stale", isScreenshotStale(meta, [status(before, "ios")], "V-home", "ios") === false);
check("a later platform status change on this platform: stale", isScreenshotStale(meta, [status(after, "ios")], "V-home", "ios") === true);
check("a later status change on another platform: not stale", isScreenshotStale(meta, [status(after, "web")], "V-home", "ios") === false);
check("a later project-level status change: stale", isScreenshotStale(meta, [status(after)], "V-home", "ios") === true);
check("a later merged ref: stale", isScreenshotStale(meta, [merged(after)], "V-home", "ios") === true);
check("a later event on another node: not stale", isScreenshotStale(meta, [{ ...status(after, "ios"), node_id: "V-other" }], "V-home", "ios") === false);

const shipped = (ts, node_ids, platform) => ({ id: `s${ts}`, ts, type: "deliverable.shipped", deliverable_id: "d1", title: "t", node_ids, ...(platform ? { platform } : {}) });
check("a later shipped deliverable naming the node: stale", isScreenshotStale(meta, [shipped(after, ["V-home"])], "V-home", "ios") === true);
check("a shipped deliverable on another platform: not stale", isScreenshotStale(meta, [shipped(after, ["V-home"], "web")], "V-home", "ios") === false);
check("a shipped deliverable naming another node: not stale", isScreenshotStale(meta, [shipped(after, ["V-other"])], "V-home", "ios") === false);
check("an event at exactly meta.ts: not stale", isScreenshotStale(meta, [status(T0, "ios")], "V-home", "ios") === false);
check("a ref closed (not merged): not stale", isScreenshotStale(meta, [{ ...merged(after), to: "closed" }], "V-home", "ios") === false);

// --- Related ids: a view's covering acceptances (screens map spec F4) -------
// A deploy moves the acceptance, never the view, so the view's shot has to
// stale on the acceptance's events under the same three rules as its own.
const acStatus = (ts, platform, to = "live") => ({ id: `a${ts}`, ts, type: "node.status_changed", node_id: "AC-home", from: "releasing", to, ...(platform ? { platform } : {}) });
const acMerged = (ts) => ({ ...merged(ts), id: `m${ts}`, node_id: "AC-home" });

check("the event types are the three the rule reads, in order",
  JSON.stringify(STALENESS_EVENT_TYPES) === JSON.stringify(["node.status_changed", "ref.status_changed", "deliverable.shipped"]));
check("related: a later status change on this platform stales the shot", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", ["AC-home"]) === true);
check("related: a later project-wide status change stales the shot", isScreenshotStale(meta, [acStatus(after)], "V-home", "ios", ["AC-home"]) === true);
check("related: a status change on another platform does not", isScreenshotStale(meta, [acStatus(after, "web")], "V-home", "ios", ["AC-home"]) === false);
check("related: a later merged ref stales the shot", isScreenshotStale(meta, [acMerged(after)], "V-home", "ios", ["AC-home"]) === true);
check("related: a later shipped deliverable naming it stales the shot", isScreenshotStale(meta, [shipped(after, ["AC-home"])], "V-home", "ios", ["AC-home"]) === true);
check("related: a shipped deliverable on another platform does not", isScreenshotStale(meta, [shipped(after, ["AC-home"], "web")], "V-home", "ios", ["AC-home"]) === false);
check("related: an event before the shot does not", isScreenshotStale(meta, [acStatus(before, "ios")], "V-home", "ios", ["AC-home"]) === false);
check("an id that is not related does not stale the shot", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", ["AC-other"]) === false);
check("no related ids: an acceptance's event is ignored, as before", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios") === false);
check("an empty related list reads as no related ids", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", []) === false);

const T1 = "2026-11-01T12:00:00.000Z";
const reasons = staleReasons(
  meta,
  [
    status(after, "ios"),
    acStatus(T1, "ios"),
    { ...status(T1, "ios"), id: "z-same-ts" },
    status(before, "ios"),
    { ...acStatus(after, "web"), id: "other-platform" },
  ],
  "V-home",
  "ios",
  ["AC-home"],
);
check("staleReasons: every counting event, newest first, id descending on a tie",
  JSON.stringify(reasons.map((ev) => ev.id)) === JSON.stringify(["z-same-ts", `a${T1}`, after]),
  JSON.stringify(reasons.map((ev) => ev.id)));
check("staleReasons: none for a legacy shot", staleReasons(undefined, [status(after, "ios")], "V-home", "ios").length === 0);
check("staleReasons: none when nothing came after", staleReasons(meta, [status(before, "ios")], "V-home", "ios").length === 0);

const ac = (id, platforms, platformStatuses) => ({ id, species: "acceptance", status: "live", platforms, metadata: platformStatuses ? { platformStatuses } : {} });
check("stalenessRelatedIds: the acceptances that list the platform, in input order",
  JSON.stringify(stalenessRelatedIds([ac("AC-b", ["web", "ios"]), ac("AC-a", ["web"]), ac("AC-c", ["ios"], { ios: "development" })], "ios")) === JSON.stringify(["AC-b", "AC-c"]));
check("stalenessRelatedIds: none for a platform no acceptance lists", stalenessRelatedIds([ac("AC-a", ["web"])], "android").length === 0);
check("stalenessRelatedIds: none for no acceptances", stalenessRelatedIds([], "web").length === 0);

process.exit(failures > 0 ? 1 : 0);

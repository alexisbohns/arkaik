#!/usr/bin/env node

/** `isScreenshotStale` (lib/utils/screenshot-staleness.ts): derived, never stored (spec § 5). */

const { loadScreenshotStaleness } = require("./load-screenshot-staleness");
const { isScreenshotStale } = loadScreenshotStaleness();

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

process.exit(failures > 0 ? 1 : 0);

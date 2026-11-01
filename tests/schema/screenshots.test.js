#!/usr/bin/env node

/**
 * Screenshots as events (docs/superpowers/specs/2026-11-01-screenshot-events-design.md):
 * the two event types, the decision function every writer shares, the two
 * applyOps cases, the history reducers and the cross-check warning.
 *
 * Pure functions over plain objects — no store, no filesystem. Assertions
 * are by identity, never by count.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const schema = loadSchema();
const { makeEvent, JOURNAL_EVENT_TYPES } = schema;

// --- Task 1: event vocabulary -------------------------------------------------

check("screenshot.recorded is in the known vocabulary", JOURNAL_EVENT_TYPES.includes("screenshot.recorded"));
check("screenshot.removed is in the known vocabulary", JOURNAL_EVENT_TYPES.includes("screenshot.removed"));

{
  const ev = makeEvent("screenshot.recorded", {
    node_id: "V-home", platform: "ios", source: "ci", form: "url",
    url: "https://shots.example/abc.png", commit: "deadbeef", order: 412, detail: "HomeTest.default",
  }, { actor: "arkaik-ci", ts: "2026-11-01T10:00:00.000Z" });
  check("a full ci screenshot.recorded validates", ev.type === "screenshot.recorded" && ev.order === 412 && ev.actor === "arkaik-ci", JSON.stringify(ev));
}
{
  const ev = makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "manual", form: "data" });
  check("a manual data-form event validates with no url", ev.form === "data" && ev.url === undefined, JSON.stringify(ev));
}
{
  let threw = false;
  try { makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "robot", form: "url", url: "https://x/y.png" }); } catch { threw = true; }
  check("an unknown source is refused by the event schema", threw);
}
{
  let threw = false;
  try { makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "ci", form: "url", url: "https://x/y.png", order: 1.5 }); } catch { threw = true; }
  check("a non-integer order is refused by the event schema", threw);
}
{
  const ev = makeEvent("screenshot.removed", { node_id: "V-home", platform: "android" });
  check("screenshot.removed validates", ev.type === "screenshot.removed" && ev.platform === "android");
}

// --- Task 2: platformScreenshotMeta parses -------------------------------------

{
  const { NodeMetadataSchema } = schema;
  const parsed = NodeMetadataSchema.safeParse({
    platformScreenshots: { ios: "https://shots.example/a.png" },
    platformScreenshotMeta: { ios: { ts: "2026-11-01T10:00:00.000Z", source: "ci", form: "url", commit: "deadbeef", order: 3, ci_order: 3 } },
  });
  check("platformScreenshotMeta parses", parsed.success, JSON.stringify(parsed.error?.issues));
  const bare = NodeMetadataSchema.safeParse({ platformScreenshotMeta: { web: { ci_order: 9 } } });
  check("a watermark-only meta entry parses (slot removed, watermark kept)", bare.success, JSON.stringify(bare.error?.issues));
  const bad = NodeMetadataSchema.safeParse({ platformScreenshotMeta: { web: { ts: "x", source: "bot", form: "url" } } });
  check("an unknown meta source is refused", !bad.success);
}

process.exit(failures > 0 ? 1 : 0);

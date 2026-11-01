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

// --- Task 3: decideScreenshot --------------------------------------------------

const { decideScreenshot, isValidScreenshotValue } = schema;

function view(id, extra = {}) {
  return { id, project_id: "p", species: "view", title: id, status: "live", platforms: ["web", "ios"], ...extra };
}
const ci = (over = {}) => ({ node_id: "V-home", platform: "ios", source: "ci", form: "url", value: "https://s/a.png", commit: "c1", order: 10, ...over });
const manual = (over = {}) => ({ node_id: "V-home", platform: "ios", source: "manual", form: "url", value: "https://s/m.png", ...over });

check("https is a valid url form", isValidScreenshotValue("url", "https://s/a.png"));
check("http is not a valid url form", !isValidScreenshotValue("url", "http://s/a.png"));
check("a relative path is a valid path form", isValidScreenshotValue("path", "assets/web/home.png"));
check("a leading slash is not a valid path form", !isValidScreenshotValue("path", "/assets/home.png"));
check("a scheme is not a valid path form", !isValidScreenshotValue("path", "https://s/a.png"));
check("an image data uri is a valid data form", isValidScreenshotValue("data", "data:image/png;base64,AAAA"));
check("a case-insensitive image data uri is valid", isValidScreenshotValue("data", "data:IMAGE/PNG;base64,AAAA"));
check("a bare data:image/ prefix is not valid", !isValidScreenshotValue("data", "data:image/"));
check("a path climbing out is not valid", !isValidScreenshotValue("path", "../../etc/x.png"));
check("a non-image data uri is not a valid data form", !isValidScreenshotValue("data", "data:text/plain;base64,AAAA"));

{
  const d = decideScreenshot(undefined, ci());
  check("an unknown node refuses node_not_found", d.kind === "refuse" && d.code === "node_not_found", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("DM-x", { species: "data-model" }), ci({ node_id: "DM-x" }));
  check("a data model refuses not_shot_bearing", d.kind === "refuse" && d.code === "not_shot_bearing", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ platform: "android" }));
  check("a platform the node does not list refuses platform_not_applicable", d.kind === "refuse" && d.code === "platform_not_applicable", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ value: "http://s/a.png" }));
  check("an http url refuses invalid_screenshot", d.kind === "refuse" && d.code === "invalid_screenshot", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ order: undefined }));
  check("a ci shot without order refuses invalid_screenshot", d.kind === "refuse" && d.code === "invalid_screenshot", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), manual({ form: "data", value: "data:image/png;base64,AAAA" }));
  check("a manual data shot on a fresh slot applies", d.kind === "apply", JSON.stringify(d));
}
{
  const node = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } } } });
  const d = decideScreenshot(node, ci({ order: 9, value: "https://s/old.png" }));
  check("a ci shot below the watermark skips stale_order", d.kind === "skip" && d.reason === "stale_order", JSON.stringify(d));
  const same = decideScreenshot(node, ci({ order: 11 }));
  check("the same value again skips unchanged", same.kind === "skip" && same.reason === "unchanged", JSON.stringify(same));
  const equal = decideScreenshot(node, ci({ order: 10, value: "https://s/b.png" }));
  check("a ci shot at the watermark applies (equal order is a re-run of the same height)", equal.kind === "apply", JSON.stringify(equal));
  const person = decideScreenshot(node, manual());
  check("a manual shot always applies over a ci one", person.kind === "apply", JSON.stringify(person));
}
{
  const afterManual = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/m.png" }, platformScreenshotMeta: { ios: { source: "manual", form: "url", ci_order: 10 } } } });
  const late = decideScreenshot(afterManual, ci({ order: 9 }));
  check("a late ci re-run below the watermark cannot overwrite a manual shot", late.kind === "skip" && late.reason === "stale_order", JSON.stringify(late));
  const fresh = decideScreenshot(afterManual, ci({ order: 12 }));
  check("a newer ci shot replaces a manual one", fresh.kind === "apply", JSON.stringify(fresh));
}
{
  const removed = view("V-home", { metadata: { platformScreenshotMeta: { ios: { ci_order: 10 } } } });
  const d = decideScreenshot(removed, ci({ order: 9 }));
  check("the watermark survives a removal", d.kind === "skip" && d.reason === "stale_order", JSON.stringify(d));
}

process.exit(failures > 0 ? 1 : 0);

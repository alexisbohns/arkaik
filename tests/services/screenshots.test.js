#!/usr/bin/env node

/**
 * The pure core behind `POST /api/graph/projects/{id}/screenshots` (screenshot
 * events, part 2): lib/services/graph/screenshots.ts. DB-free like the live
 * planner — `parseScreenshotEntries` is shape validation, `planScreenshots`
 * takes the nodes as an argument and defers every decision to
 * `decideScreenshot` (@arkaik/schema), so the door and `applyOps` cannot
 * disagree. Assertions by identity, never by count.
 */

const { loadScreenshots } = require("./load-screenshots");
const { parseScreenshotEntries, planScreenshots } = loadScreenshots();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const view = (id, extra = {}) => ({ id, project_id: "p", species: "view", title: id, status: "live", platforms: ["web", "ios"], ...extra });
const entry = (over = {}) => ({ node_id: "V-home", platform: "ios", url: "https://s/a.png", commit: "c1", order: 10, ...over });
const isError = (r) => !Array.isArray(r) && typeof r.error === "string";

// --- parseScreenshotEntries ---------------------------------------------------
{
  const ok = parseScreenshotEntries({ entries: [entry({ detail: "HomeTest.default" })] });
  check("a full entry parses", Array.isArray(ok) && ok[0].node_id === "V-home" && ok[0].order === 10 && ok[0].detail === "HomeTest.default", JSON.stringify(ok));
}
check("a non-object body is an error", isError(parseScreenshotEntries(null)) && isError(parseScreenshotEntries([])));
check("an empty entries array is an error", isError(parseScreenshotEntries({ entries: [] })));
{
  const many = Array.from({ length: 101 }, (_, i) => entry({ node_id: `V-${i}` }));
  check("more than 100 entries is an error", isError(parseScreenshotEntries({ entries: many })));
}
check("platform is required", isError(parseScreenshotEntries({ entries: [{ node_id: "V-home", url: "https://s/a.png", commit: "c1", order: 1 }] })));
check("url is required", isError(parseScreenshotEntries({ entries: [{ node_id: "V-home", platform: "ios", commit: "c1", order: 1 }] })));
check("commit is required (a ci shot without provenance is worthless)", isError(parseScreenshotEntries({ entries: [entry({ commit: undefined })] })));
check("order is required and an integer", isError(parseScreenshotEntries({ entries: [entry({ order: undefined })] })) && isError(parseScreenshotEntries({ entries: [entry({ order: 1.5 })] })));
check("an unknown key is refused", isError(parseScreenshotEntries({ entries: [entry({ source: "manual" })] })));
check("a repeated (node_id, platform) pair is refused", isError(parseScreenshotEntries({ entries: [entry(), entry({ url: "https://s/b.png" })] })));
check("detail is capped at 2000 characters", isError(parseScreenshotEntries({ entries: [entry({ detail: "x".repeat(2001) })] })));

// --- planScreenshots ----------------------------------------------------------
{
  const plan = planScreenshots([view("V-home")], [entry()]);
  check("a fresh slot applies", plan.ok && plan.applied.find((a) => a.node_id === "V-home" && a.platform === "ios") !== undefined, JSON.stringify(plan));
  const op = plan.ok && plan.ops.find((o) => o.op === "record_screenshot");
  check("the op is a record_screenshot with source ci and form url", op && op.source === "ci" && op.form === "url" && op.value === "https://s/a.png" && op.order === 10 && op.commit === "c1", JSON.stringify(op));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ node_id: "V-nope" })]);
  check("an unknown node refuses the batch", !plan.ok && plan.refusals.find((r) => r.reason === "unknown_node" && r.index === 0) !== undefined, JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("F-x", { species: "flow" })], [entry({ node_id: "F-x" })]);
  check("a flow refuses not_shot_bearing", !plan.ok && plan.refusals[0].reason === "not_shot_bearing", JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ platform: "android" })]);
  check("an unlisted platform refuses platform_not_applicable with the list", !plan.ok && plan.refusals[0].reason === "platform_not_applicable" && /web, ios/.test(plan.refusals[0].detail ?? ""), JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ url: "http://s/a.png" })]);
  check("an http url refuses invalid_url", !plan.ok && plan.refusals[0].reason === "invalid_url", JSON.stringify(plan));
}
{
  const seeded = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } } } });
  const stale = planScreenshots([seeded], [entry({ order: 9, url: "https://s/old.png" })]);
  check("a stale order is a skip, not a refusal", stale.ok && stale.skipped.find((s) => s.reason === "stale_order") !== undefined && stale.ops.length === 0, JSON.stringify(stale));
  const same = planScreenshots([seeded], [entry({ order: 11 })]);
  check("an unchanged url is a skip", same.ok && same.skipped.find((s) => s.reason === "unchanged") !== undefined, JSON.stringify(same));
  const mixed = planScreenshots([seeded], [entry({ order: 9 }), entry({ platform: "web", url: "https://s/w.png" })]);
  check("a batch with one skip and one apply applies the one", mixed.ok && mixed.ops.length === 1 && mixed.applied[0].platform === "web" && mixed.skipped[0].platform === "ios", JSON.stringify(mixed));
}
{
  const plan = planScreenshots([view("V-home")], [entry(), entry({ node_id: "V-nope", platform: "web" })]);
  check("one refusal refuses the whole batch", !plan.ok && plan.refusals.length === 1 && plan.refusals[0].node_id === "V-nope");
}

process.exit(failures > 0 ? 1 : 0);

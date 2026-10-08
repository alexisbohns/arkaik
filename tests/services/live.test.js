#!/usr/bin/env node

/**
 * The pure core behind `POST /api/graph/projects/{id}/live` (issue #424):
 * lib/services/graph/live.ts. DB-free by construction — `parseLiveEntries`
 * is shape validation with no I/O, and `planLive` takes the project's nodes
 * as a plain argument rather than reading them, the same seam
 * quality-events.ts uses. This is why it runs in CI's fast build job.
 *
 * Assertions are by identity (`find`, `every`), never by count — a count
 * passes when the code under test does nothing.
 */

const fs = require("fs");
const { loadLive, BUILD_DIR } = require("./load-live");

const { parseLiveEntries, planLive } = loadLive();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

function acceptance(id, extra = {}) {
  return {
    id,
    project_id: "p",
    species: "acceptance",
    title: id,
    status: "releasing",
    platforms: ["web", "ios"],
    ...extra,
  };
}

const isError = (r) => !Array.isArray(r) && typeof r.error === "string";

// --- parseLiveEntries ----------------------------------------------------------

{
  const ok = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "App Store 2.4.1 (318)" }] });
  check("a full entry parses", Array.isArray(ok) && ok[0].node_id === "AC-x" && ok[0].platform === "ios" && ok[0].detail === "App Store 2.4.1 (318)", JSON.stringify(ok));
}
{
  const ok = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "web" }] });
  check("detail is optional", Array.isArray(ok) && ok[0].detail === undefined, JSON.stringify(ok));
}
check("a non-object body is an error", isError(parseLiveEntries(null)) && isError(parseLiveEntries([])));
check("a missing entries array is an error", isError(parseLiveEntries({})));
check("an empty entries array is an error", isError(parseLiveEntries({ entries: [] })));
{
  const many = Array.from({ length: 51 }, (_, i) => ({ node_id: `AC-${i}`, platform: "web" }));
  check("more than 50 entries is an error", isError(parseLiveEntries({ entries: many })));
}
check("an entry that is not an object is an error", isError(parseLiveEntries({ entries: ["AC-x"] })));
check("node_id is required", isError(parseLiveEntries({ entries: [{ platform: "ios" }] })));
check("node_id must be non-empty", isError(parseLiveEntries({ entries: [{ node_id: "", platform: "ios" }] })));
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x" }] });
  check("platform is REQUIRED — an unscoped live is the biggest claim in the system", isError(r) && /platform/.test(r.error), JSON.stringify(r));
}
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "windows" }] });
  check("an unknown platform is an error naming the valid ones", isError(r) && /web, ios, android/.test(r.error), JSON.stringify(r));
}
check("detail must be non-empty when present", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "" }] })));
check("detail must be a string", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: 7 }] })));
check("detail is capped at 2000 characters", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "x".repeat(2001) }] })));
check("2000 characters of detail is fine", Array.isArray(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "x".repeat(2000) }] })));
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "ios" }] });
  check("the same (node, platform) twice in one batch is an error", isError(r) && /entries\[1\]/.test(r.error), JSON.stringify(r));
}
check(
  "the same node on two platforms is fine",
  Array.isArray(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "web" }] })),
);
check("an unknown top-level key is an error", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios" }], extra: 1 })));
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", details: "x" }] });
  check("an unknown entry key is an error naming it — a `details` typo cannot drop the evidence", isError(r) && /details/.test(r.error), JSON.stringify(r));
}
check(
  "a detail with an ANSI escape is an error",
  isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "build \u001b[31mred" }] })),
);
check(
  "a detail with a tab is an error",
  isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "build\t318" }] })),
);
{
  const detail = "App Store 2.4.1 (318) — phased, 10%; see https://example.com/notes?x=1&y=2!";
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail }] });
  check("a detail with ordinary punctuation and an em dash parses", Array.isArray(r) && r[0].detail === detail, JSON.stringify(r));
}

// --- planLive: refusals --------------------------------------------------------

{
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-nope", platform: "ios" }]);
  check("an unknown node is refused", !plan.ok && plan.refusals.find((r) => r.index === 0 && r.node_id === "AC-nope" && r.reason === "unknown_node") !== undefined, JSON.stringify(plan));
}
{
  const view = { id: "V-a", project_id: "p", species: "view", title: "A", status: "releasing", platforms: ["web"] };
  const plan = planLive([view], [{ node_id: "V-a", platform: "web" }]);
  check(
    "only acceptances go live",
    !plan.ok && plan.refusals.find((r) => r.index === 0 && r.node_id === "V-a" && r.reason === "not_acceptance" && /is a view/.test(r.detail ?? "")) !== undefined,
    JSON.stringify(plan),
  );
}
{
  const plan = planLive([acceptance("AC-x", { status: "archived" })], [{ node_id: "AC-x", platform: "ios" }]);
  check(
    "an archived acceptance is never resurrected by a deploy",
    !plan.ok && plan.refusals.find((r) => r.index === 0 && r.node_id === "AC-x" && r.reason === "archived") !== undefined,
    JSON.stringify(plan),
  );
}
{
  const node = acceptance("AC-x", { metadata: { platformStatuses: { ios: "archived" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  check(
    "a platform deliberately dropped is not brought back by a deploy",
    !plan.ok && plan.refusals.find((r) => r.reason === "archived" && r.platform === "ios") !== undefined,
    JSON.stringify(plan),
  );
}
{
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "android" }]);
  check(
    "a platform the acceptance does not list is refused, never guessed",
    !plan.ok &&
      plan.refusals.find((r) => r.index === 0 && r.node_id === "AC-x" && r.reason === "platform_not_applicable" && /web, ios/.test(r.detail ?? "")) !== undefined,
    JSON.stringify(plan),
  );
}
{
  const plan = planLive([acceptance("AC-e", { platforms: [] })], [{ node_id: "AC-e", platform: "web" }]);
  check(
    "an acceptance listing no platforms says so",
    !plan.ok && plan.refusals.find((r) => r.reason === "platform_not_applicable" && /lists no platforms/.test(r.detail ?? "")) !== undefined,
    JSON.stringify(plan),
  );
}
{
  // All-or-nothing: one bad entry refuses the batch, and the good one is not applied.
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "android" }]);
  check(
    "one refused entry refuses the whole batch",
    !plan.ok &&
      plan.refusals.find((r) => r.index === 1 && r.reason === "platform_not_applicable") !== undefined &&
      !plan.refusals.some((r) => r.index === 0),
    JSON.stringify(plan),
  );
}
{
  const plan = planLive(
    [acceptance("AC-arch", { status: "archived" })],
    [{ node_id: "AC-nope", platform: "ios" }, { node_id: "AC-arch", platform: "ios" }],
  );
  check(
    "every refusal is collected, not just the first",
    !plan.ok &&
      plan.refusals.find((r) => r.index === 0 && r.node_id === "AC-nope" && r.reason === "unknown_node") !== undefined &&
      plan.refusals.find((r) => r.index === 1 && r.node_id === "AC-arch" && r.reason === "archived") !== undefined,
    JSON.stringify(plan),
  );
}

// --- planLive: the write -------------------------------------------------------

{
  const node = acceptance("AC-x");
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios", detail: "App Store 2.4.1 (318)" }]);
  check("a valid entry plans", plan.ok, JSON.stringify(plan));
  const op = plan.ok && plan.ops.find((o) => o.op === "update_node" && o.node_id === "AC-x");
  check("as one update_node op", op !== undefined && op !== false, JSON.stringify(plan));
  check(
    "that patches only platformStatuses",
    op && JSON.stringify(Object.keys(op.patch)) === '["metadata"]' && op.patch.status === undefined && op.patch.metadata.platformStatuses.ios === "live",
    JSON.stringify(op),
  );
  check("and invents no entry for the other platform", op && op.patch.metadata.platformStatuses.web === undefined, JSON.stringify(op));
  check(
    "applied records where it came from",
    plan.ok && plan.applied.find((a) => a.node_id === "AC-x" && a.platform === "ios" && a.from === "releasing" && a.to === "live") !== undefined,
    JSON.stringify(plan),
  );
  check(
    "the detail becomes an annotation for the store to stamp on the event",
    plan.ok && plan.annotations.find((a) => a.node_id === "AC-x" && a.platform === "ios" && a.detail === "App Store 2.4.1 (318)") !== undefined,
    JSON.stringify(plan),
  );
  check("nothing was skipped", plan.ok && plan.skipped[0] === undefined, JSON.stringify(plan));
}
{
  const node = acceptance("AC-x", { metadata: { note: "keep me", platformStatuses: { web: "development" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  const op = plan.ok && plan.ops.find((o) => o.node_id === "AC-x");
  check("existing metadata survives the patch (applyOps replaces metadata wholesale)", op && op.patch.metadata.note === "keep me", JSON.stringify(op));
  check("and so does the other platform's entry", op && op.patch.metadata.platformStatuses.web === "development", JSON.stringify(op));
  check("from is the platform's resolved status, falling back to the base", plan.ok && plan.applied[0].from === "releasing", JSON.stringify(plan));
}
{
  const node = acceptance("AC-x", { metadata: { platformStatuses: { ios: "development" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  check("from is the platform's own entry when it has one", plan.ok && plan.applied[0]?.from === "development", JSON.stringify(plan));
}
{
  // Two platforms, one node → ONE op carrying both entries. Two ops built
  // from the same pre-write node would erase each other.
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "web" }]);
  const ops = plan.ok ? plan.ops.filter((o) => o.node_id === "AC-x") : [];
  check("two platforms fold into one op", ops[0] !== undefined && ops[1] === undefined, JSON.stringify(plan));
  check("carrying both entries", ops[0] && ops[0].patch.metadata.platformStatuses.ios === "live" && ops[0].patch.metadata.platformStatuses.web === "live", JSON.stringify(ops));
}
{
  const node = acceptance("AC-x", { metadata: { platformStatuses: { ios: "live" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios", detail: "re-run" }]);
  check("already live is a skip, not a refusal — a re-run deploy job gets a 200", plan.ok, JSON.stringify(plan));
  check("reported as already_live with its index", plan.ok && plan.skipped.find((s) => s.index === 0 && s.node_id === "AC-x" && s.platform === "ios" && s.reason === "already_live") !== undefined, JSON.stringify(plan));
  check("and plans no op", plan.ok && plan.ops[0] === undefined, JSON.stringify(plan));
  check("and applies nothing", plan.ok && plan.applied[0] === undefined, JSON.stringify(plan));
  check("and no annotation", plan.ok && plan.annotations[0] === undefined, JSON.stringify(plan));
}
{
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "ios" }]);
  check("no detail, no annotation", plan.ok && plan.annotations[0] === undefined, JSON.stringify(plan));
}
{
  const node = acceptance("AC-x", { status: "live" });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  check("a platform inheriting a live base is already live too", plan.ok && plan.skipped[0]?.reason === "already_live", JSON.stringify(plan));
}
{
  const live = acceptance("AC-l", { metadata: { platformStatuses: { ios: "live" } } });
  const fresh = acceptance("AC-f");
  const plan = planLive([live, fresh], [{ node_id: "AC-l", platform: "ios" }, { node_id: "AC-f", platform: "ios" }]);
  check("a skip beside an applied entry: the applied one still lands", plan.ok && plan.applied.find((a) => a.node_id === "AC-f") !== undefined && plan.skipped.find((s) => s.node_id === "AC-l") !== undefined, JSON.stringify(plan));
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll live checks passed.");

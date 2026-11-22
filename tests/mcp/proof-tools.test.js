#!/usr/bin/env node

/**
 * The proof tool over stdio (docs/rfcs/stake-architecture.md § 14, part D) —
 * `stake_proof` against a tmpdir repo. The hosted path (the server's fold of the
 * same sections) is covered in remote-store.test.js.
 *
 * What this covers that tests/schema/stake-proof.test.js cannot: that the tool
 * loads the journal and the quality section the way a session sees them, passes
 * the product and the clock through, answers one stake or all of them with a
 * count per state, refuses what it cannot read, and never writes.
 *
 * Run via `npm run test:mcp` (builds `arkaik-mcp` first).
 */

const { spawn } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");

if (!existsSync(SERVER)) {
  console.error("arkaik-mcp is not built. Run: npm run build -w arkaik-mcp (test:mcp does this).");
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";
const NOW = "2026-06-01T00:00:00.000Z";
const daysBefore = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const n = (id, species, title, status, extra = {}) => ({ id, project_id: "demo", species, title, status, platforms: [], ...extra });
const e = (source_id, target_id, edge_type) => ({ id: `e-${source_id}-${target_id}`, project_id: "demo", source_id, target_id, edge_type });

const NODES = [
  n("V-compose", "view", "Compose a pebble", "live", { platforms: ["web", "ios"] }),
  // A friction with an answer: one acceptance, live on web and merged on ios.
  n("STK-slow", "stake", "Slow reveal", "discovery", { metadata: { stake_species: "friction", reverify_every_days: 30 } }),
  n("OPT-skip", "option", "Skip the reveal", "discovery"),
  n("AC-skip", "acceptance", "The reveal is skipped", "backlog", { platforms: ["web", "ios"], metadata: { platformStatuses: { web: "live", ios: "releasing" } } }),
  n("DEC-skip", "decision", "Select skip", "backlog", { metadata: { decision_status: "approved", decided_at: "2026-02-01" } }),
  // A requirement read against Kritik, raised before its score.
  n("STK-safe", "stake", "Checkout is safe", "discovery", { metadata: { stake_species: "requirement", catalog: { source: "kritik", id: "SAF-01" } } }),
  n("STK-bare", "stake", "Bare", "idea", { metadata: { stake_species: "need" } }),
  n("STK-gone", "stake", "Gone", "archived", { metadata: { stake_species: "bug", felt: "expected" } }),
];
const EDGES = [
  e("STK-slow", "V-compose", "concerns"),
  e("OPT-skip", "STK-slow", "addresses"),
  e("AC-skip", "OPT-skip", "addresses"),
  e("AC-skip", "V-compose", "covers"),
  e("DEC-skip", "STK-slow", "impacts"),
  e("DEC-skip", "OPT-skip", "generates"),
  e("STK-safe", "V-compose", "concerns"),
];
const QUALITY = {
  framework_version: "0.1.0",
  profile: { surfaces: [{ id: "web", title: "Web", platforms: ["web"] }] },
  assessments: [{ criterion_id: "SAF-01", surface: "web", level: 3, evidence: "src/pay.ts:1", audit_id: "2026-05", ts: daysBefore(20) }],
  findings: [],
};
const BUNDLE = {
  schema_version: 3,
  project: {
    id: "demo",
    title: "Demo",
    created_at: ISO,
    updated_at: ISO,
    metadata: { products: [{ id: "site", title: "Site", platforms: ["web"] }, { id: "app", title: "App", platforms: ["web", "ios"] }] },
  },
  nodes: NODES,
  edges: EDGES,
  quality: QUALITY,
};
const line = (event) => JSON.stringify(event);
const JOURNAL = [
  ...NODES.map((node, i) => line({ id: `01A${String(i).padStart(2, "0")}`, ts: daysBefore(100), type: "node.created", node_id: node.id, species: node.species, title: node.title })),
  line({ id: "01B00", ts: daysBefore(10), type: "node.status_changed", node_id: "AC-skip", from: "development", to: "live", platform: "web" }),
  line({ id: "01B01", ts: daysBefore(10), type: "node.status_changed", node_id: "AC-skip", from: "development", to: "releasing", platform: "ios" }),
  line({ id: "01B02", ts: daysBefore(3), type: "deliverable.shipped", title: "Shipped", node_ids: ["AC-skip"] }),
].join("\n");

function startSession() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-proof-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  writeFileSync(bundlePath, JSON.stringify(BUNDLE, null, 2));
  const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
  writeFileSync(journalPath, `${JOURNAL}\n`);
  const child = spawn(process.execPath, [SERVER, "--bundle", bundlePath], { stdio: ["pipe", "pipe", "pipe"], cwd: dir });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (text) => {
    if (!text.trim()) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000).unref?.();
    });
  const call = async (name, args = {}) => {
    const response = await request("tools/call", { name, arguments: args });
    const text = response.result?.content?.[0]?.text ?? "";
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
    return { isError: response.result?.isError === true, json, text };
  };
  return {
    request,
    call,
    bundleText: () => readFileSync(bundlePath, "utf8"),
    journalText: () => readFileSync(journalPath, "utf8"),
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const s = startSession();
  try {
    await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "proof-test", version: "0" } });
    const listed = await s.request("tools/list");
    const def = (listed.result?.tools ?? []).find((t) => t.name === "stake_proof");
    check("the catalog lists stake_proof", def !== undefined);
    check("it requires nothing: one stake or all", !def.inputSchema.required || def.inputSchema.required.length === 0);
    check("it takes a stake, a product and a clock", JSON.stringify(Object.keys(def.inputSchema.properties)) === JSON.stringify(["stake_id", "product", "now"]));
    check("it takes no author: it only reads", !("actor" in def.inputSchema.properties));

    const bundleBefore = s.bundleText();
    const journalBefore = s.journalText();

    // --- one stake -----------------------------------------------------------------
    const one = await s.call("stake_proof", { stake_id: "STK-slow", now: NOW });
    const proof = one.json.stake;
    check("one stake returns its proof", !one.isError && proof?.stake_id === "STK-slow", one.text.slice(0, 300));
    check("the clock it read against is echoed", one.json.now === NOW && one.json.product === null);
    check("web is live and ios is merged: partly addressed", proof.state === "partly-addressed", String(proof.state));
    check("it names the answer, the definition of done and the delivery", proof.answer?.option_id === "OPT-skip" && JSON.stringify(proof.definition_of_done) === JSON.stringify(["AC-skip"]) && proof.delivery === "required" && proof.answer_type === "enhancement", JSON.stringify(proof));
    const web = proof.cells.find((c) => c.platform === "web");
    const ios = proof.cells.find((c) => c.platform === "ios");
    check("web: verified and delivered, checked from the journal", web.verified && web.delivered && !web.stale && web.checked_at === daysBefore(10), JSON.stringify(web));
    check("ios: verified, not delivered", ios.verified && !ios.delivered && !ios.stale, JSON.stringify(ios));

    // --- the product narrows the platforms --------------------------------------------
    const site = await s.call("stake_proof", { stake_id: "STK-slow", product: "site", now: NOW });
    check("scoped to a web-only product, ios drops out and the stake is addressed", site.json.stake.state === "addressed" && site.json.stake.cells.length === 1 && site.json.product === "site", site.text.slice(0, 300));
    const app = await s.call("stake_proof", { stake_id: "STK-slow", product: "app", now: NOW });
    check("scoped to a product that ships both, both stay", app.json.stake.cells.length === 2 && app.json.stake.state === "partly-addressed");

    // --- the clock is an argument -------------------------------------------------------
    const later = await s.call("stake_proof", { stake_id: "STK-slow", now: "2026-09-01T00:00:00.000Z" });
    check("read 90 days on, the 30-day interval has lapsed: promised", later.json.stake.state === "promised", `${later.json.stake.state} ${JSON.stringify(later.json.stake.cells)}`);
    check("and the cells say so", later.json.stake.cells.every((c) => c.stale));
    const dateOnly = await s.call("stake_proof", { stake_id: "STK-slow", now: "2026-06-01" });
    check("a date alone is a clock too", !dateOnly.isError && dateOnly.json.now === "2026-06-01T00:00:00.000Z", dateOnly.text.slice(0, 200));

    // --- every stake -----------------------------------------------------------------------
    const all = await s.call("stake_proof", { now: NOW });
    check("without a stake it returns every stake", !all.isError && all.json.count === 4 && all.json.stakes.length === 4, all.text.slice(0, 300));
    const byId = Object.fromEntries(all.json.stakes.map((p) => [p.stake_id, p]));
    check("a bare need is raised", byId["STK-bare"].state === "raised");
    check("an archived stake derives no state, and is counted as archived", byId["STK-gone"].state === null && all.json.counts.archived === 1);
    check("a requirement whose check passes but that nothing answers is partly addressed, not addressed", byId["STK-safe"].state === "partly-addressed", String(byId["STK-safe"].state));
    check("the counts add up, with every state named", all.json.counts.raised === 1 && all.json.counts["partly-addressed"] === 2 && Object.values(all.json.counts).reduce((a, b) => a + b, 0) === 4, JSON.stringify(all.json.counts));
    check("the requirement read the quality section the bundle embeds: its score after it was raised verifies it", byId["STK-safe"].cells[0].verified === true, JSON.stringify(byId["STK-safe"]));

    // --- refusals ---------------------------------------------------------------------------
    const missing = await s.call("stake_proof", { stake_id: "STK-nope" });
    check("an id that names nothing is refused", missing.isError && /No node/.test(missing.text), missing.text.slice(0, 200));
    const notStake = await s.call("stake_proof", { stake_id: "OPT-skip" });
    check("a node that is not a stake is refused", notStake.isError && /not a stake/.test(notStake.text), notStake.text.slice(0, 200));
    const badProduct = await s.call("stake_proof", { product: "ghost" });
    check("a product the project does not declare is refused, naming the ones it does", badProduct.isError && /site, app/.test(badProduct.text), badProduct.text.slice(0, 200));
    const badNow = await s.call("stake_proof", { now: "yesterday" });
    check("a clock that is not ISO 8601 is refused", badNow.isError && /now/.test(badNow.text), badNow.text.slice(0, 200));

    // --- it only reads --------------------------------------------------------------------------
    check("no call wrote the bundle or the journal", s.bundleText() === bundleBefore && s.journalText() === journalBefore);
  } finally {
    s.stop();
  }

  if (failures > 0) {
    console.log(`\n${failures} proof tool test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof tool tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

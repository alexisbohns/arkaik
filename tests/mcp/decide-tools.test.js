#!/usr/bin/env node

/**
 * The decision tool over stdio (docs/rfcs/stake-architecture.md § 14, part B) —
 * `decide_option` against a tmpdir repo. The hosted path (ops only) is covered in
 * remote-store.test.js.
 *
 * What this covers that tests/schema/decide.test.js cannot: that the tool writes
 * through the validator-gated persist, takes no author, refuses before writing,
 * reads the answer back off the graph, and, on the supersede path, journals the
 * old decision's status change.
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
const n = (id, species, title, status, extra = {}) => ({ id, project_id: "demo", species, title, status, platforms: [], ...extra });
const e = (source_id, target_id, edge_type) => ({ id: `e-${source_id}-${target_id}`, project_id: "demo", source_id, target_id, edge_type });
const NODES = [
  n("V-compose", "view", "Compose a pebble", "live", { platforms: ["web"] }),
  n("STK-slow", "stake", "Slow reveal", "discovery", { metadata: { stake_species: "friction" } }),
  n("OPT-skip", "option", "Skip the reveal", "discovery"),
  n("OPT-short", "option", "Shorten the reveal", "idea"),
  n("OPT-old", "option", "Drop the reveal", "archived"),
  n("STK-other", "stake", "Other", "idea", { metadata: { stake_species: "bug" } }),
  n("OPT-else", "option", "Elsewhere", "idea"),
];
const EDGES = [
  e("STK-slow", "V-compose", "concerns"),
  e("OPT-skip", "STK-slow", "addresses"),
  e("OPT-short", "STK-slow", "addresses"),
  e("OPT-old", "STK-slow", "addresses"),
  e("OPT-else", "STK-other", "addresses"),
  e("STK-other", "V-compose", "concerns"),
];
const BUNDLE = { schema_version: 3, project: { id: "demo", title: "Demo", created_at: ISO, updated_at: ISO }, nodes: NODES, edges: EDGES };
const line = (event) => JSON.stringify(event);
const JOURNAL = NODES.map((node, i) => line({ id: `01A${String(i).padStart(2, "0")}`, ts: ISO, type: "node.created", node_id: node.id, species: node.species, title: node.title })).join("\n");

function startSession() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-decide-"));
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
    bundle: () => JSON.parse(readFileSync(bundlePath, "utf8")),
    journalLines: () => readFileSync(journalPath, "utf8").split("\n").filter(Boolean).length,
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}


async function main() {
  const s = startSession();
  try {
    await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "decide-test", version: "0" } });
    const listed = await s.request("tools/list");
    const def = (listed.result?.tools ?? []).find((t) => t.name === "decide_option");
    check("the catalog lists decide_option", def !== undefined);
    check("it takes no author: the server stamps it", !("actor" in def.inputSchema.properties) && !("author" in def.inputSchema.properties));
    check("the stake, the option and the reason are required", JSON.stringify(def.inputSchema.required) === JSON.stringify(["stake_id", "option_id", "reason"]));

    // --- refusals write nothing ------------------------------------------------
    const lines = s.journalLines();
    const bundleBefore = JSON.stringify(s.bundle());
    const notAddressing = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-else", reason: "x" });
    check("an option that addresses another stake is refused", notAddressing.isError && /does not address/.test(notAddressing.text), notAddressing.text.slice(0, 300));
    const archived = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-old", reason: "x" });
    check("an archived option is refused", archived.isError && /archived/.test(archived.text), archived.text.slice(0, 300));
    const noReason = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-skip" });
    check("a missing reason is refused", noReason.isError && /reason/.test(noReason.text), noReason.text.slice(0, 300));
    const badStatus = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-skip", reason: "x", status: "proposed" });
    check("a status other than approved or enacted is refused", badStatus.isError && /approved or enacted/.test(badStatus.text), badStatus.text.slice(0, 300));
    const badDate = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-skip", reason: "x", decided_at: "last week" });
    check("an unparseable date is refused", badDate.isError && /decided_at/.test(badDate.text), badDate.text.slice(0, 300));
    const badClosed = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-skip", reason: "x", closed: "OPT-short" });
    check("a malformed closed list is refused", badClosed.isError && /closed/.test(badClosed.text), badClosed.text.slice(0, 300));
    check("no refusal wrote anything", s.journalLines() === lines && JSON.stringify(s.bundle()) === bundleBefore);

    // --- the decision ----------------------------------------------------------
    const first = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-skip", reason: "It removes the wait.", decided_at: "2026-11-22" });
    check("it decides", !first.isError && first.json.action === "decide" && first.json.decision_id === "DEC-select-skip-the-reveal-for-slow-reveal", first.text.slice(0, 300));
    const dec = first.json.decision;
    check("the decision is approved, with the reason as context and no platforms", dec.metadata.decision_status === "approved" && dec.metadata.context === "It removes the wait." && dec.platforms.length === 0 && dec.status === "backlog", JSON.stringify(dec));
    check("it closes the other live option with the default reason, and not the archived one", JSON.stringify(dec.metadata.closed_options) === JSON.stringify([{ option_id: "OPT-short", reason: 'Not selected: "Skip the reveal" was chosen.' }]), JSON.stringify(dec.metadata.closed_options));
    check("the defaulted reason is handed to a person", first.json.handToHuman.length === 1 && /OPT-short/.test(first.json.handToHuman[0]), JSON.stringify(first.json.handToHuman));
    const written = s.bundle();
    check("both edges are in the bundle", written.edges.some((x) => x.edge_type === "impacts" && x.source_id === dec.id && x.target_id === "STK-slow") && written.edges.some((x) => x.edge_type === "generates" && x.source_id === dec.id && x.target_id === "OPT-skip"));
    check("the journal recorded the node, with the server's actor", first.json.events.some((x) => x.type === "node.created" && x.node_id === dec.id && typeof x.actor === "string" && x.actor !== ""), JSON.stringify(first.json.events).slice(0, 300));
    check("the resulting bundle is valid", (await s.call("validate_bundle")).json.valid === true);

    // --- a second decision needs supersede ---------------------------------------
    const blocked = await s.call("decide_option", { stake_id: "STK-slow", option_id: "OPT-short", reason: "Cheaper." });
    check("a stake with a decision is refused without supersede", blocked.isError && /supersede/.test(blocked.text) && blocked.text.includes(dec.id), blocked.text.slice(0, 300));

    const second = await s.call("decide_option", {
      stake_id: "STK-slow",
      option_id: "OPT-short",
      reason: "Cheaper.",
      supersede: true,
      status: "enacted",
      closed: [{ option_id: "OPT-skip", reason: "Users missed the moment." }],
    });
    check("superseding decides", !second.isError && second.json.action === "decide", second.text.slice(0, 300));
    check("the old decision's status change is journaled", second.json.events.some((x) => x.type === "decision.status_changed" && x.node_id === dec.id && x.from === "approved" && x.to === "superseded"), JSON.stringify(second.json.events).slice(0, 400));
    const after = s.bundle();
    const old = after.nodes.find((x) => x.id === dec.id);
    check("the old decision is superseded and archived", old.metadata.decision_status === "superseded" && old.status === "archived");
    check("the new one is enacted and live, closing the old option with the given reason", second.json.decision.status === "live" && JSON.stringify(second.json.decision.metadata.closed_options) === JSON.stringify([{ option_id: "OPT-skip", reason: "Users missed the moment." }]), JSON.stringify(second.json.decision));
    check("a supersedes edge runs new to old", after.edges.some((x) => x.edge_type === "supersedes" && x.source_id === second.json.decision_id && x.target_id === dec.id));
    const verdict = await s.call("validate_bundle");
    check("the bundle is valid, with no warning from the decisions", verdict.json.valid === true && !(verdict.json.warnings ?? []).some((w) => /decision|stake-multiple/.test(w.rule)), JSON.stringify(verdict.json.warnings));
  } finally {
    s.stop();
  }

  if (failures > 0) {
    console.log(`\n${failures} decide tool test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll decide tool tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

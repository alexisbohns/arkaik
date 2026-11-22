#!/usr/bin/env node

/**
 * The qualification tools over stdio (docs/rfcs/stake-architecture.md part 3) —
 * `qualify_signal` (read) and `promote_signal` (write), against a tmpdir repo.
 * The hosted path (ops only) is covered in remote-store.test.js.
 *
 * What this covers that tests/schema/qualify.test.js cannot: that the tools
 * route through the same table, never write on a read, never merge unasked,
 * refuse a forbidden door before writing, and close the backlog item they
 * promote (the signal -> stake link is read back by get_backlog).
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
const NODES = [
  { id: "V-compose", project_id: "demo", species: "view", title: "Compose a pebble", status: "live", platforms: ["web"] },
  { id: "AC-x", project_id: "demo", species: "acceptance", title: "x", status: "idea", platforms: ["web"], metadata: { gherkin: "Given a\nWhen b\nThen c" } },
];
const BUNDLE = { schema_version: 3, project: { id: "demo", title: "Demo", created_at: ISO, updated_at: ISO }, nodes: NODES, edges: [] };
const line = (event) => JSON.stringify(event);
const JOURNAL = [
  ...NODES.map((n, i) => line({ id: `01A${i}`, ts: ISO, type: "node.created", node_id: n.id, species: n.species, title: n.title })),
  line({ id: "01SIGA", ts: "2026-02-01T00:00:00.000Z", type: "request.filed", title: "Lost my draft", source: "beta", source_kind: "feedback", verbatim: "I backgrounded the app and lost my draft" }),
  line({ id: "01SIGB", ts: "2026-02-02T00:00:00.000Z", type: "request.filed", title: "Draft vanished when I left the app", source_kind: "ticket" }),
  line({ id: "01SIGC", ts: "2026-02-03T00:00:00.000Z", type: "request.filed", title: "Consent is not asked", source_kind: "audit-finding", finding_id: "F-1", criterion_id: "PRV-01", node_id: "V-compose" }),
  line({ id: "01IDEA", ts: "2026-02-04T00:00:00.000Z", type: "idea.proposed", title: "Dark mode at night" }),
].join("\n");

function startSession() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-qualify-"));
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

const FEEL = { scope: "product", facing: "value", expectation: "absent" };

async function main() {
  const s = startSession();
  try {
    await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qualify-test", version: "0" } });
    const listed = await s.request("tools/list");
    const tools = listed.result?.tools ?? [];
    const qualifyDef = tools.find((t) => t.name === "qualify_signal");
    const promoteDef = tools.find((t) => t.name === "promote_signal");
    check("the catalog lists both tools", qualifyDef !== undefined && promoteDef !== undefined);
    check("the description carries the routing questions, from the table", /broken \| as-designed \| absent/.test(qualifyDef.description) && /reroute as need/.test(qualifyDef.description));
    check("the answer enums are the table's", JSON.stringify(qualifyDef.inputSchema.properties.expectation.enum) === JSON.stringify(["broken", "as-designed", "absent"]));
    check("promote takes no author: the server stamps it", !("actor" in promoteDef.inputSchema.properties) && !("author" in promoteDef.inputSchema.properties));

    // --- qualify_signal: read-only ------------------------------------------
    const before = s.journalLines();
    const asked = await s.call("qualify_signal", { signal_id: "01SIGA" });
    check("with no answers it asks, and names the questions", !asked.isError && asked.json.suggestion.action === "ask" && asked.json.routing.route === "incomplete" && asked.json.questions[0].id === "scope", asked.text.slice(0, 300));
    check("it reads the signal off the journal", asked.json.signal.event_id === "01SIGA" && asked.json.signal.source_kind === "feedback");
    const defaulted = await s.call("qualify_signal", { signal_id: "01SIGC", ...FEEL });
    check("a signal's node_id becomes the default anchor, and an audit criterion its catalog id", JSON.stringify(defaulted.json.anchors) === JSON.stringify(["V-compose"]) && defaulted.json.signal.source_kind === "audit-finding", defaulted.text.slice(0, 300));

    const routed = await s.call("qualify_signal", { signal_id: "01SIGA", ...FEEL });
    check("a routed signal returns the species and no candidate", routed.json.routing.species === "need" && routed.json.routing.provenance === "observed" && routed.json.candidates.length === 0 && routed.json.suggestion.action === "create", routed.text.slice(0, 300));

    const out = await s.call("qualify_signal", { signal_id: "01SIGA", scope: "internal" });
    check("internal is routed out and handed to a person", out.json.suggestion.action === "route-out" && out.json.routing.handToHuman.length > 0);

    const refusedDoor = await s.call("qualify_signal", { signal_id: "01SIGA", scope: "product", door: "imagine", facing: "value", expectation: "broken" });
    check("a bug through the imagine door is refused: reroute as need", refusedDoor.json.suggestion.action === "refused" && refusedDoor.json.routing.rerouteAs === "need");

    check("an unknown answer is an error", (await s.call("qualify_signal", { signal_id: "01SIGA", scope: "mars" })).isError);
    check("an unknown signal is an error", (await s.call("qualify_signal", { signal_id: "nope" })).isError);
    check("a signal needs an id or a title", (await s.call("qualify_signal", {})).isError);
    check("reads write nothing", s.journalLines() === before);

    // --- promote_signal: argument discipline ---------------------------------
    check("neither create nor merge_into is refused", (await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL })).isError);
    check("both create and merge_into is refused", (await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL, create: true, merge_into: "STK-x" })).isError);
    const incomplete = await s.call("promote_signal", { signal_id: "01SIGA", scope: "product", create: true });
    check("unanswered routing is refused and points at qualify_signal", incomplete.isError && /qualify_signal/.test(incomplete.text));
    const outBound = await s.call("promote_signal", { signal_id: "01SIGA", scope: "off-scope", create: true });
    check("a routed-out signal is not promoted", outBound.isError);
    const imagineBug = await s.call("promote_signal", { signal_id: "01SIGA", scope: "product", door: "imagine", facing: "value", expectation: "broken", create: true });
    check("a bug through the imagine door is refused before anything is written", imagineBug.isError && s.bundle().nodes.length === 2);
    check("a ghost anchor is refused", (await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL, create: true, anchors: ["V-ghost"] })).isError);
    check("an acceptance anchor is refused", (await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL, create: true, anchors: ["AC-x"] })).isError);
    check("nothing was written by the refusals", s.bundle().nodes.length === 2 && s.journalLines() === before);

    // --- promote_signal: create ----------------------------------------------
    const backlogBefore = await s.call("get_backlog");
    check("the signal is open in the backlog", backlogBefore.json.requests.some((i) => i.id === "01SIGA"), backlogBefore.text.slice(0, 200));
    const created = await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL, create: true, anchors: ["V-compose"], stake_title: "My draft is kept when I leave the app", voice: "person" });
    check("create lands a stake", !created.isError && created.json.action === "create" && created.json.stake_id === "STK-my-draft-is-kept-when-i-leave-the-app", created.text.slice(0, 400));
    const node = created.json.stake;
    check("at idea, with no platforms, species and evidence", node.status === "idea" && node.platforms.length === 0 && node.metadata.stake_species === "need" && node.metadata.evidence[0].event_id === "01SIGA" && node.metadata.evidence[0].voice === "person", JSON.stringify(node));
    check("the quote is the verbatim, untouched", node.metadata.evidence[0].quote === "I backgrounded the app and lost my draft");
    check("anchored by a concerns edge", JSON.stringify(created.json.anchors) === JSON.stringify(["V-compose"]) && s.bundle().edges.some((e) => e.edge_type === "concerns" && e.source_id === node.id && e.target_id === "V-compose"));
    check("persisted to the bundle, and the journal grew", s.bundle().nodes.some((n) => n.id === node.id) && s.journalLines() > before);
    check("the actor is the server's, not an argument", created.json.events.every((e) => e.actor === "arkaik-mcp"), JSON.stringify(created.json.events.map((e) => e.actor)));
    const backlogAfter = await s.call("get_backlog");
    check("the promoted signal closes in the backlog", !backlogAfter.json.requests.some((i) => i.id === "01SIGA") && backlogAfter.json.requests.some((i) => i.id === "01SIGB"), backlogAfter.text.slice(0, 300));
    check("the stake's timeline lists the signal", (await s.call("get_node", { node_id: node.id })).json.timeline?.some?.((e) => e.id === "01SIGA") === true);

    // --- idempotence ----------------------------------------------------------
    const again = await s.call("promote_signal", { signal_id: "01SIGA", ...FEEL, create: true });
    check("promoting the same signal again is a noop", !again.isError && again.json.action === "noop" && again.json.stake_id === node.id);
    const lines = s.journalLines();
    check("a noop writes nothing", s.bundle().nodes.length === 3 && s.journalLines() === lines);

    // --- one signal, two species: qualify agrees with promote ----------------------
    const crossQualify = await s.call("qualify_signal", { signal_id: "01SIGA", scope: "product", facing: "value", expectation: "as-designed" });
    check(
      "a signal a stake of another species already cites reads as already-qualified, and flags the species",
      crossQualify.json.suggestion.action === "already-qualified" && crossQualify.json.suggestion.stake_id === node.id && crossQualify.json.routing.handToHuman.some((h) => /friction/.test(h)),
      crossQualify.text.slice(0, 400),
    );
    const crossPromote = await s.call("promote_signal", { signal_id: "01SIGA", scope: "product", facing: "value", expectation: "as-designed", create: true });
    check("promote agrees: a noop that hands the species mismatch to a person", crossPromote.json.action === "noop" && crossPromote.json.handToHuman.some((h) => /friction/.test(h)), crossPromote.text.slice(0, 300));

    // --- merge: suggested, never automatic --------------------------------------
    const second = await s.call("qualify_signal", { signal_id: "01SIGB", ...FEEL, anchors: ["V-compose"] });
    check("the second signal finds the stake as a candidate", second.json.candidates[0]?.stake_id === node.id, second.text.slice(0, 400));
    check("it suggests a merge but has not merged", second.json.suggestion.action === "merge" && second.json.suggestion.merge_into === node.id && s.bundle().nodes.find((n) => n.id === node.id).metadata.evidence.length === 1);
    const cross = await s.call("promote_signal", { signal_id: "01SIGB", scope: "product", facing: "value", expectation: "as-designed", merge_into: node.id });
    check("a merge across species is refused", cross.isError && /species/.test(cross.text), cross.text.slice(0, 200));
    const merged = await s.call("promote_signal", { signal_id: "01SIGB", ...FEEL, merge_into: node.id });
    check("merge appends one evidence entry", !merged.isError && merged.json.action === "merge" && merged.json.stake.metadata.evidence.length === 2 && merged.json.stake.metadata.evidence[1].event_id === "01SIGB", merged.text.slice(0, 300));
    check("the merge is one node patch, not a new node", s.bundle().nodes.length === 3 && merged.json.ops.length === 1 && merged.json.ops[0].op === "update_node");
    check("merging twice is a noop", (await s.call("promote_signal", { signal_id: "01SIGB", ...FEEL, merge_into: node.id })).json.action === "noop");
    check("merging into a view is refused", (await s.call("promote_signal", { signal_id: "01IDEA", ...FEEL, merge_into: "V-compose" })).isError);

    // --- an audit finding: the criterion becomes the catalog link ---------------
    const audit = await s.call("promote_signal", { signal_id: "01SIGC", scope: "product", facing: "quality", threat: "obligation", create: true, stake_title: "Consent is asked before tracking" });
    check("an audit finding's criterion becomes the kritik link", audit.json.stake?.metadata?.catalog?.source === "kritik" && audit.json.stake.metadata.catalog.id === "PRV-01" && audit.json.stake.metadata.stake_species === "requirement", audit.text.slice(0, 400));
    const needLink = await s.call("promote_signal", { title: "Quick wins matter", ...FEEL, create: true, catalog_id: "saves-time" });
    check("a need takes a values link", needLink.json.stake?.metadata?.catalog?.source === "values");

    // --- the catalog id is checked, not just its family ---------------------------------
    const nodesBefore = s.bundle().nodes.length;
    check("a bogus value id is refused", (await s.call("promote_signal", { title: "zzz bogus", ...FEEL, create: true, catalog_id: "bogus" })).isError);
    check("a Kritik criterion id on a need is refused", (await s.call("promote_signal", { title: "zzz criterion", ...FEEL, create: true, catalog_id: "PRV-01" })).isError);
    check("neither refusal wrote anything", s.bundle().nodes.length === nodesBefore);

    // --- an idea defaults to the imagine door ----------------------------------------------
    const ideaBug = await s.call("qualify_signal", { signal_id: "01IDEA", scope: "product", facing: "value", expectation: "broken" });
    check("an idea.proposed signal defaults to imagine: a bug is refused", ideaBug.json.suggestion.action === "refused" && ideaBug.json.routing.provenance === "anticipated", ideaBug.text.slice(0, 300));
    const ideaNeed = await s.call("qualify_signal", { signal_id: "01IDEA", scope: "product", facing: "value", expectation: "absent" });
    check("an idea reads as an anticipated need, handed to a person with the default basis", ideaNeed.json.routing.species === "need" && ideaNeed.json.routing.provenance === "anticipated" && ideaNeed.json.routing.handToHuman.length >= 1, ideaNeed.text.slice(0, 300));
    const ideaCollect = await s.call("qualify_signal", { signal_id: "01IDEA", scope: "product", door: "collect", facing: "value", expectation: "absent" });
    check("an idea sent through collect on purpose is flagged for a person", ideaCollect.json.routing.provenance === "observed" && ideaCollect.json.routing.handToHuman.some((h) => /idea/.test(h)), ideaCollect.text.slice(0, 300));
    const inlineImagine = await s.call("qualify_signal", { title: "A night shift", scope: "product", door: "imagine", facing: "quality", threat: "mitigable-only" });
    check("an anticipated inline signal is handed to a person without any basis", inlineImagine.json.routing.handToHuman.some((h) => /imagine/.test(h)), inlineImagine.text.slice(0, 300));

    // --- an idea is a signal too; an anticipated need -------------------------------
    const idea = await s.call("promote_signal", { signal_id: "01IDEA", scope: "product", door: "imagine", facing: "value", expectation: "absent", create: true, stake_title: "I can rest my eyes at night", basis: "inferred" });
    check("an idea promotes through the imagine door as an anticipated need", idea.json.stake?.metadata?.provenance === "anticipated" && idea.json.stake.metadata.stake_species === "need", idea.text.slice(0, 300));
    check("an inferred answer and a missing anchor are handed to a person", idea.json.handToHuman.length >= 2, JSON.stringify(idea.json.handToHuman));

    // --- inline signal ----------------------------------------------------------------
    const inline = await s.call("promote_signal", { title: "Bus factor of one", ...{ scope: "product", facing: "quality", threat: "mitigable-only" }, create: true, anchors: ["V-compose"] });
    check("an inline signal promotes without an event id", inline.json.action === "create" && inline.json.stake.metadata.evidence[0].event_id === undefined && inline.json.stake.metadata.stake_species === "risk", inline.text.slice(0, 300));
    check("an inline signal with only a title stores its title as the quote, never an empty entry", JSON.stringify(inline.json.stake.metadata.evidence) === JSON.stringify([{ quote: "Bus factor of one" }]), JSON.stringify(inline.json.stake.metadata.evidence));

    const verdict = await s.call("validate_bundle");
    check("the resulting bundle is valid", verdict.json.valid === true, JSON.stringify(verdict.json.errors));
  } finally {
    s.stop();
  }

  if (failures > 0) {
    console.log(`\n${failures} qualify tool test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll qualify tool tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

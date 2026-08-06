#!/usr/bin/env node

/**
 * Regression test for #357 on the agent plane: a journal-less bundle must
 * ACCEPT MCP mutations. It used to refuse every one of them — persistMutation
 * folds the new events into `candidate.journal`, which makes the journal
 * non-empty and therefore cross-checked, so every pre-existing node came back
 * as `journal-missing-node-created` and the write was refused with nothing
 * written. The bundle was permanently un-mutable through the server.
 *
 * Same stdio JSON-RPC harness as run-mcp-tests.js, over a fixture written here
 * rather than copied from tests/mcp/fixtures: the whole point is a bundle with
 * NO journal sidecar at all.
 */

const { spawn } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
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
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BUNDLE = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [
    { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
    { id: "V-settings", project_id: "demo", species: "view", title: "Settings", status: "development", platforms: ["web"] },
  ],
  edges: [],
};

/** Spawn a server over a fresh tmpdir bundle that has NO journal sidecar. */
function startSession() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-baseline-"));
  const bundlePath = path.join(dir, "bundle.json");
  writeFileSync(bundlePath, `${JSON.stringify(BUNDLE, null, 2)}\n`);

  const child = spawn(process.execPath, [SERVER, "--bundle", bundlePath], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;

  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
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
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} (id ${id})`));
      }, 15000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const callTool = async (name, args = {}) => {
    const response = await request("tools/call", { name, arguments: args });
    if (response.error) return { rpcError: response.error };
    const text = response.result.content?.[0]?.text ?? "";
    return { isError: Boolean(response.result.isError), body: text ? JSON.parse(text) : undefined };
  };

  const close = () => {
    child.stdin.end();
    rmSync(dir, { recursive: true, force: true });
  };

  return { dir, bundlePath, journalPath: path.join(dir, "journal.jsonl"), request, notify, callTool, close };
}

const readEvents = (journalPath) =>
  existsSync(journalPath)
    ? readFileSync(journalPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l))
    : [];

async function main() {
  const session = startSession();
  const { bundlePath, journalPath, request, notify, callTool } = session;

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "harness", version: "0" },
  });
  notify("notifications/initialized");

  const before = await callTool("validate_bundle", {});
  check("the journal-less bundle starts valid", before.body?.valid === true, JSON.stringify(before.body));

  // --- journal-only mutation: the one that used to be refused outright -------
  const idea = await callTool("propose_idea", { title: "Dark mode" });
  check(
    "propose_idea is accepted on a journal-less bundle (#357)",
    idea.isError !== true,
    JSON.stringify(idea.body),
  );

  const events = readEvents(journalPath);
  check(
    "the sidecar leads with a journal.baseline naming both pre-existing nodes",
    events[0]?.type === "journal.baseline" &&
      JSON.stringify(events[0]?.node_ids) === JSON.stringify(["V-home", "V-settings"]),
    JSON.stringify(events),
  );
  check("the baseline carries the mcp actor", events[0]?.actor === "arkaik-mcp");
  check("the idea landed after it", events[1]?.type === "idea.proposed", JSON.stringify(events));
  check(
    "the returned events include the baseline",
    Array.isArray(idea.body?.events) && idea.body.events[0]?.type === "journal.baseline",
    JSON.stringify(idea.body?.events),
  );
  check(
    "a journal-only mutation still leaves the snapshot journal-less",
    JSON.parse(readFileSync(bundlePath, "utf8")).journal === undefined,
  );

  const afterIdea = await callTool("validate_bundle", {});
  check("the bundle validates clean after the first mutation", afterIdea.body?.valid === true, JSON.stringify(afterIdea.body));

  // --- snapshot mutation: no second baseline, coverage is already recorded ---
  const node = await callTool("create_node", { species: "view", title: "Profile", platforms: ["web"] });
  check("create_node is accepted next", node.isError !== true, JSON.stringify(node.body));
  check(
    "no second baseline is emitted",
    readEvents(journalPath).filter((e) => e.type === "journal.baseline").length === 1,
    JSON.stringify(readEvents(journalPath).map((e) => e.type)),
  );
  const afterCreate = await callTool("validate_bundle", {});
  check("the bundle validates clean after the snapshot write", afterCreate.body?.valid === true, JSON.stringify(afterCreate.body));

  // --- deleting a baselined node: its id must not read as never having existed ---
  const deleted = await callTool("delete_node", { node_id: "V-settings" });
  check("delete_node on a baselined node is accepted", deleted.isError !== true, JSON.stringify(deleted.body));
  const afterDelete = await callTool("validate_bundle", {});
  check(
    "the bundle validates clean after deleting a baselined node",
    afterDelete.body?.valid === true,
    JSON.stringify(afterDelete.body),
  );

  // --- the gate still refuses what it should ---------------------------------
  const journalBytes = readFileSync(journalPath, "utf8");
  const dangling = await callTool("add_edge", { source_id: "V-home", target_id: "V-ghost", edge_type: "calls" });
  check("a dangling edge is still refused", dangling.isError === true, JSON.stringify(dangling.body));
  check("the refused mutation wrote no baseline either", readFileSync(journalPath, "utf8") === journalBytes);

  session.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll MCP journal-baseline tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

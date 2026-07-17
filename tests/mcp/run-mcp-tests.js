#!/usr/bin/env node

/**
 * JSON-RPC harness for the arkaik-mcp server (docs/spec/mcp.md § Testing) —
 * the CLI harness pattern over stdio: spawn the built server against a
 * tmpdir copy of the fixture bundle + journal sidecar, speak MCP
 * (initialize, tools/list, tools/call), and assert read-tool shapes, the
 * write round-trip (journal appended, snapshot canonical, validator clean),
 * and the gate (a refused mutation leaves the files byte-identical).
 *
 * Run via `npm run test:mcp` (builds `arkaik` for dist/io.js, then
 * `arkaik-mcp`, then this).
 */

const { spawn } = require("child_process");
const { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");
const FIXTURES = path.join(__dirname, "fixtures");

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

/** Spawn a server over a fresh tmpdir fixture; returns an rpc client. */
function startSession() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-"));
  const bundlePath = path.join(dir, "bundle.json");
  copyFileSync(path.join(FIXTURES, "bundle.json"), bundlePath);
  copyFileSync(path.join(FIXTURES, "journal.jsonl"), path.join(dir, "journal.jsonl"));

  const child = spawn(process.execPath, [SERVER, "--bundle", bundlePath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
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

  return { dir, bundlePath, journalPath: path.join(dir, "journal.jsonl"), request, notify, callTool, close, child };
}

const journalLineCount = (journalPath) =>
  readFileSync(journalPath, "utf8").split("\n").filter(Boolean).length;

async function main() {
  const session = startSession();
  const { bundlePath, journalPath, request, notify, callTool } = session;

  // --- Handshake -------------------------------------------------------------
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "harness", version: "0" },
  });
  check(
    "initialize negotiates",
    init.result?.protocolVersion === "2025-06-18" && init.result?.serverInfo?.name === "arkaik-mcp",
    JSON.stringify(init).slice(0, 200),
  );
  notify("notifications/initialized");

  const listed = await request("tools/list");
  const toolNames = (listed.result?.tools ?? []).map((tool) => tool.name);
  check("tools/list exposes the 14-tool catalog", toolNames.length === 14, toolNames.join(", "));
  for (const name of ["list_nodes", "get_node", "create_node", "update_node", "add_edge", "validate_bundle", "get_map"]) {
    check(`catalog includes ${name}`, toolNames.includes(name));
  }
  const createDef = (listed.result?.tools ?? []).find((tool) => tool.name === "create_node");
  check(
    "tool schemas carry format enums",
    JSON.stringify(createDef?.inputSchema ?? {}).includes('"api-endpoint"'),
  );

  const unknown = await request("tools/call", { name: "no_such_tool", arguments: {} });
  check("unknown tool is a JSON-RPC error", unknown.error?.code === -32602, JSON.stringify(unknown.error));

  // --- Read tools -------------------------------------------------------------
  const listNodes = await callTool("list_nodes", { species: "view" });
  check(
    "list_nodes filters by species",
    listNodes.body?.total === 2 && listNodes.body.nodes.every((node) => node.species === "view"),
    JSON.stringify(listNodes.body).slice(0, 160),
  );

  const query = await callTool("list_nodes", { query: "profile" });
  check(
    "list_nodes query matches title/description",
    query.body?.total === 3,
    `expected V-profile + API-get-profile + DM-profile, got ${JSON.stringify(query.body?.nodes.map((n) => n.id))}`,
  );

  const getNode = await callTool("get_node", { node_id: "V-profile" });
  check(
    "get_node returns edges with neighbor titles",
    getNode.body?.edges.length === 3 &&
      getNode.body.edges.some((edge) => edge.other.title === "Get profile" && edge.direction === "out"),
    JSON.stringify(getNode.body?.edges),
  );
  check(
    "get_node where-used covers composes + playlist",
    getNode.body?.whereUsedFlows.length === 1 && getNode.body.whereUsedFlows[0].id === "F-onboard",
  );
  check(
    "get_node timeline comes from the journal",
    getNode.body?.timeline.length === 1 && getNode.body.timeline[0].type === "node.created",
  );
  const ghost = await callTool("get_node", { node_id: "V-ghost" });
  check("get_node unknown id is an isError result", ghost.isError === true && /V-ghost/.test(ghost.body.message));

  const changelog = await callTool("get_changelog", {});
  check(
    "get_changelog lists releases newest-first with counts",
    changelog.body?.releases.length === 1 &&
      changelog.body.releases[0].version === "0.1.0" &&
      changelog.body.releases[0].eventCount === 5,
    JSON.stringify(changelog.body),
  );
  const slice = await callTool("get_changelog", { version: "0.1.0" });
  check("get_changelog slices one version", slice.body?.toVersion === "0.1.0" && slice.body.events.length === 5);

  const backlog = await callTool("get_backlog", {});
  check(
    "get_backlog returns open items",
    backlog.body?.items.length === 1 && backlog.body.ideas[0].title === "Avatar upload",
  );

  const maps = await callTool("list_maps", {});
  check(
    "list_maps returns built-ins + stored definitions with counts",
    maps.body?.maps.length === 3 && maps.body.maps.some((entry) => entry.definition.id === "onboarding"),
    JSON.stringify(maps.body?.maps.map((entry) => [entry.definition.id, entry.nodeCount])),
  );
  const systemMap = await callTool("get_map", { map_id: "system" });
  check(
    "get_map computes the subgraph",
    systemMap.body?.nodes.length === 4 && systemMap.body.edges.length === 2,
    `system map: ${systemMap.body?.nodes.length} nodes / ${systemMap.body?.edges.length} edges (2 views + api + dm; both cross-layer edges)`,
  );

  const validation = await callTool("validate_bundle", {});
  check("validate_bundle reports the fixture clean", validation.body?.valid === true, JSON.stringify(validation.body));

  // --- Write round-trip -------------------------------------------------------
  const linesBefore = journalLineCount(journalPath);
  const updated = await callTool("update_node", { node_id: "V-profile", patch: { status: "live" } });
  check(
    "update_node emits node.status_changed with the mcp actor",
    updated.isError !== true &&
      updated.body.events.some((event) => event.type === "node.status_changed" && event.actor === "arkaik-mcp"),
    JSON.stringify(updated.body).slice(0, 240),
  );
  check("update appends to the journal sidecar", journalLineCount(journalPath) > linesBefore);
  const snapshotAfterUpdate = JSON.parse(readFileSync(bundlePath, "utf8"));
  check(
    "snapshot rewrite reflects the patch and stays sidecar-shaped",
    snapshotAfterUpdate.nodes.find((node) => node.id === "V-profile").status === "live" &&
      snapshotAfterUpdate.journal === undefined,
  );
  const revalidated = await callTool("validate_bundle", {});
  check("bundle validates clean after the write", revalidated.body?.valid === true, JSON.stringify(revalidated.body));

  const noop = await callTool("update_node", { node_id: "V-profile", patch: { status: "live" } });
  const linesAfterNoop = journalLineCount(journalPath);
  check(
    "no-op patch writes nothing",
    noop.body?.events.length === 0 && linesAfterNoop === linesBefore + 1,
    JSON.stringify(noop.body),
  );

  const created = await callTool("create_node", {
    species: "view",
    title: "Profile page",
    platforms: ["web"],
  });
  check(
    "create_node disambiguates the derived id",
    created.isError !== true && created.body.node.id === "V-profile-page",
    JSON.stringify(created.body?.node),
  );

  const edged = await callTool("add_edge", {
    source_id: "F-onboard",
    target_id: created.body.node.id,
    edge_type: "composes",
  });
  check("add_edge persists and emits edge.added", edged.isError !== true && edged.body.events[0].type === "edge.added");

  const removed = await callTool("remove_edge", { edge_id: edged.body.edge.id });
  check("remove_edge round-trips", removed.isError !== true && removed.body.events[0].type === "edge.removed");

  // Issue #264: a first-party api-endpoint may `calls` another api-endpoint
  // (a server action / BFF route fanning out to internal/external APIs). The
  // write-gate delegates to validateBundle, which now admits this pair.
  const fanoutApi = await callTool("create_node", {
    species: "api-endpoint",
    title: "Enrich preview",
    platforms: ["web"],
  });
  const fanoutEdge = await callTool("add_edge", {
    source_id: fanoutApi.body.node.id,
    target_id: "API-get-profile",
    edge_type: "calls",
  });
  check(
    "add_edge accepts api-endpoint -> api-endpoint calls (issue #264)",
    fanoutEdge.isError !== true && fanoutEdge.body.events[0].type === "edge.added",
    JSON.stringify(fanoutEdge.body).slice(0, 240),
  );
  // Clean up so the api fan-out node/edge leave no residue for later checks.
  await callTool("delete_node", { node_id: fanoutApi.body.node.id });

  const deleted = await callTool("delete_node", { node_id: created.body.node.id });
  check(
    "delete_node cascades and emits node.deleted only",
    deleted.isError !== true &&
      deleted.body.events.length === 1 &&
      deleted.body.events[0].type === "node.deleted",
    JSON.stringify(deleted.body),
  );

  const idea = await callTool("propose_idea", { title: "Dark mode" });
  const snapshotBytesAfterIdea = readFileSync(bundlePath, "utf8");
  check(
    "propose_idea is journal-only",
    idea.isError !== true &&
      idea.body.events[0].type === "idea.proposed" &&
      JSON.stringify(JSON.parse(snapshotBytesAfterIdea).nodes.map((n) => n.id)) ===
        JSON.stringify(snapshotAfterUpdate.nodes.map((n) => n.id)),
  );
  const backlogAfter = await callTool("get_backlog", {});
  check("the new idea shows in the backlog", backlogAfter.body?.items.some((item) => item.title === "Dark mode"));

  // --- Playlist composition: a populated flow in one call (issue #263) ---------
  const flowCreate = await callTool("create_node", {
    species: "flow",
    title: "Reader discovery",
    platforms: ["web"],
    metadata: {
      playlist: {
        entries: [
          { type: "view", view_id: "V-welcome" },
          { type: "view", view_id: "V-profile" },
        ],
      },
    },
  });
  check(
    "create_node builds a populated flow in a single call",
    flowCreate.isError !== true && flowCreate.body.node.id === "F-reader-discovery",
    JSON.stringify(flowCreate.body).slice(0, 240),
  );
  check(
    "create_node synthesizes a composes edge per playlist ref",
    Array.isArray(flowCreate.body?.edges) &&
      flowCreate.body.edges.length === 2 &&
      flowCreate.body.edges.every(
        (edge) => edge.edge_type === "composes" && edge.source_id === "F-reader-discovery",
      ),
    JSON.stringify(flowCreate.body?.edges),
  );
  check(
    "the synthesized edges emit edge.added alongside node.created",
    flowCreate.body?.events.filter((event) => event.type === "edge.added").length === 2 &&
      flowCreate.body.events.some((event) => event.type === "node.created"),
    JSON.stringify(flowCreate.body?.events?.map((event) => event.type)),
  );
  const afterFlowCreate = await callTool("validate_bundle", {});
  check(
    "bundle validates clean after the synthesized flow",
    afterFlowCreate.body?.valid === true,
    JSON.stringify(afterFlowCreate.body),
  );
  const snapshotAfterFlow = JSON.parse(readFileSync(bundlePath, "utf8"));
  check(
    "synthesized composes edges land in the snapshot",
    ["e-F-reader-discovery-V-welcome", "e-F-reader-discovery-V-profile"].every((id) =>
      snapshotAfterFlow.edges.some((edge) => edge.id === id),
    ),
  );

  // update_node extends the playlist; only the newly referenced ref's edge is synthesized.
  const flowExtend = await callTool("update_node", {
    node_id: "F-reader-discovery",
    patch: {
      metadata: {
        playlist: {
          entries: [
            { type: "view", view_id: "V-welcome" },
            { type: "view", view_id: "V-profile" },
            { type: "flow", flow_id: "F-onboard" },
          ],
        },
      },
    },
  });
  check(
    "update_node synthesizes the composes edge for a playlist addition only",
    flowExtend.isError !== true &&
      Array.isArray(flowExtend.body?.edges) &&
      flowExtend.body.edges.length === 1 &&
      flowExtend.body.edges[0].id === "e-F-reader-discovery-F-onboard",
    JSON.stringify(flowExtend.body?.edges),
  );
  const afterFlowExtend = await callTool("validate_bundle", {});
  check(
    "bundle validates clean after the playlist extension",
    afterFlowExtend.body?.valid === true,
    JSON.stringify(afterFlowExtend.body),
  );
  const flowNoop = await callTool("update_node", {
    node_id: "F-reader-discovery",
    patch: { status: "development" },
  });
  check(
    "a non-playlist patch synthesizes no edges",
    flowNoop.isError !== true && Array.isArray(flowNoop.body?.edges) && flowNoop.body.edges.length === 0,
    JSON.stringify(flowNoop.body?.edges),
  );

  // --- The gate ----------------------------------------------------------------
  const bundleBytes = readFileSync(bundlePath, "utf8");
  const journalBytes = readFileSync(journalPath, "utf8");
  const dangling = await callTool("add_edge", { source_id: "V-profile", target_id: "V-ghost", edge_type: "calls" });
  check(
    "dangling edge is refused with pathed findings",
    dangling.isError === true && dangling.body.findings.some((finding) => finding.rule === "dangling-edge"),
    JSON.stringify(dangling.body).slice(0, 240),
  );
  check(
    "refused mutation leaves both files byte-identical",
    readFileSync(bundlePath, "utf8") === bundleBytes && readFileSync(journalPath, "utf8") === journalBytes,
  );

  const badPatch = await callTool("update_node", { node_id: "V-profile", patch: { species: "flow" } });
  check("identity fields cannot be patched", badPatch.isError === true && /species/.test(badPatch.body.message));

  session.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll MCP server tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

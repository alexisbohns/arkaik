#!/usr/bin/env node

/**
 * Parity between the two MCP stores (packages/mcp/src/remote-store.ts).
 *
 * The claim slice 5 rests on is that the tool catalog is IDENTICAL in repo mode
 * and hosted mode — that a remote session is a different `Store`, not a
 * different server. These tests exercise the built server over stdio with a
 * stub HTTP server standing in for the hosted API, and assert:
 *
 *   - tools/list is byte-identical to repo mode (the catalog does not branch);
 *   - a read tool returns the same shape from the API as from a file;
 *   - a write goes to the ONE mutations endpoint, sending OPS rather than a
 *     mutated graph — so the server recomputes under its own lock and two
 *     agents cannot clobber each other;
 *   - a 422 from the server surfaces as the same refusal a local validator
 *     failure produces;
 *   - configuration resolution: a link file is picked up, --bundle still wins,
 *     and hosted mode without a token fails loudly rather than silently
 *     serving a stale local file.
 */

const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROJECT_ID = "prj_test123";

function makeBundle() {
  return {
    schema_version: 2,
    project: {
      id: "gp",
      title: "Hosted graph",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      { id: "V-home", project_id: "gp", species: "view", title: "Home", status: "idea", platforms: ["web"] },
      { id: "V-settings", project_id: "gp", species: "view", title: "Settings", status: "live", platforms: ["web"] },
    ],
    edges: [],
  };
}

/** A stub of the hosted API, recording every request it receives. */
function startStubServer(state) {
  const server = http.createServer((req, res) => {
    state.requests.push(`${req.method} ${req.url}`);

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${state.token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.url === `/api/graph/projects/${PROJECT_ID}` && req.method === "GET") {
      return json(200, { bundle: state.bundle, version: "1" });
    }
    if (req.url === `/api/graph/projects/${PROJECT_ID}/journal` && req.method === "GET") {
      return json(200, { journal: state.journal });
    }
    if (req.url === `/api/graph/projects/${PROJECT_ID}/mutations` && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        state.receivedOps.push(parsed.ops);
        if (state.refuseNext) {
          state.refuseNext = false;
          return json(422, {
            error: "invalid_bundle",
            errors: [{ path: "edges[0]", rule: "dangling-edge", message: "Edge target does not exist", severity: "error" }],
          });
        }
        // Mirror the server: apply nothing here, just acknowledge. The tools'
        // own result shape comes from their local applyOps.
        return json(200, {
          version: "2",
          nodes: state.bundle.nodes,
          edges: state.bundle.edges,
          events: [{ id: "01KN44ARM0JH4YFMX52BGKNPKZ", ts: "2026-01-01T00:00:00.000Z", actor: "arkaik-agent", type: "node.created", node_id: "V-new", species: "view", title: "New" }],
          warnings: [],
        });
      });
      return undefined;
    }
    return json(404, { error: "not_found" });
  });
  return server;
}

/** Speak JSON-RPC to the built server over stdio and collect the responses. */
function rpc(env, args, messages) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SERVER, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const responses = out
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      resolvePromise({ responses, stderr: err, code });
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const listTools = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const call = (id, name, args = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const resultText = (responses, id) => {
  const found = responses.find((r) => r.id === id);
  return found?.result?.content?.[0]?.text ? JSON.parse(found.result.content[0].text) : undefined;
};
const isError = (responses, id) => responses.find((r) => r.id === id)?.result?.isError === true;

async function main() {
  if (!fs.existsSync(SERVER)) {
    console.error(`Built server not found at ${SERVER}. Run: npm run build -w arkaik-mcp`);
    process.exit(1);
  }

  const state = {
    token: "ark_aabbccddeeff_secret_with_underscores",
    bundle: makeBundle(),
    journal: [],
    requests: [],
    receivedOps: [],
    refuseNext: false,
  };
  const server = startStubServer(state);
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arkaik-remote-"));

  try {
    const remoteEnv = { ARKAIK_URL: baseUrl, ARKAIK_TOKEN: state.token, ARKAIK_PROJECT: PROJECT_ID };

    // --- The catalog does not branch ---------------------------------------
    const remoteList = await rpc(remoteEnv, [], [initialize, listTools]);
    const remoteTools = remoteList.responses.find((r) => r.id === 2)?.result?.tools ?? [];

    // Repo mode, for comparison. A bundle on disk with no journal sidecar.
    const bundlePath = path.join(tmp, "bundle.json");
    fs.writeFileSync(bundlePath, JSON.stringify(makeBundle(), null, 2));
    const fileList = await rpc({}, ["--bundle", bundlePath], [initialize, listTools]);
    const fileTools = fileList.responses.find((r) => r.id === 2)?.result?.tools ?? [];

    check("hosted mode starts and lists tools", remoteTools.length > 0, remoteList.stderr);
    check(
      "the tool catalog is byte-identical in both modes",
      JSON.stringify(remoteTools) === JSON.stringify(fileTools),
      `${remoteTools.length} vs ${fileTools.length}`,
    );
    check("the banner names the hosted project", remoteList.stderr.includes(PROJECT_ID), remoteList.stderr.trim());

    // --- Reads come from the API -------------------------------------------
    state.requests.length = 0;
    const read = await rpc(remoteEnv, [], [initialize, call(3, "list_nodes", { species: "view" })]);
    const nodes = resultText(read.responses, 3);
    check("list_nodes returns the hosted graph", Array.isArray(nodes?.nodes) && nodes.nodes.length === 2, JSON.stringify(nodes));
    check(
      "the read went to the hosted API",
      state.requests.some((r) => r === `GET /api/graph/projects/${PROJECT_ID}`),
      state.requests.join(" | "),
    );

    const detail = await rpc(remoteEnv, [], [initialize, call(4, "get_node", { node_id: "V-home" })]);
    const node = resultText(detail.responses, 4);
    check("get_node resolves against the hosted graph", node?.node?.id === "V-home", JSON.stringify(node));

    // --- Writes send OPS, not a mutated graph ------------------------------
    state.receivedOps.length = 0;
    const write = await rpc(
      remoteEnv,
      [],
      [initialize, call(5, "create_node", { species: "view", title: "Brand New", platforms: ["web"] })],
    );
    const created = resultText(write.responses, 5);
    check("create_node succeeds against the hosted API", created?.node?.id === "V-brand-new", JSON.stringify(created));
    check("the write reached the mutations endpoint", state.receivedOps.length === 1, JSON.stringify(state.requests));
    check(
      "the payload is ops, not a mutated graph",
      state.receivedOps[0]?.[0]?.op === "create_node" && state.receivedOps[0][0].node?.id === "V-brand-new",
      JSON.stringify(state.receivedOps[0]),
    );
    check(
      "no whole-graph body was sent (the server recomputes under its own lock)",
      !JSON.stringify(state.receivedOps[0]).includes("V-settings"),
      JSON.stringify(state.receivedOps[0]).slice(0, 200),
    );

    // --- A server refusal reads like a local one ---------------------------
    state.refuseNext = true;
    const refused = await rpc(
      remoteEnv,
      [],
      [initialize, call(6, "create_node", { species: "view", title: "Doomed", platforms: ["web"] })],
    );
    check("a 422 from the server becomes a tool error", isError(refused.responses, 6));
    const refusalBody = resultText(refused.responses, 6);
    check(
      "the refusal carries the server's pathed findings",
      JSON.stringify(refusalBody).includes("dangling-edge"),
      JSON.stringify(refusalBody),
    );

    // --- Configuration resolution ------------------------------------------
    const linkDir = path.join(tmp, "linked");
    fs.mkdirSync(path.join(linkDir, "docs", "arkaik"), { recursive: true });
    fs.writeFileSync(
      path.join(linkDir, "docs", "arkaik", "arkaik.json"),
      JSON.stringify({ project_id: PROJECT_ID, remote: baseUrl }, null, 2),
    );

    const linked = await rpc(
      { ARKAIK_TOKEN: state.token },
      [],
      [initialize, listTools],
    );
    // cwd matters for the link file, so run it from the linked directory.
    const linkedFromDir = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [SERVER], {
        cwd: linkDir,
        env: { ...process.env, ARKAIK_TOKEN: state.token },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      child.on("close", () => resolvePromise(err));
      child.stdin.end();
    });
    check(
      "a link file alone selects hosted mode",
      linkedFromDir.includes(PROJECT_ID),
      linkedFromDir.trim(),
    );
    void linked;

    // --bundle must still win, so an explicit path is never overridden.
    const explicitBundle = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [SERVER, "--bundle", bundlePath], {
        cwd: linkDir,
        env: { ...process.env, ARKAIK_TOKEN: state.token },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      child.on("close", () => resolvePromise(err));
      child.stdin.end();
    });
    check(
      "--bundle overrides a link file",
      explicitBundle.includes("bundle:") && !explicitBundle.includes(PROJECT_ID),
      explicitBundle.trim(),
    );

    // Hosted mode with no token must fail loudly. Silently serving a stale
    // local file is the failure an agent cannot notice.
    const noToken = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [SERVER], {
        cwd: linkDir,
        env: { ...process.env, ARKAIK_TOKEN: "", ARKAIK_PROJECT: "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => resolvePromise({ err, code }));
      child.stdin.end();
    });
    check("a linked repo with no token exits non-zero", noToken.code === 1, String(noToken.code));
    check("and says which variable is missing", noToken.err.includes("ARKAIK_TOKEN"), noToken.err.trim());

    // --- A bad token surfaces as an actionable error -----------------------
    const badToken = await rpc(
      { ARKAIK_URL: baseUrl, ARKAIK_TOKEN: "ark_deadbeef_nope", ARKAIK_PROJECT: PROJECT_ID },
      [],
      [initialize, call(7, "list_nodes", {})],
    );
    check("an invalid token produces a tool error", isError(badToken.responses, 7));
    check(
      "the error points at the token, not at a parse failure",
      JSON.stringify(resultText(badToken.responses, 7)).includes("ARKAIK_TOKEN"),
      JSON.stringify(resultText(badToken.responses, 7)),
    );
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} remote-store check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll remote-store checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

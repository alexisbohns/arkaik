#!/usr/bin/env node

/**
 * Regenerates lib/landing/generated/*.json — the landing page's "agents"
 * chapter shows real tool output, not prose. Runs the built CLI over the
 * self-map and drives the built MCP server over stdio (the harness pattern of
 * tests/mcp/run-mcp-tests.js). Both packages are built first because their
 * dist/ is git-ignored and CI generates right after `npm ci`. Output is
 * deterministic (no timestamps, no absolute paths), so the CI drift gate
 * diffs it like every other generated artifact.
 */

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "lib", "landing", "generated");
const BUNDLE = path.join(ROOT, "seed", "arkaik-self-map.json");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const MCP = path.join(ROOT, "packages", "mcp", "dist", "index.js");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** The one call D2 shows. Fixed here so the sample cannot wander between runs. */
const MCP_CALL = { tool: "list_nodes", arguments: { species: "view", status: "live", query: "map", limit: 3 } };

function build() {
  execFileSync(NPM, ["run", "build", "-w", "arkaik", "-w", "arkaik-mcp"], { cwd: ROOT, stdio: "inherit" });
}

function cliValidate() {
  const output = execFileSync(process.execPath, [CLI, "validate", "seed/arkaik-self-map.json"], { cwd: ROOT, encoding: "utf8" });
  return { command: "arkaik validate seed/arkaik-self-map.json", output: output.trimEnd() };
}

function mcpCall() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP, "--bundle", BUNDLE], { stdio: ["pipe", "pipe", "inherit"] });
    const lines = readline.createInterface({ input: child.stdout });
    const pending = new Map();
    let nextId = 1;
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); waiter(message); }
    });
    const request = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Timed out waiting for ${method}`)); }, 15000);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

    (async () => {
      // Same handshake as tests/mcp/run-mcp-tests.js.
      await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "generate-landing-samples", version: "0" } });
      notify("notifications/initialized", {});
      const response = await request("tools/call", { name: MCP_CALL.tool, arguments: MCP_CALL.arguments });
      if (response.error) throw new Error(JSON.stringify(response.error));
      const text = response.result.content?.[0]?.text ?? "";
      resolve({ ...MCP_CALL, result: JSON.parse(text) });
    })().catch(reject).finally(() => child.stdin.end());
  });
}

async function main() {
  build();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cli = cliValidate();
  const mcp = await mcpCall();
  for (const [name, data] of [["cli-validate.json", cli], ["mcp-call.json", mcp]]) {
    fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`generated lib/landing/generated/${name}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

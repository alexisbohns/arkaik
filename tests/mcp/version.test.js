#!/usr/bin/env node

/**
 * The version the MCP server ANNOUNCES must equal the version it SHIPS AS.
 *
 * `arkaik-mcp@0.2.0` was published announcing itself as "0.1.0": the source held
 * a hardcoded `const VERSION` that nobody bumped alongside package.json. It fed
 * both the stderr banner and `serverInfo.version` — the field an MCP client
 * displays, and the obvious thing to read when asking "does this build have
 * hosted mode?". The honest answer was yes; the reported one said the
 * pre-hosted build. A wrong answer there is worse than none, because it sends
 * whoever is debugging to a confident wrong conclusion.
 *
 * build.js now substitutes the value from package.json, so drift needs someone
 * to reintroduce a literal. This test is what makes that impossible to do
 * quietly — it reads the SHIPPED artifact over the real protocol rather than
 * inspecting source, so it fails on exactly the thing consumers see.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");
const PKG = path.join(ROOT, "packages", "mcp", "package.json");
const BUNDLE = path.join(ROOT, "seed", "pebbles.json");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** One `initialize` round-trip against the built server, plus its stderr banner. */
function initialize() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, "--bundle", BUNDLE], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; stderr: ${err}`));
    }, 15000);

    child.stdout.on("data", (d) => {
      out += d.toString();
      const line = out.split("\n").find((l) => l.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      child.kill();
      try {
        resolve({ response: JSON.parse(line), stderr: err });
      } catch (e) {
        reject(e);
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      })}\n`,
    );
  });
}

async function main() {
  if (!fs.existsSync(SERVER)) {
    console.error(`Built server not found at ${SERVER}. Run: npm run build -w arkaik-mcp`);
    process.exitCode = 1;
    return;
  }

  const declared = JSON.parse(fs.readFileSync(PKG, "utf8")).version;
  check("precondition: package.json declares a version", typeof declared === "string" && declared.length > 0, declared);

  const { response, stderr } = await initialize();

  // Asserted before the version is read, so a failed handshake cannot make the
  // comparison below pass by matching undefined against undefined.
  check(
    "precondition: initialize succeeded and identifies the server",
    response?.result?.serverInfo?.name === "arkaik-mcp",
    JSON.stringify(response),
  );

  check(
    "serverInfo.version is the version this package ships as",
    response?.result?.serverInfo?.version === declared,
    `announced ${JSON.stringify(response?.result?.serverInfo?.version)} vs package.json ${JSON.stringify(declared)}`,
  );

  // The banner is the other place a human reads a version, and it was wrong for
  // the same reason — so it is worth its own assertion rather than trusting that
  // one substitution covers both call sites.
  check(
    "the stderr banner reports the same version",
    stderr.includes(`arkaik-mcp v${declared}`),
    JSON.stringify(stderr.trim()),
  );

  if (failures > 0) {
    console.error(`\n${failures} version check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll MCP version checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

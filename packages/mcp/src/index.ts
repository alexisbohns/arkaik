/**
 * `arkaik-mcp` — the agent plane (docs/spec/mcp.md). A stdio MCP server over
 * the repo bundle: the same `@arkaik/schema` projections humans see as pages,
 * plus validated dual-write mutations. Spawned per session by the agent host;
 * `npx -y arkaik-mcp` is the whole setup.
 */

import { startServer } from "./protocol";
import { buildCatalog } from "./tools";
import { resolveBundlePath } from "./store";

const VERSION = "0.1.0";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "arkaik-mcp — MCP server over an Arkaik repo bundle (stdio transport)",
      "",
      "Usage: arkaik-mcp [--bundle <path>]",
      "",
      "Bundle resolution: --bundle, then $ARKAIK_BUNDLE, then docs/arkaik/bundle.json.",
      "The journal is the sibling journal.jsonl sidecar (embedded journal[] wins).",
      "Docs: docs/spec/mcp.md",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const bundlePath = resolveBundlePath(argv, process.env);
const { tools, handlers } = buildCatalog({ bundlePath });

// stderr only — stdout belongs to the protocol.
process.stderr.write(`arkaik-mcp v${VERSION} — bundle: ${bundlePath}\n`);

startServer({
  serverInfo: { name: "arkaik-mcp", version: VERSION },
  tools,
  handlers,
}).then(() => process.exit(0));

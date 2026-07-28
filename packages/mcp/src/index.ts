/**
 * `arkaik-mcp` — the agent plane (docs/spec/mcp.md). A stdio MCP server over a
 * repo bundle or a hosted project: the same `@arkaik/schema` projections humans
 * see as pages, plus validated dual-write mutations. Spawned per session by the
 * agent host; `npx -y arkaik-mcp` is the whole setup.
 */

import { startServer } from "./protocol";
import { buildCatalog } from "./tools";
import { createFileStore, resolveBundlePath, type Store } from "./store";
import { createRemoteStore } from "./remote-store";
import { resolveRemoteConfig } from "./config";

/**
 * Substituted from package.json by build.js. NOT a literal, and never to be
 * turned back into one: it was a literal once, and 0.2.0 shipped announcing
 * itself as "0.1.0" — the pre-hosted build — through both the banner and
 * `serverInfo.version`. That field is what an MCP client displays and the
 * obvious thing to read when asking "does this build have hosted mode?", so a
 * stale value does not merely fail to help, it argues for the wrong conclusion.
 * `tests/mcp/version.test.js` fails if the two ever disagree again.
 */
declare const __ARKAIK_MCP_VERSION__: string;
const VERSION = __ARKAIK_MCP_VERSION__;

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "arkaik-mcp — MCP server over an Arkaik product graph (stdio transport)",
      "",
      "Usage: arkaik-mcp [--bundle <path>] [--remote] [--project <id>]",
      "",
      "Repo mode (default):",
      "  Bundle resolution: --bundle, then $ARKAIK_BUNDLE, then docs/arkaik/bundle.json.",
      "  The journal is the sibling journal.jsonl sidecar (embedded journal[] wins).",
      "",
      "Hosted mode (--remote, or a docs/arkaik/arkaik.json written by `arkaik link`):",
      "  Project:  --project, then $ARKAIK_PROJECT, then arkaik.json",
      "  Token:    $ARKAIK_TOKEN (create one at <origin>/settings/tokens)",
      "  Origin:   $ARKAIK_URL, then arkaik.json, then https://arkaik.app",
      "",
      "The tool catalog is identical in both modes.",
      "Docs: docs/spec/mcp.md",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

/**
 * Repo bundle or hosted project — the ONLY thing that differs between the two
 * modes. The catalog built below is the same either way.
 */
function resolveStore(): Store {
  const remote = resolveRemoteConfig(argv, process.env, process.cwd());
  if (remote.mode === "remote") {
    return createRemoteStore({
      baseUrl: remote.baseUrl,
      projectId: remote.projectId,
      token: remote.token,
    });
  }
  return createFileStore(resolveBundlePath(argv, process.env));
}

let store: Store;
try {
  store = resolveStore();
} catch (error) {
  process.stderr.write(`arkaik-mcp: ${(error as Error).message}\n`);
  process.exit(1);
}

const { tools, handlers } = buildCatalog({ store });

// stderr only — stdout belongs to the protocol.
process.stderr.write(`arkaik-mcp v${VERSION} — ${store.describe()}\n`);

startServer({
  serverInfo: { name: "arkaik-mcp", version: VERSION },
  tools,
  handlers,
}).then(() => process.exit(0));

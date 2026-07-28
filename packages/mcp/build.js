/**
 * Build the `arkaik-mcp` server to dist/index.js — the CLI's build strategy
 * verbatim (packages/cli/build.js): the source imports `@arkaik/schema` (raw
 * TS) and `arkaik/io` (the CLI's file-IO seam, docs/spec/mcp.md § Reuse
 * Seams), so esbuild bundles everything into a single zero-dependency Node
 * ESM script. `npx -y arkaik-mcp` is the whole setup.
 *
 * The `arkaik/io` import resolves through packages/cli's exports map to its
 * raw-TS source at bundle time (esbuild reads the `types` condition last, so
 * we alias it explicitly to the source — the built dist/io.js is for runtime
 * consumers outside this repo's build).
 *
 * THE VERSION IS SUBSTITUTED FROM package.json, never written in the source.
 * It was hardcoded once, and 0.2.0 shipped reporting itself as "0.1.0" in both
 * the stderr banner and `serverInfo.version` — the field an MCP client shows and
 * the obvious thing to read when asking "does this build have hosted mode?".
 * A stale answer there sends whoever is debugging to precisely the wrong
 * conclusion, which is worse than no answer. Substituting at build time makes
 * the two unable to disagree.
 */
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(dir, "src", "index.ts");
const OUT_FILE = join(dir, "dist", "index.js");
const CLI_IO_SRC = join(dir, "..", "cli", "src", "io.ts");
const { version: VERSION } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

async function run() {
  await build({
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    legalComments: "none",
    banner: { js: "#!/usr/bin/env node" },
    alias: { "arkaik/io": CLI_IO_SRC },
    define: { __ARKAIK_MCP_VERSION__: JSON.stringify(VERSION) },
  });
  chmodSync(OUT_FILE, 0o755);
  console.log(`built ${relative(dir, OUT_FILE)}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

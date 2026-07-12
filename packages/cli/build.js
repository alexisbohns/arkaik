/**
 * Build the `arkaik` CLI to dist/index.js.
 *
 * Build/run strategy (issue #219, docs/spec/toolchain.md § toolchain): the CLI
 * source imports validateBundle / parseJournalLines / serializeBundle straight
 * from `@arkaik/schema` (which ships raw TS), so we esbuild-bundle the entry
 * into a single zero-dependency Node ESM script — mirroring
 * scripts/generate/build-validator.js, which bundles the schema package's
 * validate-bundle CLI the same way. Both the standalone validator and this CLI
 * are therefore builds of the *same* canonical schema source: no re-implemented
 * validation/serialization logic, and "neither drifts" (toolchain.md:45) holds.
 *
 * dist/ is gitignored and rebuilt on demand (`npm run build -w arkaik`, run by
 * the root `test:cli` script and CI before the CLI tests spawn the binary).
 */
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(dir, "src", "index.ts");
const OUT_FILE = join(dir, "dist", "index.js");

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
  });
  chmodSync(OUT_FILE, 0o755);
  console.log(`built ${relative(dir, OUT_FILE)}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

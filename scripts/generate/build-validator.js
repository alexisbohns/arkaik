#!/usr/bin/env node

/**
 * Builds docs/arkaik-skill/scripts/validate-bundle.js as an esbuild-bundled,
 * zero-dependency artifact of @arkaik/schema's validateBundle() (the CLI
 * wrapper lives at packages/schema/src/cli/validate-bundle-cli.ts). Replaces
 * the hand-written standalone validator (docs/spec/toolchain.md § @arkaik/schema)
 * while keeping the same `node validate-bundle.js <path>` CLI contract, exit
 * codes, and human-readable report.
 */

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..", "..");
const ENTRY = path.join(ROOT, "packages", "schema", "src", "cli", "validate-bundle-cli.ts");
const OUT_FILE = path.join(ROOT, "docs", "arkaik-skill", "scripts", "validate-bundle.js");

const BANNER = `#!/usr/bin/env node
/**
 * Arkaik ProjectBundle Validator — GENERATED, DO NOT EDIT BY HAND.
 * Built via \`npm run generate\` from packages/schema/src (the canonical zod
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 *
 * Validates a bundle.json file against the Arkaik schema rules.
 * Exit code 0 = valid, 1 = errors found.
 *
 * Usage: node validate-bundle.js <path-to-bundle.json>
 */`;

async function generate() {
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    legalComments: "none",
    banner: { js: BANNER },
  });
  fs.chmodSync(OUT_FILE, 0o755);
  console.log(`generated ${path.relative(ROOT, OUT_FILE)}`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});

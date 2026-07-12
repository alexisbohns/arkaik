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
 * `arkaik init` (issue #220) installs the agent skill as a render of
 * `docs/arkaik-skill/skill.md` plus its two generated siblings
 * (`references/schema.md`, `scripts/validate-bundle.js`). Rather than commit a
 * second copy of those assets under packages/cli, we copy them into
 * dist/assets/skill/ here at build time — docs/arkaik-skill/ stays the single
 * source of truth, the published CLI carries the assets it needs, and there is
 * no drift check to maintain because nothing new is committed.
 *
 * dist/ is gitignored and rebuilt on demand (`npm run build -w arkaik`, run by
 * the root `test:cli` script and CI before the CLI tests spawn the binary).
 */
import { build } from "esbuild";
import { chmodSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(dir, "src", "index.ts");
const OUT_FILE = join(dir, "dist", "index.js");

const SKILL_SRC_DIR = join(dir, "..", "..", "docs", "arkaik-skill");
const SKILL_DIST_DIR = join(dir, "dist", "assets", "skill");

function copySkillAssets() {
  mkdirSync(join(SKILL_DIST_DIR, "references"), { recursive: true });
  mkdirSync(join(SKILL_DIST_DIR, "scripts"), { recursive: true });
  cpSync(join(SKILL_SRC_DIR, "skill.md"), join(SKILL_DIST_DIR, "skill.md"));
  cpSync(join(SKILL_SRC_DIR, "references", "schema.md"), join(SKILL_DIST_DIR, "references", "schema.md"));
  cpSync(join(SKILL_SRC_DIR, "scripts", "validate-bundle.js"), join(SKILL_DIST_DIR, "scripts", "validate-bundle.js"));
  console.log(`copied skill assets -> ${relative(dir, SKILL_DIST_DIR)}`);
}

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
  copySkillAssets();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

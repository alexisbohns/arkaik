#!/usr/bin/env node

/**
 * Builds the three standalone Kritik scripts under plugin-kritik/scripts/ as
 * esbuild-bundled, zero-dependency artifacts of @arkaik/schema — the same
 * pipeline and the same reason as build-validator.js: an agent auditing a repo
 * that has no node_modules must still be able to run the roll-up and the
 * scaffolder with nothing but Node.
 *
 * They stay small (a few kB each) because everything they import from the
 * schema package is the zod-free half — quality.ts has no runtime dependencies
 * at all, so esbuild has nothing to drag in behind it.
 *
 * CJS output rather than ESM: the plugin drops these into arbitrary repos, and
 * a `.js` file in a package whose own package.json says `"type": "module"`
 * would fail to load as CJS. `.js` + CJS is the shape that runs everywhere.
 */

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..", "..");
const CLI_DIR = path.join(ROOT, "packages", "schema", "src", "cli");
// Skill-relative, not plugin-root: an installed skill's supporting files sit
// beside its SKILL.md (Plugins reference § Skills), which is what makes
// `<skill-path>/scripts/…` resolvable from a user's repo — the same layout the
// arkaik plugin uses for validate-bundle.js.
const OUT_DIR = path.join(ROOT, "plugin-kritik", "skills", "kritik", "scripts");

const SCRIPTS = [
  {
    entry: "kritik-matrix-cli.ts",
    out: "compute-matrix.js",
    summary: "Kritik roll-up — compute one audit's comparative matrix.",
  },
  {
    entry: "kritik-criterion-cli.ts",
    out: "scaffold-criterion.js",
    summary: "Kritik custom-criterion scaffolder + issue-skeleton emitter.",
  },
  {
    entry: "kritik-profile-cli.ts",
    out: "init-profile.js",
    summary: "Kritik install-time surface picker — writes docs/quality/profile.json.",
  },
];

const banner = (summary) => `#!/usr/bin/env node
/**
 * ${summary}
 * GENERATED, DO NOT EDIT BY HAND.
 *
 * Built via \`npm run generate\` from packages/schema/src/cli (the canonical
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 */`;

async function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const script of SCRIPTS) {
    const outfile = path.join(OUT_DIR, script.out);
    await esbuild.build({
      entryPoints: [path.join(CLI_DIR, script.entry)],
      outfile,
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      legalComments: "none",
      minify: true,
      banner: { js: banner(script.summary) },
    });
    fs.chmodSync(outfile, 0o755);
    console.log(`generated ${path.relative(ROOT, outfile)}`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});

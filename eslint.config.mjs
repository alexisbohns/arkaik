import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone CommonJS Node scripts (not part of the Next.js app).
    "docs/arkaik-skill/scripts/**",
    "tests/**",
    "scripts/**",
    // The Arkademy's library content and its working scripts: gitignored, never
    // part of the app (docs/arkademy.md).
    "arkademy-content/**",
    // Parked libraries waiting for a new home (kits/<name>/README.md): never
    // part of the app, and their app-relative imports are not resolved here.
    "kits/**",
    // Standalone Node migration runner (db/migrate.mjs) + plain-SQL migrations.
    "db/**",
    // Claude Code plugin: a byte-identical generated copy of
    // docs/arkaik-skill/scripts/** (see scripts/generate/generate-plugin.js).
    "plugin/**",
    // The Kritik plugin channel, same reason: everything under it is generated
    // (esbuild-minified scripts + copied skill/pack assets), never app source.
    "plugin-kritik/**",
    // esbuild-bundled CLI/MCP output + their Node build scripts (not app source).
    "packages/cli/dist/**",
    "packages/cli/build.js",
    "packages/mcp/dist/**",
    "packages/mcp/build.js",
    // Transient transpile dirs of the test loaders / artifact generator —
    // cleaned up on success, but a crashed run must not break lint.
    "packages/schema/.test-build/**",
    "packages/schema/.generate-build/**",
    // Same technique as packages/schema/.test-build/** above, for every CLI
    // suite that esbuild-bundles a command (.test-build, -live, -shot, …) and
    // for the bootstrap-lib direct-require tests (tests/cli/load-bootstrap-lib.js),
    // which never clean up between runs: whatever lingers on disk must stay
    // ignored rather than break a later `npm run lint`.
    "packages/cli/.test-build*/**",
  ]),
]);

export default eslintConfig;

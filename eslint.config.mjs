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
    // Standalone Node migration runner (db/migrate.mjs) + plain-SQL migrations.
    "db/**",
    // Claude Code plugin: a byte-identical generated copy of
    // docs/arkaik-skill/scripts/** (see scripts/generate/generate-plugin.js).
    "plugin/**",
    // esbuild-bundled CLI/MCP output + their Node build scripts (not app source).
    "packages/cli/dist/**",
    "packages/cli/build.js",
    "packages/mcp/dist/**",
    "packages/mcp/build.js",
    // Transient transpile dirs of the test loaders / artifact generator —
    // cleaned up on success, but a crashed run must not break lint.
    "packages/schema/.test-build/**",
    "packages/schema/.generate-build/**",
    // Same technique as packages/schema/.test-build/** above, for the
    // bootstrap-lib direct-require tests (tests/cli/load-bootstrap-lib.js):
    // never explicitly cleaned up between runs, so it lingers on disk and
    // must stay ignored rather than break a later `npm run lint`.
    "packages/cli/.test-build-bootstrap/**",
  ]),
]);

export default eslintConfig;

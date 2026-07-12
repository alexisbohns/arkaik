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
    // esbuild-bundled CLI output + its Node build script (not app source).
    "packages/cli/dist/**",
    "packages/cli/build.js",
  ]),
]);

export default eslintConfig;

/**
 * Loads packages/mcp/src/remote-store.ts into a plain Node process — the
 * tests/schema/load-schema.js idiom, applied to a single file rather than a
 * whole package.
 *
 * remote-store.ts's only runtime import is `@arkaik/schema` (`./store` is
 * type-only and erases under transpilation), so this compiles both to
 * CommonJS and rewrites the schema import to point at the compiled package.
 *
 * Task 6 exercises `appendQualityEvents` directly through this loader rather
 * than over stdio: the built server's kritik tools don't call it yet (that's
 * Tasks 7-8), so there is no tool path through which to reach it end-to-end.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-remote-store");

function loadRemoteStore() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  const source = fs.readFileSync(path.join(ROOT, "packages", "mcp", "src", "remote-store.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "remote-store.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const rewritten = outputText.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
  const outFile = path.join(BUILD_DIR, "remote-store.js");
  fs.writeFileSync(outFile, rewritten);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadRemoteStore };

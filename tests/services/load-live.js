/**
 * Loads lib/services/graph/live.ts into a plain Node process — the
 * tests/services/load-quality-events.js idiom.
 *
 * The planner has NO db/auth imports and no `server-only`: its only runtime
 * dependency is `@arkaik/schema`, so one rewrite is all it takes.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-live");

function loadLive() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const source = fs.readFileSync(path.join(ROOT, "lib", "services", "graph", "live.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "live.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );
  const outFile = path.join(BUILD_DIR, "live.js");
  fs.writeFileSync(outFile, rewritten);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadLive, BUILD_DIR };

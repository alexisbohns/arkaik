/**
 * Loads lib/data/emit-events.ts (the pure app-side event derivation, issue
 * #218) into a running Node process without a bundler — the same
 * transpile-on-the-fly approach as load-journal-projections.js.
 *
 * emit-events.ts's only runtime import is `makeEvent` from @arkaik/schema (its
 * `import type` lines erase); we build the schema package with load-schema.js
 * and rewrite that bare specifier to the built CJS index so the require
 * resolves. Deliberately IndexedDB-free, so it needs no fake-indexeddb.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "lib", "data", "emit-events.ts");
const BUILD_DIR = path.join(__dirname, ".test-build-emit-events");

function loadEmitEvents() {
  // Build the schema package so `require(...schema index)` resolves at runtime.
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "emit-events.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  // Point the bare @arkaik/schema require at the built CJS index (absolute,
  // JSON-encoded so it survives on any OS).
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );

  const outFile = path.join(BUILD_DIR, "emit-events.js");
  fs.writeFileSync(outFile, rewritten);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadEmitEvents, BUILD_DIR, SCHEMA_BUILD_DIR };

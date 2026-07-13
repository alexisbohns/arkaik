/**
 * Loads lib/sync/sync-manager.ts into a running Node process without a
 * bundler — the same transpile-on-the-fly approach as the other tests/*
 * loaders (see tests/services/load-synk-api.js, tests/data/load-local-provider.js).
 *
 * sync-manager.ts's non-type runtime imports are:
 *  - `@arkaik/schema`               (serializeBundle)      → the real built package
 *  - `@/lib/data/provider-registry` (getProvider)           → a tiny stub
 *  - `@/lib/data/local-provider`    (subscribeToMutations)  → a tiny stub
 *
 * The provider-registry/local-provider stubs only need to exist so the
 * transpiled module's `require()` calls resolve — `createSyncManager()`'s
 * `overrides` parameter lets every test replace `subscribeToMutations`,
 * `exportProject`, `fetchImpl`, etc. directly, so the module's *default*
 * wiring (built from these stubs) is constructed but never actually invoked
 * by any test in tests/sync/sync-manager.test.js. The real @arkaik/schema
 * package IS loaded for real, so `serializeBundle` behaves exactly as it
 * does in the browser when a test exercises the default hash/serialize path.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-sync-manager");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName, rewrites) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  let { outputText } = ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS });
  for (const [specifier, replacement] of rewrites) {
    const pattern = new RegExp(
      `require\\((['"])${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\1\\)`,
      "g",
    );
    outputText = outputText.replace(pattern, `require(${JSON.stringify(replacement)})`);
  }
  return outputText;
}

function loadSyncManager() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  // Never functionally exercised — every test overrides subscribeToMutations
  // / exportProject directly via createSyncManager()'s deps parameter.
  write(
    "provider-registry-stub.js",
    "module.exports = { getProvider: () => { throw new Error(\"getProvider() stub should never be called — override exportProject in the test.\"); } };\n",
  );
  write(
    "local-provider-stub.js",
    "module.exports = { subscribeToMutations: () => { throw new Error(\"subscribeToMutations stub should never be called — override it in the test.\"); } };\n",
  );

  write(
    "sync-manager.js",
    transpile(path.join(ROOT, "lib", "sync", "sync-manager.ts"), "sync-manager.ts", [
      ["@arkaik/schema", schemaIndex],
      ["@/lib/data/provider-registry", path.join(BUILD_DIR, "provider-registry-stub.js")],
      ["@/lib/data/local-provider", path.join(BUILD_DIR, "local-provider-stub.js")],
    ]),
  );

  const names = ["provider-registry-stub.js", "local-provider-stub.js", "sync-manager.js"];
  for (const name of names) delete require.cache[path.join(BUILD_DIR, name)];

  return require(path.join(BUILD_DIR, "sync-manager.js"));
}

module.exports = { loadSyncManager, BUILD_DIR, SCHEMA_BUILD_DIR };

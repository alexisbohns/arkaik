/**
 * Loads lib/data/seed-provider.ts into Node without a bundler. Its relative
 * runtime imports (./emit-events, ./migrate) are transpiled beside it; its
 * `@arkaik/schema` import is answered with the REAL package via load-schema, so
 * applyOps / journal derivation behave exactly as in the app.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-seed-provider");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpileTo(srcFile, fileName, outFile) {
  const source = fs.readFileSync(srcFile, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS });
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return outFile;
}

function loadSeedProvider() {
  const schemaExports = loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const lib = (name) => path.join(ROOT, "lib", "data", name);
  transpileTo(lib("emit-events.ts"), "emit-events.ts", path.join(BUILD_DIR, "emit-events.js"));
  transpileTo(lib("migrate.ts"), "migrate.ts", path.join(BUILD_DIR, "migrate.js"));
  const outFile = transpileTo(lib("seed-provider.ts"), "seed-provider.ts", path.join(BUILD_DIR, "seed-provider.js"));

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@arkaik/schema") return schemaExports;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[outFile];
    return require(outFile);
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { loadSeedProvider, BUILD_DIR, SCHEMA_BUILD_DIR };

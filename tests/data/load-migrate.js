/**
 * Loads lib/data/migrate.ts into a running Node process without a bundler, the
 * same transpile-on-the-fly approach tests/schema/load-schema.js uses for the
 * @arkaik/schema package.
 *
 * migrate.ts imports the deterministic id generator from `@arkaik/schema` at
 * runtime (issue #215). That module (packages/schema/src/id-gen.ts) is zod-free
 * and imports only a *type*, so its transpiled CommonJS output is self-contained
 * — we transpile it alongside migrate.ts and intercept the bare
 * `require("@arkaik/schema")` to hand it back, exactly like
 * tests/data/import-roundtrip.test.js does for export.ts.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "lib", "data", "migrate.ts");
const ID_GEN_FILE = path.join(ROOT, "packages", "schema", "src", "id-gen.ts");
const BUILD_DIR = path.join(__dirname, ".test-build");

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

function loadMigrate() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const idGenFile = transpileTo(ID_GEN_FILE, "id-gen.ts", path.join(BUILD_DIR, "id-gen.js"));
  const idGen = require(idGenFile);

  const outFile = transpileTo(SRC_FILE, "migrate.ts", path.join(BUILD_DIR, "migrate.js"));

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@arkaik/schema") return idGen;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[outFile];
    return require(outFile);
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { loadMigrate, BUILD_DIR };

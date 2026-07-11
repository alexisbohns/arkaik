/**
 * Loads lib/data/migrate.ts into a running Node process without a bundler, the
 * same transpile-on-the-fly approach tests/schema/load-schema.js uses for the
 * @arkaik/schema package. migrate.ts imports only *types* from ./types, so the
 * transpiled CommonJS output has no runtime `require`s to resolve — a single
 * file is enough.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "lib", "data", "migrate.ts");
const BUILD_DIR = path.join(__dirname, ".test-build");

function loadMigrate() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "migrate.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outFile = path.join(BUILD_DIR, "migrate.js");
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadMigrate, BUILD_DIR };

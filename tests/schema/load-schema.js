/**
 * Loads the TypeScript @arkaik/schema package into a running Node process
 * without a bundler. Each source file is transpiled to CommonJS with the
 * TypeScript compiler (a devDependency) and written into a build dir *inside*
 * packages/schema so that `require("zod")` resolves against the workspace's
 * node_modules. Returns the package's public exports.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SCHEMA_DIR = path.join(__dirname, "..", "..", "packages", "schema");
const SRC_DIR = path.join(SCHEMA_DIR, "src");
const BUILD_DIR = path.join(SCHEMA_DIR, ".test-build");

// Order does not matter for output — CommonJS resolves requires lazily — but we
// transpile every module the entrypoint depends on.
const MODULES = ["ids", "enums", "playlist", "journal", "journal-events", "bundle", "validate", "parse", "serialize", "projections", "emit", "index"];

function loadSchema() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // packages/schema is "type": "module"; mark the CJS output dir accordingly so
  // the transpiled `.js` files are loaded as CommonJS.
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const name of MODULES) {
    const source = fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  // Bust the require cache so repeated loads pick up fresh output.
  for (const name of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  }
  return require(path.join(BUILD_DIR, "index.js"));
}

module.exports = { loadSchema, BUILD_DIR };

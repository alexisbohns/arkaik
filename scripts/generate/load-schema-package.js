/**
 * Loads the TypeScript @arkaik/schema package into a running Node process
 * without a bundler, the same way tests/schema/load-schema.js does for the
 * parity test — kept as a separate copy so the generators have no
 * dependency on the tests/ directory. Each source file is transpiled to
 * CommonJS with the TypeScript compiler and written into a build dir *inside*
 * packages/schema so that `require("zod")` resolves against the workspace's
 * node_modules.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SCHEMA_DIR = path.join(__dirname, "..", "..", "packages", "schema");
const SRC_DIR = path.join(SCHEMA_DIR, "src");
const BUILD_DIR = path.join(SCHEMA_DIR, ".generate-build");

/**
 * Every module in packages/schema/src, discovered rather than listed.
 *
 * This used to be a hardcoded array, which meant adding a source file to the
 * schema package silently broke the generators with a `Cannot find module`
 * from inside the build dir — the list was a third copy of the same knowledge
 * (tests/schema/load-schema.js holds another). Each file is transpiled
 * independently and `require` resolves at runtime, so order does not matter.
 */
function schemaModules() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3));
}

function loadSchemaPackage() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const MODULES = schemaModules();

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

  for (const name of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  }
  return require(path.join(BUILD_DIR, "index.js"));
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadSchemaPackage, cleanup };

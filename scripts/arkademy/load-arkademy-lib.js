/**
 * Loads lib/arkademy/*.ts into a running Node process for the upload script —
 * the scripts/generate/load-schema-package.js technique, kept as its own copy
 * so the script has no dependency on tests/. Every module in the folder is
 * transpiled to CommonJS into scripts/arkademy/.build/ (gitignored), inside
 * the repo so `require("zod")` resolves against the workspace's node_modules.
 *
 * lib/arkademy/ modules import only each other by relative path and zod, so
 * there is no alias table here; an `@/` import is refused by name.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SRC_DIR = path.join(__dirname, "..", "..", "lib", "arkademy");
const BUILD_DIR = path.join(__dirname, ".build");

function loadArkademyLib() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const modules = fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3));

  for (const name of modules) {
    const source = fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    if (/require\((['"])@\//.test(outputText)) {
      throw new Error(`lib/arkademy/${name}.ts imports an "@/" module, which the upload script cannot load`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  for (const name of modules) delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  return {
    ...require(path.join(BUILD_DIR, "schema.js")),
    ...require(path.join(BUILD_DIR, "validate.js")),
  };
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademyLib, cleanup, BUILD_DIR };

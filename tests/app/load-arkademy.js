/**
 * Loads every lib/arkademy/*.ts module into Node without a bundler, for the
 * test:arkademy-* suites (CI runs Node 20, which cannot `require` a `.ts`
 * file; never require one directly from a test).
 *
 * The folder is discovered, not listed, and there is NO alias table: the
 * modules in lib/arkademy/ import only each other by relative path (`./schema`)
 * and `zod`. A module that imports `@/…` breaks that contract, so the loader
 * refuses it by name instead of failing later with `Cannot find module`.
 * Parts that add modules to the folder never touch this file.
 *
 * The build directory is inside the repo so `require("zod")` resolves against
 * the workspace's node_modules.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "lib", "arkademy");
const BUILD_DIR = path.join(__dirname, ".test-build-arkademy");

function arkademyModules() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3))
    .sort();
}

/**
 * Transpiles the folder and returns every module's exports merged into one
 * object. A name exported by two modules is an error, not a silent overwrite.
 */
function loadArkademy() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const modules = arkademyModules();
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
      throw new Error(
        `lib/arkademy/${name}.ts imports an "@/" module; lib/arkademy/ modules import only each other by relative path and zod`,
      );
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  for (const name of modules) delete require.cache[path.join(BUILD_DIR, `${name}.js`)];

  const merged = {};
  const owner = {};
  for (const name of modules) {
    const exported = require(path.join(BUILD_DIR, `${name}.js`));
    for (const key of Object.keys(exported)) {
      if (key in merged) throw new Error(`"${key}" is exported by both lib/arkademy/${owner[key]}.ts and ${name}.ts`);
      merged[key] = exported[key];
      owner[key] = name;
    }
  }
  return merged;
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademy, cleanup, BUILD_DIR };

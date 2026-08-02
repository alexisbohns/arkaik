/**
 * Loads the panel modules (lib/utils/panel-stack.ts, lib/utils/project-panels.ts)
 * into Node without a bundler — the load-graph-spotlight.js technique. Both
 * modules are import-free at runtime: panel-stack has no imports at all, and
 * project-panels uses `import type` only, which transpiles away.
 *
 * The build dir carries the pid: two suites load through here and each wipes
 * the dir when it finishes, so a shared path would let one suite delete the
 * other's modules mid-run — an ENOENT that reads like a broken loader rather
 * than the race it is.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, `.test-build-panels-${process.pid}`);

/**
 * Transpile and require `lib/utils/<name>.ts`. Two constraints on what can load
 * this way: the module must live at that path, and it must have no *value*
 * imports — nothing resolves modules for it, so a runtime import fails at
 * `require` with a resolution error pointing nowhere near the cause.
 */
function loadUtil(name) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outPath = path.join(BUILD_DIR, `${name}.js`);
  fs.writeFileSync(outPath, outputText);
  delete require.cache[outPath];
  return require(outPath);
}

const loadPanelStack = () => loadUtil("panel-stack");
const loadProjectPanels = () => loadUtil("project-panels");

module.exports = { loadPanelStack, loadProjectPanels, loadUtil, BUILD_DIR };

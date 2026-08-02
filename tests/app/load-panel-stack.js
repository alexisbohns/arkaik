/**
 * Loads lib/utils/panel-stack.ts (the push-panel stack semantics) into Node
 * without a bundler — the load-graph-spotlight.js technique, and even simpler
 * here: the module has no imports at all.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-panel-stack");

function loadPanelStack() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "panel-stack.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "panel-stack.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "panel-stack.js"), outputText);

  delete require.cache[path.join(BUILD_DIR, "panel-stack.js")];
  return require(path.join(BUILD_DIR, "panel-stack.js"));
}

module.exports = { loadPanelStack, BUILD_DIR };

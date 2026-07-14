/**
 * Loads lib/utils/graph-spotlight.ts (the neighborhood-spotlight decoration)
 * into Node without a bundler — the load-journey-graph.js technique reduced
 * to a single module: its only import (`@xyflow/react`) is type-only (erased).
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-graph-spotlight");

function loadGraphSpotlight() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "graph-spotlight.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "graph-spotlight.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "graph-spotlight.js"), outputText);

  delete require.cache[path.join(BUILD_DIR, "graph-spotlight.js")];
  return require(path.join(BUILD_DIR, "graph-spotlight.js"));
}

module.exports = { loadGraphSpotlight, BUILD_DIR };

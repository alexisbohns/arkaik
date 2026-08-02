/**
 * Loads lib/utils/command-palette.ts (the ⌘K catalogue + ranking) into Node
 * without a bundler — same technique as load-graph-spotlight.js, and just as
 * cheap here: the module has no imports at all.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-command-palette");

function loadCommandPalette() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "command-palette.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "command-palette.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "command-palette.js"), outputText);

  delete require.cache[path.join(BUILD_DIR, "command-palette.js")];
  return require(path.join(BUILD_DIR, "command-palette.js"));
}

module.exports = { loadCommandPalette, BUILD_DIR };

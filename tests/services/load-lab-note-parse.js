/**
 * Loads lib/services/github/lab-note-parse.ts into a plain Node process —
 * the tests/app/load-*.js idiom. Its only value import is the `yaml`
 * package, which require() resolves from the root node_modules, so no
 * rewrites are needed beyond the transpile itself.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-lab-note-parse");

function loadLabNoteParse() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const srcPath = path.join(ROOT, "lib", "services", "github", "lab-note-parse.ts");
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "lab-note-parse.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const outFile = path.join(BUILD_DIR, "lab-note-parse.js");
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadLabNoteParse, BUILD_DIR };

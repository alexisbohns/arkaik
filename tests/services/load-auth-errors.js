/**
 * Loads lib/services/auth-errors.ts into a plain Node process — the
 * tests/app/load-*.js idiom. The module has no imports at all (it reads
 * Auth.js errors by shape), so the transpile is the whole job.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-auth-errors");

function loadAuthErrors() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const srcPath = path.join(ROOT, "lib", "services", "auth-errors.ts");
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "auth-errors.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const outFile = path.join(BUILD_DIR, "auth-errors.js");
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadAuthErrors, BUILD_DIR };

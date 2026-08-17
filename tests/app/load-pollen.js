/**
 * Loads lib/pollen/* (the vendored ariko pollen contract and the journal→
 * pollen projection) into a plain Node process, following the
 * tests/app/load-*.js idiom: transpile to CommonJS into a private build dir.
 *
 * No schema build is needed — lib/pollen's only `@arkaik/schema` imports are
 * type-only and elided by the transpiler. `map.ts` exists from the projection
 * task on; its absence is tolerated so the conformance test can run first.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-pollen");

const MODULES = [
  ["lib/pollen/support.ts", "support"],
  ["lib/pollen/contract.ts", "contract"],
  ["lib/pollen/map.ts", "map"],
];

function loadPollen() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, outName] of MODULES) {
    const srcPath = path.join(ROOT, srcRel);
    if (!fs.existsSync(srcPath)) continue;
    const source = fs.readFileSync(srcPath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), outputText);
  }
  for (const [, outName] of MODULES) delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];

  return {
    contract: require(path.join(BUILD_DIR, "contract.js")),
    map: fs.existsSync(path.join(BUILD_DIR, "map.js")) ? require(path.join(BUILD_DIR, "map.js")) : null,
  };
}

module.exports = { loadPollen, BUILD_DIR };

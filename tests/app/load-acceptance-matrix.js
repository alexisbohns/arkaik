const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-acceptance-matrix");

const MODULES = [
  ["lib/utils/search.ts", "search"],
  ["lib/utils/acceptance-matrix.ts", "acceptance-matrix"],
];
const SPECIFIER_MAP = {
  "@/lib/utils/search": "./search",
  "@/lib/data/types": "./types", // type-only in this graph
};

function loadAcceptanceMatrix() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
  for (const [srcRel, base] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    let rewritten = outputText;
    for (const [spec, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${spec}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${base}.js`), rewritten);
  }
  for (const [, base] of MODULES) delete require.cache[path.join(BUILD_DIR, `${base}.js`)];
  return require(path.join(BUILD_DIR, "acceptance-matrix.js"));
}

module.exports = { loadAcceptanceMatrix, BUILD_DIR };

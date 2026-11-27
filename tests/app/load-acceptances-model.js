// Transpiles lib/utils/acceptances-model.ts and everything it imports at runtime into a
// throwaway CommonJS build — the same pattern as load-acceptance-matrix.js. A new `@/…`
// import in the model must be added to BOTH tables below, or the require fails here.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-acceptances-model");

const MODULES = [
  ["lib/utils/search.ts", "search"],
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/config/values.ts", "config-values"],
  ["lib/utils/blocked.ts", "blocked"],
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/acceptance-matrix.ts", "acceptance-matrix"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/acceptances-model.ts", "acceptances-model"],
];
const SPECIFIER_MAP = {
  "@/lib/utils/search": "./search",
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/config/values": "./config-values",
  "@/lib/utils/blocked": "./blocked",
  "@/lib/utils/product-scope": "./product-scope",
  "@/lib/utils/acceptance-matrix": "./acceptance-matrix",
  "@/lib/utils/platform-status": "./platform-status",
  "@/lib/data/types": "./types", // type-only in this graph
};

function loadAcceptancesModel() {
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
    const unmapped = rewritten.match(/require\("@\/[^"]+"\)/g);
    if (unmapped) throw new Error(`${srcRel} imports ${unmapped.join(", ")} — add it to load-acceptances-model.js`);
    fs.writeFileSync(path.join(BUILD_DIR, `${base}.js`), rewritten);
  }
  for (const [, base] of MODULES) delete require.cache[path.join(BUILD_DIR, `${base}.js`)];
  return require(path.join(BUILD_DIR, "acceptances-model.js"));
}

module.exports = { loadAcceptancesModel, BUILD_DIR };

/**
 * Transpiles lib/config/value-icons.ts (+ its lib/config/values.ts dep) into a
 * runnable CJS module for the node test harness. values.ts calls @arkaik/schema
 * at runtime (VALUE_IDS.map), so schema is loaded via loadSchema() like
 * tests/app/load-coverage.js.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-value-icons");

const MODULES = [
  ["lib/config/values.ts", "config-values"],
  ["lib/config/value-icons.ts", "value-icons"],
];

const SPECIFIER_MAP = {
  "@/lib/config/values": "./config-values",
};

function loadValueIcons() {
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
  return {
    valueIcons: require(path.join(BUILD_DIR, "value-icons.js")),
    values: require(path.join(BUILD_DIR, "config-values.js")),
  };
}

module.exports = { loadValueIcons, BUILD_DIR };

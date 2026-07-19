const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-pyramid");

const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/config/values.ts", "config-values"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/pyramid.ts", "pyramid"],
];

const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/config/values": "./config-values",
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/platform-status": "./platform-status",
};

function loadPyramid() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });

    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return require(path.join(BUILD_DIR, "pyramid.js"));
}

module.exports = { loadPyramid, BUILD_DIR };

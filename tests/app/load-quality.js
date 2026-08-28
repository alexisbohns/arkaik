/**
 * Loads lib/utils/quality.ts into Node without a bundler.
 *
 * Simpler than load-coverage.js because quality.ts has exactly one runtime
 * dependency — @arkaik/schema, for the scales it must never reimplement.
 * Everything else it names is a type, which vanishes at transpile, so there is
 * no local module graph to rebuild here: one file in, one file out.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-quality");

function loadQuality() {
  // Build the schema package so the rewritten require resolves at runtime.
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const source = fs.readFileSync(path.join(ROOT, "lib/utils/quality.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "quality.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );
  fs.writeFileSync(path.join(BUILD_DIR, "quality.js"), rewritten);
  delete require.cache[path.join(BUILD_DIR, "quality.js")];

  // The schema's own exports ride along: a suite that checked buildFindingRows
  // against a restatement of severityOf would be checking nothing.
  return {
    ...require(path.join(BUILD_DIR, "quality.js")),
    severityOf: require(schemaIndex).severityOf,
    priorityOf: require(schemaIndex).priorityOf,
    deriveQualityMatrix: require(schemaIndex).deriveQualityMatrix,
    resolveKritikLibrary: require(schemaIndex).resolveKritikLibrary,
  };
}

module.exports = { loadQuality, BUILD_DIR, SCHEMA_BUILD_DIR };

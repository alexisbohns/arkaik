/**
 * Loads lib/services/graph/quality-events.ts into a plain Node process — the
 * tests/services/load-quality-parse.js idiom.
 *
 * The pure core has NO db/auth imports and no `server-only`: its only
 * dependencies are `@arkaik/schema` and `lib/utils/quality.ts` (which itself
 * only imports `@arkaik/schema`). So this loader compiles both files and
 * rewrites `@arkaik/schema` and `@/lib/utils/quality` to point at the
 * compiled output, with no stubs required — unlike quality.ts's webhook half,
 * this module never reaches for db/store at all.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-quality-events");

function loadQualityEvents() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  const compile = (relative, outName) => {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(relative),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/utils\/quality\1\)/g, `require(${JSON.stringify(path.join(BUILD_DIR, "quality-utils.js"))})`);
    const outFile = path.join(BUILD_DIR, outName);
    fs.writeFileSync(outFile, rewritten);
    delete require.cache[outFile];
    return outFile;
  };

  compile("lib/utils/quality.ts", "quality-utils.js");
  const coreFile = compile("lib/services/graph/quality-events.ts", "quality-events.js");
  return require(coreFile);
}

module.exports = { loadQualityEvents, BUILD_DIR };

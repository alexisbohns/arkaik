/**
 * Loads lib/utils/journal.ts (the projection functions) into a running Node
 * process without a bundler. Same transpile-on-the-fly approach as
 * load-migrate.js / load-schema.js.
 *
 * journal.ts's only runtime import is `orderEvents` from @arkaik/schema (its
 * type imports erase); we build the schema package with load-schema.js and
 * rewrite that bare specifier to the built CJS index so the require resolves.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "lib", "utils", "journal.ts");
const BUILD_DIR = path.join(__dirname, ".test-build-journal");

function loadJournalProjections() {
  // Build the schema package so `require(...schema index)` resolves at runtime.
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "journal.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  // Point the bare @arkaik/schema require at the built CJS index. The path is
  // absolute and JSON-encoded so it survives on any OS.
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );

  const outFile = path.join(BUILD_DIR, "journal.js");
  fs.writeFileSync(outFile, rewritten);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadJournalProjections, BUILD_DIR, SCHEMA_BUILD_DIR };

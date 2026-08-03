/**
 * Loads lib/utils/decision.ts into a plain Node process, following the
 * tests/app/load-*.js idiom: transpile to CommonJS, rewrite the `@/` alias,
 * and point `@arkaik/schema` at the schema package's own test build.
 *
 * Deliberately minimal — decision.ts's only real (value) import is
 * `lifecycleStatusForDecision` from `@arkaik/schema`, plus a re-export of
 * `decisionStatusOf` / `DECISION_STATUS_IDS` from the same package. Its
 * `@/lib/data/types` and `@/lib/config/statuses` imports are type-only and
 * elided by the transpiler, so neither needs a sibling build here.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-decision-utils");

const MODULES = [["lib/utils/decision.ts", "decision"]];

function loadDecisionUtils() {
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

    const rewritten = outputText.replace(
      /require\((['"])@arkaik\/schema\1\)/g,
      `require(${JSON.stringify(schemaIndex)})`,
    );
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  return require(path.join(BUILD_DIR, "decision.js"));
}

module.exports = { loadDecisionUtils, BUILD_DIR };

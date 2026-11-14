/**
 * Loads lib/utils/decision-log.ts (the Decision Log model) and
 * lib/utils/decision-panel.ts (the decision panel's model) into a plain Node
 * process, following the tests/app/load-*.js idiom: transpile each module to
 * CommonJS, rewrite its `@/` imports to the sibling builds, and point
 * `@arkaik/schema` at the schema package's own test build.
 *
 * Their value imports are `lib/utils/decision.ts` (decisionStatusOf),
 * `lib/config/decision-statuses.ts` (the vocabulary) and each other;
 * everything else is type-only and elided. A new `@/` value import in any of
 * these files must be added to ALIASES below, or loading throws naming it.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-decision-log");

const MODULES = [
  ["lib/utils/decision-log.ts", "decision-log"],
  ["lib/utils/decision-panel.ts", "decision-panel"],
  ["lib/utils/decision.ts", "decision"],
  ["lib/config/decision-statuses.ts", "decision-statuses"],
];
const ALIASES = {
  "@/lib/utils/decision-log": "./decision-log.js",
  "@/lib/utils/decision": "./decision.js",
  "@/lib/config/decision-statuses": "./decision-statuses.js",
};

function loadDecisionLog() {
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
    const rewritten = outputText.replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, spec) => {
      if (spec === "@arkaik/schema") return `require(${JSON.stringify(schemaIndex)})`;
      if (spec in ALIASES) return `require(${JSON.stringify(ALIASES[spec])})`;
      if (spec.startsWith("@/")) throw new Error(`load-decision-log: unmapped import ${spec} in ${srcRel}`);
      return match;
    });
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return {
    ...require(path.join(BUILD_DIR, "decision-log.js")),
    ...require(path.join(BUILD_DIR, "decision-panel.js")),
  };
}

module.exports = { loadDecisionLog, BUILD_DIR };

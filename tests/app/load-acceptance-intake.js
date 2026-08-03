/**
 * Loads lib/utils/acceptance-intake.ts into a plain Node process, following the
 * tests/app/load-*.js idiom: transpile to CommonJS, rewrite the `@/` alias, and
 * point `@arkaik/schema` at the schema package's own test build.
 *
 * The module's whole dependency graph comes along because it is *used*, not
 * stubbed: intake reads membership through `product-scope.ts` and writes it
 * through `product-editing.ts`, and a suite that reimplemented either would be
 * asserting its own copy of the anchors-first rule rather than the app's.
 *
 * lib/hooks/useAcceptanceIntake.ts is deliberately absent — it is a React hook,
 * this repo has no component runner, and everything it decides beyond "turn a
 * plan into a write" lives in the module built here.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-acceptance-intake");

const MODULES = [
  ["lib/config/platforms.ts", "platforms"],
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/product-editing.ts", "product-editing"],
  ["lib/utils/acceptance-intake.ts", "acceptance-intake"],
];

function loadAcceptanceIntake() {
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

    // `@/lib/data/types` is imported type-only and is elided by the transpiler;
    // everything else is a real require and is pointed at the schema test build
    // or at a sibling output in this flat build directory.
    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/config\/platforms\1\)/g, `require("./platforms.js")`)
      .replace(/require\((['"])@\/lib\/utils\/product-scope\1\)/g, `require("./product-scope.js")`)
      .replace(/require\((['"])@\/lib\/utils\/product-editing\1\)/g, `require("./product-editing.js")`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  return {
    ...require(path.join(BUILD_DIR, "acceptance-intake.js")),
    // The read authority the intake rules are judged against. Picked, not
    // spread: this suite asserts what membership *is* after a plan, and it must
    // ask the same function every read surface asks.
    productsOfAcceptance: require(path.join(BUILD_DIR, "product-scope.js")).productsOfAcceptance,
    // The real op interpreter. A plan is only correct if the graph it produces
    // is, and reimplementing "apply these ops" in the suite would hide exactly
    // the mistakes worth catching — a duplicate id inside one batch, an edge id
    // that does not match the `e-{source}-{target}` convention `applyOps`
    // rewrites to.
    applyOps: require(schemaIndex).applyOps,
  };
}

module.exports = { loadAcceptanceIntake, BUILD_DIR };

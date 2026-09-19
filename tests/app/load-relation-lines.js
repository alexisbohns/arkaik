/**
 * Loads lib/utils/relation-lines.ts and lib/utils/node-relations.ts into a
 * plain Node process, following the tests/app/load-*.js idiom: transpile to
 * CommonJS, rewrite each `@/` alias by hand, and point `@arkaik/schema` at the
 * schema package's own test build.
 *
 * Both modules take VALID_EDGE_SEMANTICS as a *value*, so `loadUtil` in
 * load-panel-utils.js cannot take them — it rewrites nothing, and the require
 * would fail at resolution with an error pointing nowhere near the cause.
 *
 * MODULES is in dependency order, and the rewrite table below has one line per
 * `@/` import in those files. Adding an import to either module means adding a
 * line here; there is no resolver doing it for you.
 *
 * node-relations.ts does not exist yet (it lands in Part 3, Task 3.1), so for
 * now MODULES lists only relation-lines and there is no rewrite line for the
 * `@/lib/utils/relation-lines` import node-relations.ts will make.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-relation-lines");

const MODULES = [
  ["lib/utils/relation-lines.ts", "relation-lines"],
];

function loadRelationLines() {
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

    // `@/lib/data/types` is imported type-only and is elided by the
    // transpiler.
    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  const schema = require(schemaIndex);

  return {
    ...require(path.join(BUILD_DIR, "relation-lines.js")),
    // The authority every assertion in the suite is written against. Handed
    // back from here rather than re-loaded in the suite: `loadSchema()` wipes
    // and rebuilds its build dir, so a second call mid-suite re-transpiles the
    // package under modules that are already required.
    VALID_EDGE_SEMANTICS: schema.VALID_EDGE_SEMANTICS,
    // The real op interpreter — a plan is only correct if the graph it produces
    // is, and reimplementing "apply these ops" in the suite would hide exactly
    // the mistakes worth catching.
    applyOps: schema.applyOps,
  };
}

module.exports = { loadRelationLines, BUILD_DIR };

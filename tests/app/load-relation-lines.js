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
 * MODULES is in dependency order: node-relations.ts imports relation-lines.ts
 * as a *value* (`relationRows`), so the latter has to be transpiled first and
 * the require rewritten to the build dir's own copy. The rewrite table below
 * has one line per *value* `@/` import across those files — that one. The only
 * other `@/` import (`@/lib/data/types`) is `import type` and is elided by the
 * transpiler. Adding a value import to either module means adding a rewrite
 * line for it; a missing rule is not silently ignored — see the leftover-alias
 * check below, which throws rather than shipping a require that resolves
 * nowhere.
 *
 * The build dir carries the pid: Part 3 adds a second suite behind this same
 * loader, and a shared path would let one suite's cleanup delete the other's
 * modules mid-run — an ENOENT that reads like a broken loader rather than the
 * race it is (see load-panel-utils.js, which documents the same hazard).
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, `.test-build-relation-lines-${process.pid}`);

const MODULES = [
  ["lib/utils/relation-lines.ts", "relation-lines"],
  ["lib/utils/node-relations.ts", "node-relations"],
];

// Registered once, here, rather than left for each suite that calls
// `loadRelationLines()` to remember on its own — the same "someone will
// forget" reasoning that justified the pid suffix above. Part 3's second
// suite behind this loader gets cleanup by construction instead of by copying
// a handler.
let cleanupRegistered = false;
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.on("exit", () => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  });
}

function loadRelationLines() {
  registerCleanup();
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
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(
        /require\((['"])@\/lib\/utils\/relation-lines\1\)/g,
        () => `require(${JSON.stringify(path.join(BUILD_DIR, "relation-lines.js"))})`,
      );

    // A `@/…` require this table has no rule for would otherwise resolve
    // against nothing and fail inside `require()`, far from the actual cause.
    // This repo has been bitten by exactly that: a new `@/…` import silently
    // breaking a hand-maintained loader table. Scoped to the `@/` alias
    // specifically (not `@…` generally): this workspace has real scoped
    // packages, e.g. `@arkaik/kritik-library`, that Node resolves fine from
    // inside the build dir once the `@arkaik/schema` rewrite above has run —
    // flagging those as unrewritten would be a false positive.
    const leftover = rewritten.match(/require\(["']@\/[^"']+["']\)/g);
    if (leftover) {
      throw new Error(
        `${srcRel}: no rewrite rule for ${leftover.join(", ")} — add one to the rewrite table in ${__filename}`,
      );
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  const schema = require(schemaIndex);

  return {
    ...require(path.join(BUILD_DIR, "relation-lines.js")),
    ...require(path.join(BUILD_DIR, "node-relations.js")),
    // The authority every assertion in the suite is written against. Handed
    // back from here rather than re-loaded in the suite: `loadSchema()` wipes
    // and rebuilds its build dir, so a second call mid-suite re-transpiles the
    // package under modules that are already required.
    VALID_EDGE_SEMANTICS: schema.VALID_EDGE_SEMANTICS,
    // The real op interpreter — a plan is only correct if the graph it produces
    // is, and reimplementing "apply these ops" in the suite would hide exactly
    // the mistakes worth catching.
    applyOps: schema.applyOps,
    // The species list the suite's per-species coverage check is driven from,
    // rather than a fourth hand-written copy of the six species ids.
    SPECIES_IDS: schema.SPECIES_IDS,
  };
}

module.exports = { loadRelationLines, BUILD_DIR };

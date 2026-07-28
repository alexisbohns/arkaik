/**
 * Loads the PURE planning half of lib/services/github/pull-request.ts — mention
 * parsing, ref-id minting, scope precedence, planForProject — with no database
 * anywhere in reach.
 *
 * Why a second loader rather than reusing load-github-api.js: that one
 * transpiles db.ts, limits.ts, owners.ts, tokens.ts and auth.ts for real, which
 * is correct for an integration test but means the suite can only run against a
 * migrated Postgres — so every assertion in it, including the pure ones, only
 * ever ran in CI's `services` job. Three separate bugs in this area were found
 * only after pushing. This loader exists so the pure half runs on a laptop.
 *
 * The two service dependencies resolve to stubs that THROW rather than no-op.
 * The planner is pure today, and the only thing between "pure" and "quietly
 * issues a query per delivery" is that nobody notices; a throwing stub turns
 * that regression into a legible test failure instead of a slow webhook.
 *
 * @arkaik/schema is the REAL package: computeRefPromotions and promotionPatch
 * ARE the behaviour under test, and stubbing them would leave this suite
 * asserting on its own fixtures.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-pr-plan");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName, rewrites) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  let { outputText } = ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS });
  for (const [specifier, replacement] of rewrites) {
    const pattern = new RegExp(
      `require\\((['"])${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\1\\)`,
      "g",
    );
    outputText = outputText.replace(pattern, `require(${JSON.stringify(replacement)})`);
  }
  return outputText;
}

/** A module whose every export throws, naming what called it and why that is a bug. */
function forbidden(label, exportNames) {
  const boom = exportNames
    .map(
      (name) =>
        `  ${name}: () => { throw new Error("pr-plan test: the planner reached ${label}.${name}()` +
        ` — planForProject must stay pure"); },`,
    )
    .join("\n");
  return `module.exports = {\n${boom}\n};\n`;
}

function loadPrPlan() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  // packages/schema is "type": "module"; mark this CJS output dir accordingly.
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  // node_modules/server-only is a bare `throw` outside a react-server export
  // condition, so the marker import has to resolve to something inert.
  write("server-only-stub.js", "module.exports = {};\n");
  write("db-forbidden.js", forbidden("db", ["query", "servicesConfigured", "servicesUnavailable"]));
  write("store-forbidden.js", forbidden("store", ["getProject", "applyMutation", "createProject"]));

  const REWRITES = [
    ["server-only", "./server-only-stub.js"],
    ["@arkaik/schema", schemaIndex],
    ["@/lib/config/platforms", "./platforms.js"],
    ["@/lib/services/db", "./db-forbidden.js"],
    ["@/lib/services/graph/store", "./store-forbidden.js"],
  ];

  const src = (...parts) => path.join(ROOT, ...parts);

  // The real platform list, not a stub: the grammar's valid set is derived from
  // it, and a stubbed copy would let the two drift without a test noticing.
  write("platforms.js", transpile(src("lib", "config", "platforms.ts"), "platforms.ts", REWRITES));
  write(
    "pull-request.js",
    transpile(src("lib", "services", "github", "pull-request.ts"), "pull-request.ts", REWRITES),
  );

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  return require(path.join(BUILD_DIR, "pull-request.js"));
}

module.exports = { loadPrPlan, BUILD_DIR, SCHEMA_BUILD_DIR };

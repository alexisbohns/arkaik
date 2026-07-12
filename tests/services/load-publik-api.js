/**
 * Loads the Publik route handlers (app/api/publik/**\/route.ts) plus their
 * server-side deps (lib/services/publik.ts, lib/services/db.ts) into a running
 * Node process without a bundler — the same transpile-on-the-fly approach as
 * tests/data/load-*.js and tests/schema/load-schema.js.
 *
 * The transpiled output goes into a build dir *inside the repo* (tests/services/
 * .test-build-publik) so bare requires like `require("pg")` and
 * `require("server-only")` resolve against the workspace node_modules. The two
 * non-relative app specifiers are rewritten to the built files:
 *   - `@arkaik/schema`      → the CJS schema index (built via load-schema.js)
 *   - `@/lib/services/db`   → ./db.js
 *   - `@/lib/services/publik` → ./publik.js
 *
 * Returns the handler functions so a test can invoke them directly with real
 * `Request` objects against a real DATABASE_URL (the CI "services" job / a local
 * Postgres) — exactly how docs/spec/services.md § CI Additions frames the
 * integration tests ("route handlers invoked against the migrated schema").
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-publik");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName, rewrites) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  let { outputText } = ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS });
  for (const [specifier, replacement] of rewrites) {
    // Rewrite `require("<specifier>")` → `require(<replacement>)`.
    const pattern = new RegExp(
      `require\\((['"])${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\1\\)`,
      "g",
    );
    outputText = outputText.replace(pattern, `require(${JSON.stringify(replacement)})`);
  }
  return outputText;
}

function loadPublikApi() {
  // Build @arkaik/schema so `require(...schema index)` resolves at runtime.
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  // `server-only` throws outside a React Server Component (its default export is
  // a guard). The route handlers only ever run server-side in production; for the
  // test harness we stub it to a no-op so the modules load in plain Node.
  const serverOnlyStub = "./server-only-stub.js";
  write("server-only-stub.js", "module.exports = {};\n");

  // lib/services/db.ts — stub `server-only`; bare `pg` require resolves as-is.
  write(
    "db.js",
    transpile(path.join(ROOT, "lib", "services", "db.ts"), "db.ts", [["server-only", serverOnlyStub]]),
  );

  // lib/services/publik.ts — rewrite the schema + db + server-only specifiers.
  write(
    "publik.js",
    transpile(path.join(ROOT, "lib", "services", "publik.ts"), "publik.ts", [
      ["@arkaik/schema", schemaIndex],
      ["@/lib/services/db", "./db.js"],
      ["server-only", serverOnlyStub],
    ]),
  );

  // Route handlers — rewrite the publik specifier.
  write(
    "post.js",
    transpile(path.join(ROOT, "app", "api", "publik", "route.ts"), "route.ts", [
      ["@/lib/services/publik", "./publik.js"],
    ]),
  );
  write(
    "id.js",
    transpile(path.join(ROOT, "app", "api", "publik", "[id]", "route.ts"), "route.ts", [
      ["@/lib/services/publik", "./publik.js"],
    ]),
  );
  write(
    "report.js",
    transpile(path.join(ROOT, "app", "api", "publik", "[id]", "report", "route.ts"), "route.ts", [
      ["@/lib/services/publik", "./publik.js"],
    ]),
  );

  for (const name of ["db.js", "publik.js", "post.js", "id.js", "report.js"]) {
    delete require.cache[path.join(BUILD_DIR, name)];
  }

  const post = require(path.join(BUILD_DIR, "post.js"));
  const idRoute = require(path.join(BUILD_DIR, "id.js"));
  const report = require(path.join(BUILD_DIR, "report.js"));

  return {
    POST: post.POST,
    GET: idRoute.GET,
    DELETE: idRoute.DELETE,
    REPORT: report.POST,
  };
}

module.exports = { loadPublikApi, BUILD_DIR, SCHEMA_BUILD_DIR };

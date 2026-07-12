/**
 * Loads the Synk route handlers (app/api/synk/**\/route.ts) plus their
 * server-side deps (lib/services/synk.ts, lib/services/limits.ts,
 * lib/services/db.ts) into a running Node process without a bundler — the same
 * transpile-on-the-fly approach as tests/services/load-publik-api.js.
 *
 * The transpiled output goes into a build dir *inside the repo* (tests/services/
 * .test-build-synk) so bare requires like `require("pg")` and
 * `require("server-only")` resolve against the workspace node_modules. The
 * non-relative app specifiers are rewritten to the built files:
 *   - `@arkaik/schema`         → the CJS schema index (built via load-schema.js)
 *   - `@/lib/services/db`      → ./db.js
 *   - `@/lib/services/limits`  → ./limits.js
 *   - `@/lib/services/synk`    → ./synk.js
 *   - `@/lib/services/auth`    → ./auth-stub.js (a controllable getSession)
 *
 * Stubbing at the getSession boundary (exactly as tests/services/
 * auth-guard.test.js does) is deliberate: the handlers' auth check is pure guard
 * logic and needs no live OAuth round-trip or next-auth (ESM-only, un-requireable
 * under this CommonJS transpile). The test controls the "current session" via
 * `setSession()`; the DATABASE_URL path is the real Postgres.
 *
 * Returns the handler functions, a `setSession` control, and the transpiled synk
 * service module (so retention pruning can be exercised directly).
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-synk");

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

function loadSynkApi() {
  // Build @arkaik/schema so `require(...schema index)` resolves at runtime.
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  // `server-only` throws outside a React Server Component; stub it to a no-op so
  // the modules load in plain Node (same as load-publik-api.js).
  const serverOnlyStub = "./server-only-stub.js";
  write("server-only-stub.js", "module.exports = {};\n");

  // Controllable session stub for `@/lib/services/auth`. The test drives it via
  // the returned setSession(); default is unauthenticated (null).
  write(
    "auth-stub.js",
    "let current = null;\n" +
      "module.exports = {\n" +
      "  getSession: async () => current,\n" +
      "  __setSession: (s) => { current = s; },\n" +
      "};\n",
  );

  // lib/services/db.ts — stub `server-only`; bare `pg` require resolves as-is.
  write(
    "db.js",
    transpile(path.join(ROOT, "lib", "services", "db.ts"), "db.ts", [["server-only", serverOnlyStub]]),
  );

  // lib/services/limits.ts — stub `server-only`.
  write(
    "limits.js",
    transpile(path.join(ROOT, "lib", "services", "limits.ts"), "limits.ts", [
      ["server-only", serverOnlyStub],
    ]),
  );

  // lib/services/synk.ts — rewrite schema + db + limits + server-only specifiers.
  write(
    "synk.js",
    transpile(path.join(ROOT, "lib", "services", "synk.ts"), "synk.ts", [
      ["@arkaik/schema", schemaIndex],
      ["@/lib/services/db", "./db.js"],
      ["@/lib/services/limits", "./limits.js"],
      ["server-only", serverOnlyStub],
    ]),
  );

  // Route handlers — rewrite the auth + synk specifiers.
  const routeRewrites = [
    ["@/lib/services/auth", "./auth-stub.js"],
    ["@/lib/services/synk", "./synk.js"],
  ];
  write(
    "projects.js",
    transpile(path.join(ROOT, "app", "api", "synk", "projects", "route.ts"), "route.ts", routeRewrites),
  );
  write(
    "project.js",
    transpile(
      path.join(ROOT, "app", "api", "synk", "projects", "[projectId]", "route.ts"),
      "route.ts",
      routeRewrites,
    ),
  );
  write(
    "backups.js",
    transpile(
      path.join(ROOT, "app", "api", "synk", "projects", "[projectId]", "backups", "route.ts"),
      "route.ts",
      routeRewrites,
    ),
  );
  write(
    "backup.js",
    transpile(
      path.join(ROOT, "app", "api", "synk", "backups", "[backupId]", "route.ts"),
      "route.ts",
      routeRewrites,
    ),
  );

  const names = ["db.js", "limits.js", "synk.js", "auth-stub.js", "projects.js", "project.js", "backups.js", "backup.js"];
  for (const name of names) delete require.cache[path.join(BUILD_DIR, name)];

  const authStub = require(path.join(BUILD_DIR, "auth-stub.js"));
  const synk = require(path.join(BUILD_DIR, "synk.js"));
  const projectsRoute = require(path.join(BUILD_DIR, "projects.js"));
  const projectRoute = require(path.join(BUILD_DIR, "project.js"));
  const backupsRoute = require(path.join(BUILD_DIR, "backups.js"));
  const backupRoute = require(path.join(BUILD_DIR, "backup.js"));

  return {
    LIST_PROJECTS: projectsRoute.GET,
    PUT_BACKUP: projectRoute.PUT,
    DELETE_PROJECT: projectRoute.DELETE,
    LIST_BACKUPS: backupsRoute.GET,
    GET_BACKUP: backupRoute.GET,
    setSession: authStub.__setSession,
    synk,
  };
}

module.exports = { loadSynkApi, BUILD_DIR, SCHEMA_BUILD_DIR };

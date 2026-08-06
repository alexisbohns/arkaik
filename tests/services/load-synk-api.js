/**
 * Loads the Synk route handlers (app/api/synk/**\/route.ts) plus their
 * server-side deps (lib/services/synk.ts, lib/services/limits.ts,
 * lib/services/db.ts, and the real `getCaller()` seam) into a running Node
 * process without a bundler — the same transpile-on-the-fly approach as
 * tests/services/load-publik-api.js.
 *
 * The transpiled output goes into a build dir *inside the repo* (tests/services/
 * .test-build-synk) so bare requires like `require("pg")` and
 * `require("server-only")` resolve against the workspace node_modules. The
 * non-relative app specifiers are rewritten to the built files:
 *   - `@arkaik/schema`         → the CJS schema index (built via load-schema.js)
 *   - `@/lib/services/db`      → ./db.js
 *   - `@/lib/services/limits`  → ./limits.js
 *   - `@/lib/services/owners`  → ./owners.js
 *   - `@/lib/services/tokens`  → ./tokens.js
 *   - `@/lib/services/auth`    → ./auth.js (the REAL module)
 *   - `@/lib/services/synk`    → ./synk.js
 *   - `@/auth`                 → ./auth-module-stub.js (a controllable session)
 *
 * Only `@/auth` is stubbed, matching load-token-api.js / load-graph-api.js. This
 * loader used to stub `@/lib/services/auth` wholesale with a fake `getSession`,
 * which was fine while the Synk handlers only read a session cookie. They now go
 * through `getCaller`, so a stub at that boundary would skip the entire thing
 * under test — bearer-token resolution, the scope check, and the rule that a
 * rejected token does NOT fall through to the session cookie.
 *
 * Returns the handler functions, a `setSession` control, and the transpiled synk
 * and tokens modules (so retention pruning and minting can be driven directly).
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
  write("server-only-stub.js", "module.exports = {};\n");

  // Stands in for `@/auth` (NextAuth, ESM-only and un-requireable under this
  // CommonJS transpile). The test picks the signed-in user via setSession();
  // default is signed out.
  write(
    "auth-module-stub.js",
    "let current = null;\n" +
      "module.exports = {\n" +
      "  auth: async () => current,\n" +
      "  __setSession: (s) => { current = s; },\n" +
      "};\n",
  );

  const COMMON = [
    ["server-only", "./server-only-stub.js"],
    ["@arkaik/schema", schemaIndex],
    ["@/lib/services/db", "./db.js"],
    ["@/lib/services/limits", "./limits.js"],
    ["@/lib/services/owners", "./owners.js"],
    ["@/lib/services/tokens", "./tokens.js"],
    ["@/lib/services/auth", "./auth.js"],
    ["@/lib/services/synk", "./synk.js"],
    ["@/auth", "./auth-module-stub.js"],
  ];

  const src = (...parts) => path.join(ROOT, ...parts);

  write("db.js", transpile(src("lib", "services", "db.ts"), "db.ts", COMMON));
  write("limits.js", transpile(src("lib", "services", "limits.ts"), "limits.ts", COMMON));
  write("owners.js", transpile(src("lib", "services", "owners.ts"), "owners.ts", COMMON));
  write("tokens.js", transpile(src("lib", "services", "tokens.ts"), "tokens.ts", COMMON));
  write("auth.js", transpile(src("lib", "services", "auth.ts"), "auth.ts", COMMON));
  write("synk.js", transpile(src("lib", "services", "synk.ts"), "synk.ts", COMMON));

  const routes = {
    "projects.js": src("app", "api", "synk", "projects", "route.ts"),
    "project.js": src("app", "api", "synk", "projects", "[projectId]", "route.ts"),
    "backups.js": src("app", "api", "synk", "projects", "[projectId]", "backups", "route.ts"),
    "backup.js": src("app", "api", "synk", "backups", "[backupId]", "route.ts"),
  };
  for (const [out, from] of Object.entries(routes)) {
    write(out, transpile(from, "route.ts", COMMON));
  }

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  const authModuleStub = req("auth-module-stub.js");

  return {
    LIST_PROJECTS: req("projects.js").GET,
    PUT_BACKUP: req("project.js").PUT,
    DELETE_PROJECT: req("project.js").DELETE,
    LIST_BACKUPS: req("backups.js").GET,
    GET_BACKUP: req("backup.js").GET,
    setSession: authModuleStub.__setSession,
    synk: req("synk.js"),
    tokens: req("tokens.js"),
    owners: req("owners.js"),
  };
}

module.exports = { loadSynkApi, BUILD_DIR, SCHEMA_BUILD_DIR };

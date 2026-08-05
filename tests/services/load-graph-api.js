/**
 * Loads the hosted graph store, the real `getCaller()` seam, and every
 * /api/graph route handler into a running Node process without a bundler — the
 * same transpile-on-the-fly approach as load-synk-api.js / load-token-api.js.
 *
 * Only `@/auth` (NextAuth, ESM-only) is stubbed. The store, the token
 * verification, the owner resolution, the scope checks, and the Postgres
 * transactions all run for real — stubbing any of those would leave the parts
 * most likely to be wrong untested.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-graph");

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

function loadGraphApi() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  const serverOnlyStub = "./server-only-stub.js";
  write("server-only-stub.js", "module.exports = {};\n");

  write(
    "auth-module-stub.js",
    "let current = null;\n" +
      "module.exports = {\n" +
      "  auth: async () => current,\n" +
      "  __setSession: (s) => { current = s; },\n" +
      "};\n",
  );

  const COMMON = [
    ["server-only", serverOnlyStub],
    ["@arkaik/schema", schemaIndex],
    ["@/lib/services/db", "./db.js"],
    ["@/lib/services/limits", "./limits.js"],
    ["@/lib/services/owners", "./owners.js"],
    ["@/lib/services/tokens", "./tokens.js"],
    ["@/lib/services/auth", "./auth.js"],
    ["@/lib/services/graph/restore", "./restore.js"],
    ["@/lib/services/graph/store", "./store.js"],
    ["@/lib/services/graph/read-route", "./read-route.js"],
    ["@/auth", "./auth-module-stub.js"],
  ];

  const src = (...parts) => path.join(ROOT, ...parts);

  write("db.js", transpile(src("lib", "services", "db.ts"), "db.ts", COMMON));
  write("limits.js", transpile(src("lib", "services", "limits.ts"), "limits.ts", COMMON));
  write("owners.js", transpile(src("lib", "services", "owners.ts"), "owners.ts", COMMON));
  write("tokens.js", transpile(src("lib", "services", "tokens.ts"), "tokens.ts", COMMON));
  write("auth.js", transpile(src("lib", "services", "auth.ts"), "auth.ts", COMMON));
  // store.ts now imports from restore.ts (checkHostedEntityLimit,
  // classifyIfMatch, computeBundleDelta for replaceProjectBundle — Task 11).
  // The REAL module, transpiled, not a stub: restore.ts is pure and cheap
  // (import "server-only" and a table lookup in limits.ts, both already
  // loaded for real here), so stubbing it would only hide bugs, mirroring
  // how limits.ts/owners.ts are already treated in this same COMMON table.
  write("restore.js", transpile(src("lib", "services", "graph", "restore.ts"), "restore.ts", COMMON));
  write("store.js", transpile(src("lib", "services", "graph", "store.ts"), "store.ts", COMMON));
  write("read-route.js", transpile(src("lib", "services", "graph", "read-route.ts"), "read-route.ts", COMMON));

  const routes = {
    "projects-route.js": src("app", "api", "graph", "projects", "route.ts"),
    "project-route.js": src("app", "api", "graph", "projects", "[projectId]", "route.ts"),
    "mutations-route.js": src("app", "api", "graph", "projects", "[projectId]", "mutations", "route.ts"),
    "bundle-route.js": src("app", "api", "graph", "projects", "[projectId]", "bundle", "route.ts"),
    "nodes-route.js": src("app", "api", "graph", "projects", "[projectId]", "nodes", "route.ts"),
    "edges-route.js": src("app", "api", "graph", "projects", "[projectId]", "edges", "route.ts"),
    "journal-route.js": src("app", "api", "graph", "projects", "[projectId]", "journal", "route.ts"),
    "export-route.js": src("app", "api", "graph", "projects", "[projectId]", "export", "route.ts"),
  };
  for (const [out, from] of Object.entries(routes)) {
    write(out, transpile(from, "route.ts", COMMON));
  }

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  const authStub = req("auth-module-stub.js");

  return {
    store: req("store.js"),
    tokens: req("tokens.js"),
    owners: req("owners.js"),
    setSession: authStub.__setSession,
    LIST_PROJECTS: req("projects-route.js").GET,
    CREATE_PROJECT: req("projects-route.js").POST,
    GET_PROJECT: req("project-route.js").GET,
    DELETE_PROJECT: req("project-route.js").DELETE,
    MUTATE: req("mutations-route.js").POST,
    PUT_BUNDLE: req("bundle-route.js").PUT,
    GET_NODES: req("nodes-route.js").GET,
    GET_EDGES: req("edges-route.js").GET,
    GET_JOURNAL: req("journal-route.js").GET,
    EXPORT: req("export-route.js").GET,
  };
}

module.exports = { loadGraphApi, BUILD_DIR, SCHEMA_BUILD_DIR };

/**
 * Loads the GitHub webhook route and its two service modules into a running
 * Node process without a bundler — same approach as the other tests/services
 * loaders. Nothing is stubbed: signature verification, the delivery ledger, the
 * repo lookup and the planning logic all run for real.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-github");

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

function loadGithubApi() {
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
    "module.exports = { auth: async () => null, __setSession: () => {} };\n",
  );

  const COMMON = [
    ["server-only", serverOnlyStub],
    ["@arkaik/schema", schemaIndex],
    ["@/lib/services/db", "./db.js"],
    ["@/lib/services/limits", "./limits.js"],
    ["@/lib/services/owners", "./owners.js"],
    ["@/lib/services/tokens", "./tokens.js"],
    ["@/lib/services/auth", "./auth.js"],
    ["@/lib/services/graph/store", "./graph-store.js"],
    ["@/lib/services/github/verify", "./verify.js"],
    ["@/lib/services/github/pull-request", "./pull-request.js"],
    ["@/auth", "./auth-module-stub.js"],
  ];

  const src = (...parts) => path.join(ROOT, ...parts);

  write("db.js", transpile(src("lib", "services", "db.ts"), "db.ts", COMMON));
  write("limits.js", transpile(src("lib", "services", "limits.ts"), "limits.ts", COMMON));
  write("owners.js", transpile(src("lib", "services", "owners.ts"), "owners.ts", COMMON));
  write("tokens.js", transpile(src("lib", "services", "tokens.ts"), "tokens.ts", COMMON));
  write("auth.js", transpile(src("lib", "services", "auth.ts"), "auth.ts", COMMON));
  write("graph-store.js", transpile(src("lib", "services", "graph", "store.ts"), "store.ts", COMMON));
  write("verify.js", transpile(src("lib", "services", "github", "verify.ts"), "verify.ts", COMMON));
  write("pull-request.js", transpile(src("lib", "services", "github", "pull-request.ts"), "pull-request.ts", COMMON));
  write("webhook-route.js", transpile(src("app", "api", "github", "webhook", "route.ts"), "route.ts", COMMON));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  return {
    verify: req("verify.js"),
    pullRequest: req("pull-request.js"),
    store: req("graph-store.js"),
    POST: req("webhook-route.js").POST,
  };
}

module.exports = { loadGithubApi, BUILD_DIR, SCHEMA_BUILD_DIR };

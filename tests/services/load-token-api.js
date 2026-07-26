/**
 * Loads the token service, the owner service, the real `getCaller()` seam, and
 * the /api/tokens route handlers into a running Node process without a bundler —
 * the same transpile-on-the-fly approach as load-synk-api.js / load-publik-api.js.
 *
 * The one interesting rewrite is `@/auth`: lib/services/auth.ts imports NextAuth,
 * which is ESM-only and cannot be required under this CommonJS transpile. It is
 * replaced with a controllable stub exposing `auth()`, so the test drives "who is
 * signed in" while `getCaller` itself — the bearer-vs-session precedence, the
 * no-fallthrough rule, the owner resolution — runs for real against real Postgres.
 * That is the whole point: stubbing `getCaller` would test nothing.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-tokens");

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

function loadTokenApi() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  const serverOnlyStub = "./server-only-stub.js";
  write("server-only-stub.js", "module.exports = {};\n");

  // Stands in for `@/auth` (NextAuth, ESM-only). The test sets the session via
  // the returned setSession(); default is signed out.
  write(
    "auth-module-stub.js",
    "let current = null;\n" +
      "module.exports = {\n" +
      "  auth: async () => current,\n" +
      "  __setSession: (s) => { current = s; },\n" +
      "};\n",
  );

  write(
    "db.js",
    transpile(path.join(ROOT, "lib", "services", "db.ts"), "db.ts", [["server-only", serverOnlyStub]]),
  );

  write(
    "owners.js",
    transpile(path.join(ROOT, "lib", "services", "owners.ts"), "owners.ts", [
      ["server-only", serverOnlyStub],
      ["@/lib/services/db", "./db.js"],
    ]),
  );

  write(
    "tokens.js",
    transpile(path.join(ROOT, "lib", "services", "tokens.ts"), "tokens.ts", [
      ["server-only", serverOnlyStub],
      ["@/lib/services/db", "./db.js"],
    ]),
  );

  // The real auth seam, with only the NextAuth import replaced.
  write(
    "auth.js",
    transpile(path.join(ROOT, "lib", "services", "auth.ts"), "auth.ts", [
      ["server-only", serverOnlyStub],
      ["@/auth", "./auth-module-stub.js"],
      ["@/lib/services/owners", "./owners.js"],
      ["@/lib/services/tokens", "./tokens.js"],
    ]),
  );

  const routeRewrites = [
    ["@/lib/services/auth", "./auth.js"],
    ["@/lib/services/db", "./db.js"],
    ["@/lib/services/owners", "./owners.js"],
    ["@/lib/services/tokens", "./tokens.js"],
  ];
  write(
    "tokens-route.js",
    transpile(path.join(ROOT, "app", "api", "tokens", "route.ts"), "route.ts", routeRewrites),
  );
  write(
    "token-route.js",
    transpile(path.join(ROOT, "app", "api", "tokens", "[id]", "route.ts"), "route.ts", routeRewrites),
  );

  const names = [
    "db.js",
    "owners.js",
    "tokens.js",
    "auth.js",
    "auth-module-stub.js",
    "tokens-route.js",
    "token-route.js",
  ];
  for (const name of names) delete require.cache[path.join(BUILD_DIR, name)];

  const authModuleStub = require(path.join(BUILD_DIR, "auth-module-stub.js"));

  return {
    tokens: require(path.join(BUILD_DIR, "tokens.js")),
    owners: require(path.join(BUILD_DIR, "owners.js")),
    auth: require(path.join(BUILD_DIR, "auth.js")),
    LIST_TOKENS: require(path.join(BUILD_DIR, "tokens-route.js")).GET,
    MINT_TOKEN: require(path.join(BUILD_DIR, "tokens-route.js")).POST,
    REVOKE_TOKEN: require(path.join(BUILD_DIR, "token-route.js")).DELETE,
    setSession: authModuleStub.__setSession,
  };
}

module.exports = { loadTokenApi, BUILD_DIR };

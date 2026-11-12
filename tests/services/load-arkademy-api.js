/**
 * Loads the Arkademy read side — app/api/arkademy/route.ts, lib/services/
 * arkademy.ts and what they import — into a running Node process without a
 * bundler (the load-publik-api.js technique), for tests/services/
 * arkademy-api.test.js.
 *
 * The transpiled files go into tests/services/.test-build-arkademy/, inside
 * the repo so bare requires (`pg`, `zod`) resolve against the workspace's
 * node_modules. lib/arkademy/*.ts is copied whole into its `arkademy/`
 * subfolder, discovered rather than listed, so its relative imports keep
 * working.
 *
 * THE ALIAS TABLE. A new `@/…` import in lib/services/arkademy.ts or the route
 * needs a line in REWRITES below — here and nowhere else. `@/lib/arkademy/<name>`
 * is rewritten by rule. Anything left over fails the load by name.
 *
 * Stubs: `server-only` is an empty module (it throws outside React Server
 * Components); `next/cache`'s `unstable_cache` returns the function itself and
 * records each wrapping and each call in `nextCache.created` / `nextCache.calls`,
 * so the suite can prove which path `getArkademy` takes.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-arkademy");
const ARKADEMY_SRC = path.join(ROOT, "lib", "arkademy");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

const REWRITES = [
  ["server-only", "./server-only-stub.js"],
  ["next/cache", "./next-cache-stub.js"],
  ["@/lib/services/db", "./db.js"],
  ["@/lib/services/graph/etag", "./etag.js"],
  ["@/lib/services/arkademy", "./services-arkademy.js"],
];

const NEXT_CACHE_STUB = `
const created = [];
const calls = [];
function unstable_cache(fn, keyParts, options) {
  created.push({ keyParts, options });
  return (...args) => {
    calls.push({ keyParts, options });
    return fn(...args);
  };
}
module.exports = { unstable_cache, created, calls };
`;

function transpile(srcAbsPath) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  let { outputText } = ts.transpileModule(source, {
    fileName: path.basename(srcAbsPath),
    compilerOptions: COMPILER_OPTIONS,
  });
  for (const [specifier, replacement] of REWRITES) {
    outputText = outputText.split(`require("${specifier}")`).join(`require("${replacement}")`);
  }
  outputText = outputText.replace(/require\("@\/lib\/arkademy\/([a-z0-9-]+)"\)/g, 'require("./arkademy/$1.js")');
  const leftover = /require\("(@\/[^"]+)"\)/.exec(outputText);
  if (leftover) {
    throw new Error(
      `${path.relative(ROOT, srcAbsPath)} imports ${leftover[1]}, which tests/services/load-arkademy-api.js does not map`,
    );
  }
  return outputText;
}

function loadArkademyApi() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(BUILD_DIR, "arkademy"), { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  write("package.json", JSON.stringify({ type: "commonjs" }));
  write("server-only-stub.js", "module.exports = {};\n");
  write("next-cache-stub.js", NEXT_CACHE_STUB);

  for (const name of fs.readdirSync(ARKADEMY_SRC)) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    write(path.join("arkademy", name.replace(/\.ts$/, ".js")), transpile(path.join(ARKADEMY_SRC, name)));
  }
  write("db.js", transpile(path.join(ROOT, "lib", "services", "db.ts")));
  write("etag.js", transpile(path.join(ROOT, "lib", "services", "graph", "etag.ts")));
  write("services-arkademy.js", transpile(path.join(ROOT, "lib", "services", "arkademy.ts")));
  write("route.js", transpile(path.join(ROOT, "app", "api", "arkademy", "route.ts")));

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(BUILD_DIR)) delete require.cache[key];
  }
  const route = require(path.join(BUILD_DIR, "route.js"));
  return {
    GET: route.GET,
    route,
    arkademy: require(path.join(BUILD_DIR, "services-arkademy.js")),
    db: require(path.join(BUILD_DIR, "db.js")),
    nextCache: require(path.join(BUILD_DIR, "next-cache-stub.js")),
  };
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademyApi, cleanup, BUILD_DIR };

/**
 * Loads the two modules the path-scoped-link feature adds below the planner:
 * lib/services/github/paths.ts (pure) and lib/services/github/app.ts (pure plus
 * one injectable fetch).
 *
 * Neither imports the database or the graph store, so nothing is stubbed except
 * the `server-only` marker — node_modules/server-only is a bare `throw` outside
 * a react-server export condition, so it has to resolve to something inert.
 *
 * `node:crypto` is deliberately REAL. The App JWT's whole job is to carry a
 * signature GitHub will verify, and a stubbed signer would leave the suite
 * asserting that base64 concatenation works.
 *
 * Its own build directory, not the planner's: the loaders wipe their directory
 * on load, and two suites sharing one would make whichever ran second depend on
 * whichever ran first.
 */

const fs = require("fs");
const path = require("path");
const { transpile } = require("./load-pr-plan");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-github-app");

function loadGithubAppSeam() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  write("server-only-stub.js", "module.exports = {};\n");

  const REWRITES = [
    ["server-only", "./server-only-stub.js"],
    ["@/lib/services/github/paths", "./paths.js"],
  ];
  const src = (...parts) => path.join(ROOT, ...parts);

  write("paths.js", transpile(src("lib", "services", "github", "paths.ts"), "paths.ts", REWRITES));
  write("app.js", transpile(src("lib", "services", "github", "app.ts"), "app.ts", REWRITES));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  return {
    paths: require(path.join(BUILD_DIR, "paths.js")),
    app: require(path.join(BUILD_DIR, "app.js")),
  };
}

module.exports = { loadGithubAppSeam, BUILD_DIR };

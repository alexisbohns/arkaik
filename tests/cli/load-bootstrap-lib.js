/**
 * Loads modules from `packages/cli/src/lib/bootstrap/` into a running Node
 * process without a bundler, for the direct-require unit suites
 * (`bootstrap-era-window.test.js`, `bootstrap-body-budget.test.js`,
 * `bootstrap-event-id.test.js`, `bootstrap-journal-merge.test.js`).
 *
 * Why this exists (do not "simplify" it back to a direct
 * `require(".../foo.ts")`): those four files used to require the `.ts`
 * source straight, which works on a dev machine because a recent Node
 * (>= 22.6, and the 26.x this repo's dev machines run) strips TypeScript
 * types natively at `require()` time. `.github/workflows/ci.yml` pins
 * `node-version: 20`, which has no native TS stripping at all, so the exact
 * same `require()` throws `SyntaxError: Unexpected token ':'` on the first
 * type annotation — a suite that is green on every laptop and red on every
 * CI run. This loader makes the four suites work on BOTH: every module in
 * `packages/cli/src/lib/bootstrap` is transpiled to CommonJS with the
 * TypeScript compiler (already a devDependency) and written into a build dir
 * *inside* `packages/cli` — mirroring `tests/schema/load-schema.js`'s
 * approach for `@arkaik/schema` — so that any bare-specifier `require()`
 * inside a transpiled module (e.g. `merge.ts`'s `@arkaik/schema` import)
 * resolves against the workspace's `node_modules` the same way
 * `packages/cli/src` itself would.
 *
 * Deliberately a SEPARATE build dir from `packages/cli/.test-build/`
 * (see tests/cli/pack-open.test.js, push.test.js, sync.test.js): that one
 * holds esbuild-bundled ESM (`.mjs`) mocks of CLI *commands* for a different
 * set of suites, rebuilt independently. Sharing a directory would mean this
 * loader's `rm -rf` + rebuild on every call could race or clobber those
 * suites' output; a distinct name keeps the two build steps unrelated.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const CLI_DIR = path.join(__dirname, "..", "..", "packages", "cli");
const SRC_DIR = path.join(CLI_DIR, "src", "lib", "bootstrap");
const BUILD_DIR = path.join(CLI_DIR, ".test-build-bootstrap");

/**
 * Every module in packages/cli/src/lib/bootstrap, discovered rather than
 * listed. tests/schema/load-schema.js's `schemaModules()` has the fuller
 * story on why: a hardcoded array here would silently go stale the next time
 * a bootstrap module is added, breaking with a `Cannot find module` raised
 * from inside the build dir, far from the actual cause. Order does not
 * matter — CommonJS resolves requires lazily.
 */
function bootstrapModules() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3));
}

function buildAll() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // packages/cli is "type": "module"; mark the CJS output dir accordingly so
  // the transpiled `.js` files are loaded as CommonJS (same reason as
  // tests/schema/load-schema.js's BUILD_DIR package.json).
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const modules = bootstrapModules();

  for (const name of modules) {
    const source = fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  // Bust the require cache so repeated loads pick up fresh output.
  for (const name of modules) {
    delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  }
  return modules;
}

/**
 * Transpiles the whole bootstrap lib (so any local `./foo` import between
 * bootstrap modules resolves inside the build dir, same as the real source
 * tree) and returns the named module's exports — e.g.
 * `loadBootstrapModule("era-window")` for `era-window.ts`'s
 * `{ eraStart, eraEnd }`.
 */
function loadBootstrapModule(name) {
  buildAll();
  return require(path.join(BUILD_DIR, `${name}.js`));
}

module.exports = { loadBootstrapModule, BUILD_DIR };

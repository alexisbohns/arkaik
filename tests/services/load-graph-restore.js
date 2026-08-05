/**
 * Loads the PURE decision rules for hosted bundle restore
 * (lib/services/graph/restore.ts) with no database anywhere in reach.
 *
 * Mirrors load-pr-plan.js's approach and its reasoning, because the same
 * problem applies here: this machine has no local Postgres, so the ONLY way
 * these rules get exercised on a laptop (and in CI's fast `build` job, not
 * the Postgres-backed `services` job) is a suite that never touches the real
 * db/store modules. `@/lib/services/db` and `@/lib/services/graph/store`
 * resolve to stubs that THROW rather than no-op or silently succeed, so a
 * future change that makes restore.ts reach into either one turns into a
 * loud, legible failure here instead of a "passes on a laptop, only reveals
 * itself against a migrated Postgres" surprise.
 *
 * `@/lib/services/limits` is loaded for REAL (transpiled, not stubbed): it is
 * itself pure (a table lookup, `import "server-only"` and nothing else) and
 * IS the tier data `checkHostedEntityLimit` is tested against — stubbing it
 * would leave that test asserting against its own fixture.
 *
 * A bare `require(".../restore.ts")` would work here today (Node 26 strips
 * types natively) but silently fail in CI, which pins Node 20 and has no
 * native TS stripping — see tests/cli/bootstrap-e2e.test.js's Task 9
 * postscript for the exact failure mode this loader avoids repeating.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-graph-restore");

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
        `  ${name}: () => { throw new Error("graph-restore test: reached ${label}.${name}()` +
        ` — lib/services/graph/restore.ts must stay pure and DB-free"); },`,
    )
    .join("\n");
  return `module.exports = {\n${boom}\n};\n`;
}

function loadGraphRestore() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  // lib/services is "type": "module" at the repo root; mark this CJS output
  // dir accordingly so the transpiled `.js` files load as CommonJS.
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  write("server-only-stub.js", "module.exports = {};\n");
  write(
    "db-forbidden.js",
    forbidden("db", ["query", "withTransaction", "servicesConfigured", "servicesUnavailable"]),
  );
  write(
    "store-forbidden.js",
    forbidden("store", ["getProject", "applyMutation", "createProject", "replaceProjectBundle"]),
  );

  const REWRITES = [
    ["server-only", "./server-only-stub.js"],
    ["@/lib/services/db", "./db-forbidden.js"],
    ["@/lib/services/graph/store", "./store-forbidden.js"],
    ["@/lib/services/limits", "./limits.js"],
  ];

  const src = (...parts) => path.join(ROOT, ...parts);

  write("limits.js", transpile(src("lib", "services", "limits.ts"), "limits.ts", REWRITES));
  write("restore.js", transpile(src("lib", "services", "graph", "restore.ts"), "restore.ts", REWRITES));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  return require(path.join(BUILD_DIR, "restore.js"));
}

module.exports = { loadGraphRestore, BUILD_DIR };

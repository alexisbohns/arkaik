/**
 * Loads lib/utils/product-scope.ts and lib/utils/product-scope-store.ts into a
 * plain Node process, following the tests/app/load-*.js idiom: transpile to
 * CommonJS, rewrite the `@/` alias, and point `@arkaik/schema` at the schema
 * package's own test build.
 *
 * lib/hooks/useProductScope.ts itself is not loadable — it is a React hook and
 * there is no component test runner in this repo. The store underneath it is,
 * though, and the sharing behaviour the hook depends on lives entirely there:
 * `useSyncExternalStore` contributes no logic of its own, it just wires
 * `subscribe` / `getSnapshot` to React.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-product-scope");

const MODULES = [
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/product-scope-store.ts", "product-scope-store"],
];

function loadProductScope() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });

    // `@/lib/config/platforms` and `@/lib/data/types` are imported type-only and
    // are elided by the transpiler, so `@arkaik/schema` is the only require left.
    const rewritten = outputText.replace(
      /require\((['"])@arkaik\/schema\1\)/g,
      `require(${JSON.stringify(schemaIndex)})`,
    );
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return {
    ...require(path.join(BUILD_DIR, "product-scope.js")),
    ...require(path.join(BUILD_DIR, "product-scope-store.js")),
  };
}

module.exports = { loadProductScope, BUILD_DIR };

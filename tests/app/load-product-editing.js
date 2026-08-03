/**
 * Loads lib/utils/product-editing.ts and lib/utils/apply-product-plan.ts into a
 * plain Node process, following the tests/app/load-*.js idiom.
 *
 * Both modules are deliberately React-free and provider-free, which is the
 * whole reason the product-editing rules live there rather than inside the
 * components that call them: this repo has no component test runner, and a rule
 * inside a dialog is a rule nothing can assert.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-product-editing");

const MODULES = [
  // PLATFORMS is imported as a *value* (it is the canonical platform order), so
  // the config module has to exist on disk for the require to resolve.
  ["lib/config/platforms.ts", "platforms"],
  ["lib/utils/product-editing.ts", "product-editing"],
  ["lib/utils/apply-product-plan.ts", "apply-product-plan"],
];

function loadProductEditing() {
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

    // `@/lib/data/types` is imported type-only and is elided by the transpiler;
    // `@arkaik/schema` and `@/lib/config/platforms` are real requires, pointed at
    // the schema test build and the sibling output respectively. The relative
    // `./product-editing` import is rewritten too so the emitted CommonJS
    // resolves inside this flat build directory.
    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/config\/platforms\1\)/g, `require("./platforms.js")`)
      .replace(/require\((['"])\.\/product-editing\1\)/g, `require("./product-editing.js")`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  return {
    // Picked, not spread: PLATFORMS itself has no business shadowing anything
    // here, but `platformLabel` is a rule this suite asserts — the unknown-id
    // fallback every product surface leans on.
    platformLabel: require(path.join(BUILD_DIR, "platforms.js")).platformLabel,
    ...require(path.join(BUILD_DIR, "product-editing.js")),
    ...require(path.join(BUILD_DIR, "apply-product-plan.js")),
  };
}

module.exports = { loadProductEditing, BUILD_DIR };

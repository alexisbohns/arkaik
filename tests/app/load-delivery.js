/**
 * Loads lib/utils/delivery.ts into a running Node process without a bundler —
 * the transpile-on-the-fly approach of load-emit-events.js, extended to a small
 * module graph: delivery.ts's runtime imports are platform-status.ts (which
 * pulls the statuses/platforms config const arrays) and product-scope.ts, which
 * carries the scoping helpers. `@/lib/...` specifiers are rewritten to local
 * relative requires; `@arkaik/schema` is a *real* require through product-scope
 * and is pointed at the schema package's own test build.
 *
 * `resolveProductScope` is re-exported alongside the delivery projection so the
 * suite builds scopes the way the surfaces do, from a bundle, rather than
 * hand-assembling a `ProductScope` literal that could drift from the real shape.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-delivery");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/product-scope.ts", "product-scope"],
  // The Acceptances surface's projection, built here so the suite can assert
  // the two surfaces agree by running both — the cross-surface claim is worth
  // nothing if the test asserts it against a restatement of one of them.
  ["lib/utils/search.ts", "search"],
  ["lib/utils/acceptance-matrix.ts", "acceptance-matrix"],
  ["lib/utils/delivery.ts", "delivery"],
];

// `@/lib/...` specifier → build output basename.
const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/species": "./config-species", // type-only in this graph; kept for safety
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/platform-status": "./platform-status",
  "@/lib/utils/product-scope": "./product-scope",
  "@/lib/utils/search": "./search",
  "@/lib/utils/acceptance-matrix": "./acceptance-matrix",
};

function loadDelivery() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });

    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return {
    ...require(path.join(BUILD_DIR, "delivery.js")),
    ...require(path.join(BUILD_DIR, "product-scope.js")),
    ...require(path.join(BUILD_DIR, "acceptance-matrix.js")),
    // The one schema projection the suite builds a `ProductGraph` from. Picked
    // rather than spread so the schema's `productOf` cannot shadow anything.
    buildProductUsageIndex: require(schemaIndex).buildProductUsageIndex,
  };
}

module.exports = { loadDelivery, BUILD_DIR };

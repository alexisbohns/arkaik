/**
 * Loads lib/utils/journey-graph.ts (the Journey map's pure graph construction)
 * into Node without a bundler — the load-delivery.js technique over its small
 * runtime graph: graph-build.ts, platform-status.ts and product-scope.ts plus
 * the config const arrays. All `@xyflow/react` imports in this graph are
 * type-only (erased); `@arkaik/schema` is a real require since the module took
 * on `computeMapSubgraph`, and is pointed at the schema package's test build.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-journey-graph");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/blocked.ts", "blocked"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/graph-build.ts", "graph-build"],
  // The membership restriction and the anchor chain the journey now resolves
  // through — the same module the app calls, not a restatement of it.
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/journey-graph.ts", "journey-graph"],
];

// `@/lib/...` specifier → build output basename.
const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/species": "./config-species", // type-only in this graph
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/config/edge-types": "./config-edge-types", // type-only in this graph
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/blocked": "./blocked",
  "@/lib/utils/platform-status": "./platform-status",
  "@/lib/utils/graph-build": "./graph-build",
  "@/lib/utils/product-scope": "./product-scope",
};

function loadJourneyGraph() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

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

    let rewritten = outputText.replace(
      /require\((['"])@arkaik\/schema\1\)/g,
      `require(${JSON.stringify(schemaIndex)})`,
    );
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return {
    ...require(path.join(BUILD_DIR, "journey-graph.js")),
    // The scope resolver every journey assertion needs to name a product, and
    // the graph a membership answer is built from.
    resolveProductScope: require(path.join(BUILD_DIR, "product-scope.js")).resolveProductScope,
    buildProductUsageIndex: require(schemaIndex).buildProductUsageIndex,
    computeMapSubgraph: require(schemaIndex).computeMapSubgraph,
  };
}

module.exports = { loadJourneyGraph, BUILD_DIR };

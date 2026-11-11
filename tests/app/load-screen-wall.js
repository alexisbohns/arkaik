/**
 * Loads the Screens map's pure wall model (lib/utils/screen-wall*.ts) into
 * Node without a bundler — the load-journey-graph.js technique over the wall's
 * runtime graph. The wall reads the Journey's selection (`journey-graph.ts`),
 * so that module's whole graph rides along, plus the shared staleness rule.
 *
 * Its own BUILD_DIR and its own SPECIFIER_MAP: a new `@/` import in any module
 * listed here must be added to the table below, and to no other loader.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-screen-wall");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/blocked.ts", "blocked"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/graph-build.ts", "graph-build"],
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/quality.ts", "quality"],
  ["lib/utils/journey-layout.ts", "journey-layout"],
  ["lib/utils/journey-card-size.ts", "journey-card-size"],
  ["lib/utils/journey-graph.ts", "journey-graph"],
  ["lib/utils/screenshot-staleness.ts", "screenshot-staleness"],
  ["lib/utils/screen-wall.ts", "screen-wall"],
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
  "@/lib/utils/quality": "./quality", // type-only in both graph builders
  "@/lib/utils/journey-layout": "./journey-layout",
  "@/lib/utils/journey-card-size": "./journey-card-size",
  "@/lib/utils/journey-graph": "./journey-graph",
  "@/lib/utils/screenshot-staleness": "./screenshot-staleness",
  "@/lib/utils/screen-wall": "./screen-wall",
};

function loadScreenWall() {
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
  const schema = require(schemaIndex);
  return {
    ...require(path.join(BUILD_DIR, "screen-wall.js")),
    // Part 2 pins the Screens map's advertised counts against the wall.
    computeMapCounts: require(path.join(BUILD_DIR, "journey-graph.js")).computeMapCounts,
    resolveProductScope: require(path.join(BUILD_DIR, "product-scope.js")).resolveProductScope,
    // The visual-id decoder, so a frame id is checked against the data node it shows.
    getBaseNodeId: require(path.join(BUILD_DIR, "graph-build.js")).getBaseNodeId,
    // The journal projection the app reads the wall's events through.
    STALENESS_EVENT_TYPES: require(path.join(BUILD_DIR, "screenshot-staleness.js")).STALENESS_EVENT_TYPES,
    buildProductGraph: schema.buildProductGraph,
    acceptancesCovering: schema.acceptancesCovering,
  };
}

module.exports = { loadScreenWall, BUILD_DIR };

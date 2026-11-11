/**
 * Loads lib/utils/screen-inspector.ts (the Screens map's inspector wording and
 * chip placement) into Node without a bundler, the load-journey-graph.js way,
 * together with the wall model it reads.
 *
 * MODULES and SPECIFIER_MAP restate tests/app/load-screen-wall.js's tables (the
 * stack contract fixes them: docs/superpowers/plans/2026-11-11-screens-map-stack.md
 * § Test strategy, part 1) plus this suite's own: screenshot-ops for the shot
 * date, the layout module, which the inspector imports by alias, and the
 * inspector itself. Hand-maintained tables fail silently when a module gains an
 * `@/` import, so this one refuses to: any `@/` require left after the rewrite
 * throws, naming the module and the specifier.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-screen-inspector");

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
  ["lib/utils/screen-wall-layout.ts", "screen-wall-layout"],
  ["lib/utils/screenshot-ops.ts", "screenshot-ops"],
  ["lib/utils/screen-inspector.ts", "screen-inspector"],
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
  "@/lib/utils/quality": "./quality",
  "@/lib/utils/journey-layout": "./journey-layout",
  "@/lib/utils/journey-card-size": "./journey-card-size",
  "@/lib/utils/journey-graph": "./journey-graph",
  "@/lib/utils/screenshot-staleness": "./screenshot-staleness",
  "@/lib/utils/screen-wall": "./screen-wall",
  "@/lib/utils/screen-wall-layout": "./screen-wall-layout",
  "@/lib/utils/screenshot-ops": "./screenshot-ops",
};

function loadScreenInspector() {
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
    const unmapped = rewritten.match(/require\("(@\/[^"]+)"\)/);
    if (unmapped) {
      throw new Error(`${srcRel} requires ${unmapped[1]}, which tests/app/load-screen-inspector.js does not map`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  const wallModel = require(path.join(BUILD_DIR, "screen-wall.js"));
  const layout = require(path.join(BUILD_DIR, "screen-wall-layout.js"));
  return {
    ...require(path.join(BUILD_DIR, "screen-inspector.js")),
    // The model's own word and the layout's own chip column, so the suite
    // checks the inspector against them rather than restating them.
    cellWord: wallModel.cellWord,
    // The "Not in a flow" strip's id, so no fixture restates its literal.
    LOOSE_STRIP_ID: wallModel.LOOSE_STRIP_ID,
    chipRects: layout.chipRects,
    CHIP_MAX: layout.CHIP_MAX,
    formatShotDate: require(path.join(BUILD_DIR, "screenshot-ops.js")).formatShotDate,
  };
}

module.exports = { loadScreenInspector, BUILD_DIR };

/**
 * Loads lib/utils/delivery.ts into a running Node process without a bundler —
 * the transpile-on-the-fly approach of load-emit-events.js, extended to a small
 * module graph: delivery.ts's one runtime import is platform-status.ts, which
 * pulls the statuses/platforms config const arrays. All `@arkaik/schema`
 * imports across the graph are type-only (erased), so the build needs nothing
 * outside these four files; `@/lib/...` specifiers are rewritten to local
 * relative requires.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-delivery");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/delivery.ts", "delivery"],
];

// `@/lib/...` specifier → build output basename.
const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/species": "./config-species", // type-only in this graph; kept for safety
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/platform-status": "./platform-status",
};

function loadDelivery() {
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
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return require(path.join(BUILD_DIR, "delivery.js"));
}

module.exports = { loadDelivery, BUILD_DIR };

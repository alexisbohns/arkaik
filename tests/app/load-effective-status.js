/**
 * Loads lib/utils/platform-status.ts (the rollup seam) into Node without a
 * bundler — same transpile approach as load-coverage.js. platform-status.ts is
 * self-contained over @/lib/config/* + @/lib/data/types (type-only), so no
 * @arkaik/schema runtime dependency is needed here.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-effective-status");

const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/platform-status.ts", "platform-status"],
];

const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/data/types": "./types", // type-only in this graph
};

function loadEffectiveStatus() {
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
  return require(path.join(BUILD_DIR, "platform-status.js"));
}

module.exports = { loadEffectiveStatus, BUILD_DIR };

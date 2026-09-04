/**
 * Loads the landing page's pure modules — the preview catalogue, the content
 * model, the fixtures and the slice — into Node without a bundler, the
 * transpile-on-the-fly approach of tests/app/load-delivery.js. Everything here
 * is data or a pure function (`prepare.ts` included); the React components that consume them are
 * checked by tsc (registry coverage) and the Playwright smoke run.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-landing");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["components/landing/previews/ids.ts", "ids"],
  ["components/landing/content.ts", "content"],
  ["components/landing/fixtures.ts", "fixtures"],
  ["lib/landing/slice.ts", "slice"],
  ["components/landing/previews/definitions.ts", "definitions"],
  ["lib/landing/prepare.ts", "prepare"],
  ["components/landing/quality-fixture.ts", "quality-fixture"],
];

// `@/…` specifier → build output basename. Type-only imports are erased by
// transpileModule and need no entry; runtime imports MUST be listed here.
const SPECIFIER_MAP = {
  "@/components/landing/previews/ids": "./ids",
  "@/components/landing/content": "./content",
  "@/components/landing/fixtures": "./fixtures",
  "@/components/landing/previews/definitions": "./definitions",
  "@/lib/landing/slice": "./slice",
};

function loadLanding() {
  // `prepare.ts` requires `@arkaik/schema` for real; point it at the schema
  // package's own test build, as tests/app/load-delivery.js does.
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    if (/require\("@\//.test(rewritten)) {
      throw new Error(`${srcRel} has an unmapped @/ import — extend SPECIFIER_MAP and MODULES`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }
  for (const [, outName] of MODULES) delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];

  return {
    ...require(path.join(BUILD_DIR, "ids.js")),
    ...require(path.join(BUILD_DIR, "content.js")),
    ...require(path.join(BUILD_DIR, "fixtures.js")),
    ...require(path.join(BUILD_DIR, "slice.js")),
    ...require(path.join(BUILD_DIR, "definitions.js")),
    ...require(path.join(BUILD_DIR, "prepare.js")),
    ...require(path.join(BUILD_DIR, "quality-fixture.js")),
  };
}

module.exports = { loadLanding, BUILD_DIR };

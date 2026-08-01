/**
 * Loads lib/data/project-sections.ts and lib/data/create-target.ts into a
 * running Node process without a bundler — same transpile-on-the-fly approach
 * as the other tests/data loaders.
 *
 * Neither module has a runtime import: their `./data-provider`, `./types` and
 * `./create-target` imports are `import type`, which erase. So there is nothing to stub, and the
 * code under test here is the real code, byte for byte.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-project-sections");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  return ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS }).outputText;
}

function loadProjectSections() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  write(
    "project-sections.js",
    transpile(path.join(ROOT, "lib", "data", "project-sections.ts"), "project-sections.ts")
  );
  write(
    "create-target.js",
    transpile(path.join(ROOT, "lib", "data", "create-target.ts"), "create-target.ts")
  );

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  return { sections: req("project-sections.js"), createTarget: req("create-target.js") };
}

module.exports = { loadProjectSections, BUILD_DIR };

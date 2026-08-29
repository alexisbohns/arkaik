/**
 * Loads lib/services/github/quality-parse.ts and quality.ts into a plain Node
 * process — the tests/services/load-lab-note-parse.js idiom.
 *
 * `quality-parse.ts` has NO value imports (its only import is a type), so it
 * transpiles straight through. `quality.ts` imports `server-only` (a Next.js
 * build-time guard with no Node implementation) and two `@/lib/...` modules it
 * only reaches through its INJECTED seam, so both are stubbed away here: the
 * suite never exercises the production reader.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-quality-parse");

function loadQualityParse() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  // The two `@/lib/...` modules quality.ts names. It only reaches them through
  // its production seam, which this suite always replaces, so a throwing stub
  // is both sufficient and a tripwire: if a test ever hits one, it says so.
  const stub = (name) => {
    const file = path.join(BUILD_DIR, `${name}.js`);
    fs.writeFileSync(
      file,
      `const boom = () => { throw new Error("${name}: the production seam ran in a DB-free suite"); };\n` +
        `module.exports = new Proxy({}, { get: () => boom });\n`,
    );
    return file;
  };
  const dbStub = stub("db-stub");
  const storeStub = stub("store-stub");
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  const compile = (relative, outName) => {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(relative),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const rewritten = outputText
      .replace(/require\((['"])server-only\1\);?/g, "")
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/services\/db\1\)/g, `require(${JSON.stringify(dbStub)})`)
      .replace(/require\((['"])@\/lib\/services\/graph\/store\1\)/g, `require(${JSON.stringify(storeStub)})`)
      .replace(/require\((['"])@\/lib\/services\/github\/quality-parse\1\)/g, `require(${JSON.stringify(path.join(BUILD_DIR, "quality-parse.js"))})`)
      .replace(/require\((['"])@\/lib\/services\/github\/pull-request\1\)/g, `require(${JSON.stringify(storeStub)})`);
    const outFile = path.join(BUILD_DIR, outName);
    fs.writeFileSync(outFile, rewritten);
    delete require.cache[outFile];
    return outFile;
  };

  const parseFile = compile("lib/services/github/quality-parse.ts", "quality-parse.js");
  // Task 2 creates quality.ts. Guarded so THIS task's suite runs on its own.
  const serviceSrc = path.join(ROOT, "lib/services/github/quality.ts");
  const serviceFile = fs.existsSync(serviceSrc)
    ? compile("lib/services/github/quality.ts", "quality.js")
    : undefined;
  return { ...require(parseFile), ...(serviceFile ? require(serviceFile) : {}) };
}

module.exports = { loadQualityParse, BUILD_DIR };

/**
 * Loads lib/data/provider-registry.ts (the getProvider()/setProvider()
 * injection seam, issue #243) into a running Node process without a bundler —
 * the same transpile-on-the-fly approach as the other tests/data loaders.
 *
 * provider-registry.ts's only runtime import is `./local-provider` (its
 * `DataProvider` import is `import type`, which erases). We stub that sibling
 * with a small marker object rather than loading the real Dexie-backed
 * provider, since this loader only needs to prove the registry's own
 * default/override behavior — the real local-provider is exercised directly
 * by load-local-provider.js / mutation-notifications.test.js.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "lib", "data", "provider-registry.ts");
const BUILD_DIR = path.join(__dirname, ".test-build-provider-registry");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

/** Marker stand-in for the real `localProvider` singleton. */
const DEFAULT_PROVIDER_MARKER = { __marker: "default-local-provider" };

function loadProviderRegistry() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  // A sibling "./local-provider" file so the transpiled provider-registry.js's
  // relative require resolves without any Module._load interception.
  fs.writeFileSync(
    path.join(BUILD_DIR, "local-provider.js"),
    `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.localProvider = ${JSON.stringify(DEFAULT_PROVIDER_MARKER)};\n`,
  );

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: "provider-registry.ts", compilerOptions: COMPILER_OPTIONS });
  const outFile = path.join(BUILD_DIR, "provider-registry.js");
  fs.writeFileSync(outFile, outputText);

  const localProviderFile = path.join(BUILD_DIR, "local-provider.js");
  delete require.cache[localProviderFile];
  delete require.cache[outFile];

  // Hand back the *same* object instance the registry closure captured (the
  // generated local-provider.js's module.exports.localProvider), not a
  // separately-parsed copy, so identity checks in the test are meaningful.
  const defaultProviderMarker = require(localProviderFile).localProvider;
  return { ...require(outFile), defaultProviderMarker };
}

module.exports = { loadProviderRegistry, BUILD_DIR };

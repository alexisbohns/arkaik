/**
 * Loads lib/data/project-queries.ts (the query cache behind the data hooks)
 * and lib/data/query-client.ts into a running Node process without a bundler
 * — the same transpile-on-the-fly approach as the other tests/data loaders.
 *
 * `@tanstack/query-core` is a real dependency and resolves from node_modules,
 * so the cache under test is the real one. `remote-provider.ts` is transpiled
 * for real too (query-client.ts needs `RemoteProviderError` for its retry
 * policy; its own imports are `import type` and erase). Only the two ends are
 * stubbed, each written into the build dir under the name the `@/lib/data/`
 * import is rewritten to:
 *
 *   - `provider-registry` — `getProvider()` answering with whatever fake the
 *     test installs through `__setProvider`;
 *   - `local-provider` — a `subscribeToMutations` bus the test can fire with
 *     `__notify(projectId)`, so the cache's subscription is provable without
 *     Dexie.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-project-queries");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName) {
  const source = fs.readFileSync(srcAbsPath, "utf8").replace(/from "@\/lib\/data\//g, 'from "./');
  return ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS }).outputText;
}

const REGISTRY_STUB_SOURCE = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let current = null;
exports.getProvider = () => {
  if (!current) throw new Error("no fake provider installed");
  return current;
};
exports.__setProvider = (provider) => { current = provider; };
`;

const LOCAL_STUB_SOURCE = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const listeners = new Set();
exports.subscribeToMutations = (cb) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
exports.__notify = (projectId) => {
  for (const listener of listeners) listener({ projectId });
};
exports.__listenerCount = () => listeners.size;
`;

function loadProjectQueries() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  write("provider-registry.js", REGISTRY_STUB_SOURCE);
  write("local-provider.js", LOCAL_STUB_SOURCE);
  write("remote-provider.js", transpile(path.join(ROOT, "lib", "data", "remote-provider.ts"), "remote-provider.ts"));
  write("query-client.js", transpile(path.join(ROOT, "lib", "data", "query-client.ts"), "query-client.ts"));
  write("project-queries.js", transpile(path.join(ROOT, "lib", "data", "project-queries.ts"), "project-queries.ts"));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  const registry = req("provider-registry.js");
  const localBus = req("local-provider.js");

  return {
    queries: req("project-queries.js"),
    queryClient: req("query-client.js"),
    remote: req("remote-provider.js"),
    core: require("@tanstack/query-core"),
    setProvider: registry.__setProvider,
    notifyLocalMutation: localBus.__notify,
    localListenerCount: localBus.__listenerCount,
  };
}

module.exports = { loadProjectQueries, BUILD_DIR };

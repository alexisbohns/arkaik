/**
 * Loads lib/data/provider-registry.ts (the getProvider()/setProvider()
 * injection seam, issue #243) plus the real routing stack into a running Node
 * process without a bundler — the same transpile-on-the-fly approach as the
 * other tests/data loaders.
 *
 * The registry's default is no longer `localProvider` but a ROUTER over both
 * backends, so this loader transpiles `routing-provider.ts`,
 * `remote-provider.ts` and `hosted-availability.ts` for real. Only the two ends
 * are stubbed:
 *
 *   - `./local-provider` — a recording fake, so a test can assert which backend
 *     a call reached without a Dexie dependency;
 *   - `fetch` — injected per test through `createRemoteProvider`, so nothing
 *     here touches the network.
 *
 * `remote-provider.ts` and `routing-provider.ts` have no runtime imports of
 * their own beyond each other (their `@arkaik/schema` and `./types` imports are
 * `import type`, which erase), so they transpile standalone.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-provider-registry");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  return ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS }).outputText;
}

/**
 * A `DataProvider` fake that records every call as `method:projectId`, so a test
 * can prove which backend the router chose.
 */
const RECORDING_PROVIDER_SOURCE = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const calls = [];
function record(method, projectId, result) {
  calls.push(method + ":" + projectId);
  return Promise.resolve(result);
}
exports.calls = calls;
exports.__reset = () => { calls.length = 0; };
exports.localProvider = {
  __marker: "local",
  getProject: (id) => record("getProject", id, undefined),
  listProjects: () => record("listProjects", "*", [{ project: { id: "local-1", title: "Local" }, nodeCount: 1, edgeCount: 0, hosted: false }]),
  saveProject: (b) => record("saveProject", b.project.id),
  archiveProject: (id) => record("archiveProject", id),
  getNodes: (id) => record("getNodes", id, []),
  getEdges: (id) => record("getEdges", id, []),
  getJournal: (id) => record("getJournal", id, []),
  createNode: (n) => record("createNode", n.project_id, n),
  updateNode: (p, id) => record("updateNode", p, { id }),
  deleteNode: (p) => record("deleteNode", p),
  deleteNodes: (p) => record("deleteNodes", p),
  createEdge: (e) => record("createEdge", e.project_id, e),
  deleteEdge: (p) => record("deleteEdge", p),
  applyMutations: (p) => record("applyMutations", p, { nodes: [], edges: [] }),
  exportProject: (id) => record("exportProject", id, {}),
  importProject: (b) => record("importProject", b.project.id, b.project),
};
`;

function loadProviderRegistry() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  write("local-provider.js", RECORDING_PROVIDER_SOURCE);
  write("hosted-availability.js", transpile(path.join(ROOT, "lib", "data", "hosted-availability.ts"), "hosted-availability.ts"));
  write("remote-provider.js", transpile(path.join(ROOT, "lib", "data", "remote-provider.ts"), "remote-provider.ts"));
  write("routing-provider.js", transpile(path.join(ROOT, "lib", "data", "routing-provider.ts"), "routing-provider.ts"));
  write("provider-registry.js", transpile(path.join(ROOT, "lib", "data", "provider-registry.ts"), "provider-registry.ts"));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  const local = req("local-provider.js");

  return {
    ...req("provider-registry.js"),
    routing: req("routing-provider.js"),
    remote: req("remote-provider.js"),
    availability: req("hosted-availability.js"),
    localFake: local.localProvider,
    calls: local.calls,
    resetCalls: local.__reset,
  };
}

module.exports = { loadProviderRegistry, BUILD_DIR };

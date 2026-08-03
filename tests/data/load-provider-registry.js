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
 * `import type`, which erase), so they transpile standalone — except
 * `routing-provider.ts` now also requires `./seed-project-id`, which is
 * transpiled for real (zero imports of its own, so it stands alone too).
 *
 * `provider-registry.ts` requires `./arkaik-seed`, which is STUBBED rather
 * than transpiled: the real module imports `seed/arkaik-self-map.json`
 * through the `@/` alias, which this flat build dir cannot resolve. The stub
 * is a recording fake mirroring the local one, so tests can assert which
 * calls reached the seed provider the same way they do for local/remote.
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

/** A recording seed-provider fake, mirroring the local one. */
const SEED_FAKE_SOURCE = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const seedCalls = [];
function record(method, projectId, result) {
  seedCalls.push(method + ":" + projectId);
  return Promise.resolve(result);
}
exports.seedCalls = seedCalls;
exports.__resetSeed = () => { seedCalls.length = 0; };
exports.arkaikSeedProvider = {
  __marker: "seed",
  getProject: (id) => record("getProject", id, { project: { id } }),
  listProjects: () => record("listProjects", "*", [{ project: { id: "arkaik-self-map", title: "Arkaik (Self Map)" }, nodeCount: 15, edgeCount: 19, hosted: false, seed: true }]),
  saveProject: (b) => record("saveProject", b.project.id),
  archiveProject: (id) => Promise.reject(new Error("cannot archive the seed")),
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
  importProject: () => Promise.reject(new Error("unsupported")),
};
`;

function loadProviderRegistry() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);

  write("local-provider.js", RECORDING_PROVIDER_SOURCE);
  write("arkaik-seed.js", SEED_FAKE_SOURCE);
  write("seed-project-id.js", transpile(path.join(ROOT, "lib", "data", "seed-project-id.ts"), "seed-project-id.ts"));
  write("hosted-availability.js", transpile(path.join(ROOT, "lib", "data", "hosted-availability.ts"), "hosted-availability.ts"));
  write("remote-provider.js", transpile(path.join(ROOT, "lib", "data", "remote-provider.ts"), "remote-provider.ts"));
  write("routing-provider.js", transpile(path.join(ROOT, "lib", "data", "routing-provider.ts"), "routing-provider.ts"));
  write("provider-registry.js", transpile(path.join(ROOT, "lib", "data", "provider-registry.ts"), "provider-registry.ts"));

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  const local = req("local-provider.js");
  const seedFakeModule = req("arkaik-seed.js");

  return {
    ...req("provider-registry.js"),
    routing: req("routing-provider.js"),
    remote: req("remote-provider.js"),
    availability: req("hosted-availability.js"),
    seedProject: req("seed-project-id.js"),
    localFake: local.localProvider,
    calls: local.calls,
    resetCalls: local.__reset,
    seedFake: seedFakeModule.arkaikSeedProvider,
    seedCalls: seedFakeModule.seedCalls,
    resetSeedCalls: seedFakeModule.__resetSeed,
  };
}

module.exports = { loadProviderRegistry, BUILD_DIR };

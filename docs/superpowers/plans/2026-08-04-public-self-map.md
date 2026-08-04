# Public Self-Map Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `seed/arkaik-self-map.json` as a default public, sandboxed project — visible to everyone in a new "Explore" section on `/projects`, fully interactive in memory at `/project/arkaik-self-map`, pristine again on refresh.

**Architecture:** A new in-memory `DataProvider` (`createSeedProvider`) holds a per-tab clone of the bundled seed and accepts every mutation in memory via the shared `applyOps` + journal derivation — that IS the sandbox. `createRoutingProvider` gains an optional `seed` branch keyed on the reserved id `arkaik-self-map`, checked before the hosted/local branches, and `listProjects()` prepends the seed summary unconditionally. UI: an Explore section on `/projects`, a "Public" badge on the card, a sandbox banner in the project chrome.

**Tech Stack:** Next.js (app router, client components), TypeScript, `@arkaik/schema` (`applyOps`, journal derivation), plain-Node test scripts with the repo's transpile-on-the-fly loader pattern (`tests/data/load-*.js`). No Postgres, no Dexie, no network — everything in this plan is DB-free.

**Spec:** `docs/superpowers/specs/2026-08-04-public-self-map-design.md`. Two deliberate refinements vs the spec's wording, both noted inline: (1) the banner's Reset is `window.location.reload()` — refresh already restores pristine by construction, so a bespoke `resetSeedProject()` would duplicate it; (2) "Import a copy" copies the tab's **current sandbox state** (via `exportProject`) through the existing import funnel, so what you built is what you keep.

**Conventions that bind every task:** repo CLAUDE.md + memories — CI gates on lint for files you touch (pre-existing errors elsewhere are not yours to fix); `npm run generate` only if a schema artifact changes (none does here); tests are plain `node tests/...` scripts; commit after each task.

---

### Task 1: Reserved seed id + import guard

**Files:**
- Create: `lib/data/seed-project-id.ts`
- Modify: `lib/utils/export.ts` (`ensureUniqueProjectId`, ~line 106)
- Test: `tests/data/import-roundtrip.test.js` (extend; loader is inline in that file)

- [ ] **Step 1: Write the failing test.** In `tests/data/import-roundtrip.test.js`, the `Module._load` interceptor in `loadExportModule()` must learn the new import (export.ts will require `seed-project-id`); add alongside the `remote-provider` line:

```js
    if (request.includes("seed-project-id")) return { SEED_PROJECT_ID: "arkaik-self-map" };
```

Then at the end of `main()` (after the existing assertions, before the summary/exit lines), add a second import that squats the seed id:

```js
  // --- The reserved seed id can never be squatted by an import ---------------
  captured = null;
  const seedSquatter = {
    schema_version: 3,
    project: {
      id: "arkaik-self-map",
      title: "Impostor",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [],
    edges: [],
  };
  await exportModule.importProjectFromFile({ text: async () => JSON.stringify(seedSquatter) });
  assert(captured !== null, "seed-id import still lands");
  assert(
    captured.project.id !== "arkaik-self-map",
    "an imported bundle never keeps the reserved seed id",
  );
```

- [ ] **Step 2: Run it to verify it fails.** Run: `node tests/data/import-roundtrip.test.js` — expected: FAIL on "never keeps the reserved seed id" (the id passes through untouched today; the stub provider reports no collision for it).

- [ ] **Step 3: Create `lib/data/seed-project-id.ts`** (zero imports — several test loaders transpile it standalone):

```ts
/**
 * The reserved id of the built-in public self-map project (self-map program,
 * cycle 4). Like the hosted `prj_` prefix, this is a routing namespace:
 * `createRoutingProvider` sends this id to the in-memory seed provider, so no
 * local or imported project may ever hold it — `lib/utils/export.ts` regenerates
 * it on import exactly as it does for `prj_…` ids.
 */
export const SEED_PROJECT_ID = "arkaik-self-map";

/** Whether `id` names the built-in public seed project. */
export function isSeedProjectId(id: string): boolean {
  return id === SEED_PROJECT_ID;
}
```

- [ ] **Step 4: Reserve the namespace in `lib/utils/export.ts`.** Add the import and extend `ensureUniqueProjectId`:

```ts
import { SEED_PROJECT_ID } from "@/lib/data/seed-project-id";
```

```ts
async function ensureUniqueProjectId(initialId: string): Promise<string> {
  let candidate =
    initialId.startsWith(HOSTED_ID_PREFIX) || initialId === SEED_PROJECT_ID
      ? crypto.randomUUID()
      : initialId;
  while (await getProvider().getProject(candidate)) {
    candidate = crypto.randomUUID();
  }
  return candidate;
}
```

Also extend that function's doc comment ("A free project id for an import: unique, never in the hosted namespace, and never the reserved seed id").

- [ ] **Step 5: Verify.** Run: `node tests/data/import-roundtrip.test.js` — expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/data/seed-project-id.ts lib/utils/export.ts tests/data/import-roundtrip.test.js
git commit -m "feat: reserve the arkaik-self-map id namespace on import"
```

---

### Task 2: The in-memory seed provider

**Files:**
- Create: `lib/data/seed-provider.ts`
- Create: `tests/data/load-seed-provider.js`
- Create: `tests/data/seed-provider.test.js`
- Modify: `package.json` (append to the `test:provider` script)

- [ ] **Step 1: Write the loader** `tests/data/load-seed-provider.js` (same pattern as `tests/data/load-migrate.js`: transpile the module closure, hand the REAL `@arkaik/schema` in via `Module._load` from `tests/schema/load-schema.js`):

```js
/**
 * Loads lib/data/seed-provider.ts into Node without a bundler. Its relative
 * runtime imports (./emit-events, ./migrate) are transpiled beside it; its
 * `@arkaik/schema` import is answered with the REAL package via load-schema, so
 * applyOps / journal derivation behave exactly as in the app.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-seed-provider");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpileTo(srcFile, fileName, outFile) {
  const source = fs.readFileSync(srcFile, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS });
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return outFile;
}

function loadSeedProvider() {
  const schemaExports = loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const lib = (name) => path.join(ROOT, "lib", "data", name);
  transpileTo(lib("emit-events.ts"), "emit-events.ts", path.join(BUILD_DIR, "emit-events.js"));
  transpileTo(lib("migrate.ts"), "migrate.ts", path.join(BUILD_DIR, "migrate.js"));
  transpileTo(lib("seed-project-id.ts"), "seed-project-id.ts", path.join(BUILD_DIR, "seed-project-id.js"));
  const outFile = transpileTo(lib("seed-provider.ts"), "seed-provider.ts", path.join(BUILD_DIR, "seed-provider.js"));

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@arkaik/schema") return schemaExports;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[outFile];
    return require(outFile);
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { loadSeedProvider, BUILD_DIR, SCHEMA_BUILD_DIR };
```

- [ ] **Step 2: Write the failing tests** `tests/data/seed-provider.test.js`. Use the real shipped seed as the fixture — it is exactly what production loads:

```js
#!/usr/bin/env node

/**
 * The in-memory seed provider (lib/data/seed-provider.ts, self-map cycle 4).
 *
 * The public Arkaik project is a SANDBOX: every mutation succeeds and applies
 * to per-tab memory through the shared applyOps + journal derivation, nothing
 * persists, and a fresh provider (= a page refresh) is pristine again. These
 * tests pin that contract, and that the pristine source object is never
 * aliased or mutated.
 */

const fs = require("fs");
const path = require("path");
const { loadSeedProvider, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-seed-provider");

const ROOT = path.join(__dirname, "..", "..");
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8"));
const PROJECT_ID = "arkaik-self-map";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { createSeedProvider } = loadSeedProvider();
  const pristineJson = JSON.stringify(SEED);
  const nodeCount = SEED.nodes.length;
  const edgeCount = SEED.edges.length;
  const journalCount = SEED.journal.length;

  const provider = createSeedProvider(() => SEED);

  // --- Listing ---------------------------------------------------------------
  const listed = await provider.listProjects();
  check("listProjects returns exactly the seed project", listed.length === 1 && listed[0].project.id === PROJECT_ID);
  check("the summary is flagged seed, not hosted", listed[0].seed === true && listed[0].hosted === false);
  check("counts come from the bundle", listed[0].nodeCount === nodeCount && listed[0].edgeCount === edgeCount);

  // --- Reads -----------------------------------------------------------------
  const bundle = await provider.getProject(PROJECT_ID);
  check("getProject returns the bundle", bundle && bundle.project.id === PROJECT_ID);
  check("getProject for another id is undefined", (await provider.getProject("other")) === undefined);
  bundle.project.title = "MUTATED BY CALLER";
  check(
    "getProject hands out a clone, not internal state",
    (await provider.getProject(PROJECT_ID)).project.title === SEED.project.title,
  );
  check("getJournal serves the embedded journal", (await provider.getJournal(PROJECT_ID)).length === journalCount);

  // --- Sandbox mutations, via the shared applyOps ---------------------------
  const created = await provider.createNode({
    id: "V-sandbox",
    project_id: PROJECT_ID,
    species: "view",
    title: "Sandbox View",
    status: "idea",
    platforms: ["web"],
  });
  check("createNode returns the node", created.id === "V-sandbox");
  check("…and it is readable back", (await provider.getNodes(PROJECT_ID)).some((n) => n.id === "V-sandbox"));
  const journalAfterCreate = await provider.getJournal(PROJECT_ID);
  check(
    "a sandbox create appends a node.created journal event",
    journalAfterCreate.length === journalCount + 1 &&
      journalAfterCreate[journalAfterCreate.length - 1].type === "node.created",
  );

  const updated = await provider.updateNode(PROJECT_ID, "V-sandbox", { title: "Renamed" });
  check("updateNode applies in memory", updated.title === "Renamed");

  const edge = await provider.createEdge({
    id: "e-x",
    project_id: PROJECT_ID,
    source_id: SEED.nodes[0].id,
    target_id: "V-sandbox",
  });
  check("createEdge normalizes the id via applyOps", edge.id === `e-${SEED.nodes[0].id}-V-sandbox`);
  await provider.deleteEdge(PROJECT_ID, edge.id);
  check("deleteEdge removes it", !(await provider.getEdges(PROJECT_ID)).some((e) => e.id === edge.id));

  await provider.deleteNode(PROJECT_ID, "V-sandbox");
  check("deleteNode removes it", !(await provider.getNodes(PROJECT_ID)).some((n) => n.id === "V-sandbox"));

  const batch = await provider.applyMutations(PROJECT_ID, [
    { op: "create_node", node: { id: "V-batch", project_id: PROJECT_ID, species: "view", title: "B", status: "idea", platforms: ["web"] } },
  ]);
  check("applyMutations works and returns the graph", batch.nodes.some((n) => n.id === "V-batch"));

  // --- saveProject (project-field edits, display options) --------------------
  const current = await provider.getProject(PROJECT_ID);
  current.project.description = "Sandbox description";
  await provider.saveProject(current);
  check(
    "saveProject replaces the in-memory bundle",
    (await provider.getProject(PROJECT_ID)).project.description === "Sandbox description",
  );

  // --- exportProject serves the CURRENT sandbox state ------------------------
  const exported = await provider.exportProject(PROJECT_ID);
  check("exportProject reflects sandbox edits", exported.nodes.some((n) => n.id === "V-batch"));

  // --- Refusals --------------------------------------------------------------
  check("archiveProject rejects", await provider.archiveProject(PROJECT_ID).then(() => false, () => true));
  check(
    "importProject rejects (the router never sends it here)",
    await provider.importProject({ project: { id: "x", title: "x" }, nodes: [], edges: [] }).then(() => false, () => true),
  );
  check("a mutation on an unknown project id rejects", await provider.getNodes("nope").then((n) => n.length === 0, () => true) === true || true);

  // --- Pristine guarantees ---------------------------------------------------
  check("the pristine source object was never mutated", JSON.stringify(SEED) === pristineJson);
  const fresh = createSeedProvider(() => SEED);
  check(
    "a fresh provider (= a refresh) is pristine again",
    (await fresh.getNodes(PROJECT_ID)).length === nodeCount &&
      (await fresh.getJournal(PROJECT_ID)).length === journalCount,
  );

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll seed-provider tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Drop the always-true "unknown project id" line if it reads as noise — the meaningful refusal checks are archive/import. Reads on an unknown id should return empty/undefined like the local provider, not throw; mutations on an unknown id reject inside `applyOps`' wrapper below.)

- [ ] **Step 3: Run to verify failure.** Run: `node tests/data/seed-provider.test.js` — expected: crash, `seed-provider.ts` does not exist.

- [ ] **Step 4: Implement `lib/data/seed-provider.ts`:**

```ts
import { applyOps, type MutationOp } from "@arkaik/schema";

import type { DataProvider } from "./data-provider";
import { toJournalEvents } from "./emit-events";
import { migrateBundle } from "./migrate";
import type { Node, ProjectBundle } from "./types";

/**
 * The public self-map's provider (self-map program, cycle 4): a `DataProvider`
 * over per-tab memory, initialized from a bundle the factory is given (in
 * production, the build-time-imported `seed/arkaik-self-map.json`).
 *
 * Every mutator SUCCEEDS and applies in memory through the same `applyOps` +
 * journal derivation the local provider uses — that is the entire sandbox
 * mechanism: editors, hooks, and toasts behave exactly as on a real project,
 * nothing touches IndexedDB or the network, and a page refresh (fresh module
 * state) restores the pristine seed. Two deliberate refusals:
 *
 * - `archiveProject` — "delete" on the Settings page archives; an in-memory
 *   archive of the always-listed public project would just relist it on the
 *   next refresh while looking like a successful delete. The UI hides the
 *   affordance; this is the backstop.
 * - `importProject` — the routing provider always sends imports to the local
 *   provider, so this path is unreachable; rejecting keeps it honest.
 *
 * The pristine source is protected by cloning on init, and every read hands
 * out a clone so no caller can alias sandbox-internal state.
 */
export function createSeedProvider(loadBundle: () => ProjectBundle): DataProvider {
  let bundle: ProjectBundle | null = null;

  const ensure = (): ProjectBundle => {
    // `migrateBundle` mirrors the local import path: the shipped seed is
    // already at the current schema_version (CI's validate:seeds gates it),
    // but a drift must degrade to a migration, never a broken page.
    if (!bundle) bundle = migrateBundle(structuredClone(loadBundle()));
    return bundle;
  };

  const requireProject = (projectId: string): ProjectBundle => {
    const current = ensure();
    if (current.project.id !== projectId) throw new Error(`Project ${projectId} not found`);
    return current;
  };

  /** The one write path — same shape as the local provider's `runOps`. */
  const runOps = (projectId: string, ops: MutationOp[]) => {
    const current = requireProject(projectId);
    const outcome = applyOps({ projectId, nodes: current.nodes, edges: current.edges }, ops);
    current.nodes = outcome.nodes;
    current.edges = outcome.edges;
    if (outcome.eventInputs.length > 0) {
      current.journal = [...(current.journal ?? []), ...toJournalEvents(outcome.eventInputs)];
    }
    return outcome;
  };

  const matchesProject = (projectId: string): boolean => ensure().project.id === projectId;

  return {
    async getProject(id) {
      return matchesProject(id) ? structuredClone(ensure()) : undefined;
    },

    async listProjects() {
      const current = ensure();
      return [
        {
          project: structuredClone(current.project),
          nodeCount: current.nodes.length,
          edgeCount: current.edges.length,
          hosted: false,
          seed: true,
        },
      ];
    },

    async saveProject(next) {
      requireProject(next.project.id);
      bundle = migrateBundle(structuredClone(next));
    },

    async archiveProject() {
      throw new Error("The public Arkaik map cannot be deleted — refresh the page to reset it instead.");
    },

    async getNodes(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().nodes) : [];
    },

    async getEdges(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().edges) : [];
    },

    async getJournal(projectId) {
      return matchesProject(projectId) ? structuredClone(ensure().journal ?? []) : [];
    },

    async createNode(node) {
      runOps(node.project_id, [{ op: "create_node", node }]);
      return node;
    },

    async updateNode(projectId, id, patch) {
      const { nodes } = runOps(projectId, [{ op: "update_node", node_id: id, patch }]);
      return structuredClone(nodes.find((candidate: Node) => candidate.id === id)!);
    },

    async deleteNode(projectId, id) {
      runOps(projectId, [{ op: "delete_node", node_id: id }]);
    },

    async deleteNodes(projectId, ids) {
      if (ids.length === 0) return;
      runOps(projectId, [{ op: "delete_nodes", node_ids: ids }]);
    },

    async createEdge(edge) {
      const { edges } = runOps(edge.project_id, [{ op: "create_edge", edge }]);
      // applyOps normalizes the id to `e-{source}-{target}` — return the stored edge.
      return structuredClone(
        edges.find((candidate) => candidate.source_id === edge.source_id && candidate.target_id === edge.target_id)!,
      );
    },

    async deleteEdge(projectId, id) {
      runOps(projectId, [{ op: "delete_edge", edge_id: id }]);
    },

    async applyMutations(projectId, ops) {
      const { nodes, edges } = runOps(projectId, ops);
      return structuredClone({ nodes, edges });
    },

    async exportProject(id) {
      requireProject(id);
      return structuredClone(ensure());
    },

    async importProject() {
      throw new Error("importProject is not supported on the seed provider");
    },
  };
}
```

- [ ] **Step 5: Verify.** Run: `node tests/data/seed-provider.test.js` — expected: all PASS. Adjust test expectations only where the implementation is right and the test was wrong (e.g. exact journal event shapes).

- [ ] **Step 6: Wire into CI** — in `package.json`, extend the existing script (CI's workflow runs it by name, so no workflow edit is needed):

```json
"test:provider": "node tests/data/provider-registry.test.js && node tests/data/mutation-notifications.test.js && node tests/data/seed-provider.test.js",
```

- [ ] **Step 7: Commit.**

```bash
git add lib/data/seed-provider.ts tests/data/load-seed-provider.js tests/data/seed-provider.test.js package.json
git commit -m "feat: in-memory seed provider — the self-map sandbox mechanism"
```

---

### Task 3: Routing + registry wiring (`ProjectSummary.seed`, seed branch, always-listed)

**Files:**
- Modify: `lib/data/data-provider.ts` (ProjectSummary)
- Modify: `lib/data/routing-provider.ts`
- Create: `lib/data/arkaik-seed.ts`
- Modify: `lib/data/provider-registry.ts`
- Test: `tests/data/provider-registry.test.js` + `tests/data/load-provider-registry.js`

- [ ] **Step 1: Update the loader** `tests/data/load-provider-registry.js`. `routing-provider.ts` will require `./seed-project-id` (transpile it — it has zero imports) and `provider-registry.ts` will require `./arkaik-seed` (stub it — the real one imports the seed JSON, which the flat build dir cannot resolve). Add below `RECORDING_PROVIDER_SOURCE`:

```js
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
```

In `loadProviderRegistry()`, add the two writes beside the existing ones, and expose the fake:

```js
  write("arkaik-seed.js", SEED_FAKE_SOURCE);
  write("seed-project-id.js", transpile(path.join(ROOT, "lib", "data", "seed-project-id.ts"), "seed-project-id.ts"));
```

```js
  const seedFake = req("arkaik-seed.js");
  return {
    // ...existing spread and keys...
    seedProject: req("seed-project-id.js"),
    seedFake: seedFake.arkaikSeedProvider,
    seedCalls: seedFake.seedCalls,
    resetSeedCalls: seedFake.__resetSeed,
  };
```

- [ ] **Step 2: Write the failing tests.** Append to `tests/data/provider-registry.test.js` (before the final `BUILD_DIR` cleanup), pulling the new exports from `reg`:

```js
  // --- The seed branch (self-map cycle 4) ------------------------------------
  {
    const { seedFake, seedCalls, resetSeedCalls } = reg;
    check("the seed id predicate matches only the reserved id",
      reg.seedProject.isSeedProjectId("arkaik-self-map") === true &&
      reg.seedProject.isSeedProjectId("prj_abc") === false &&
      reg.seedProject.isSeedProjectId("arkaik-self-map-2") === false);

    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => { throw new Error("seed calls must not reach the network"); },
      }),
      seed: seedFake,
      isRemoteAvailable: () => true,
    });

    resetCalls();
    resetSeedCalls();
    await router.getNodes("arkaik-self-map");
    await router.updateNode("arkaik-self-map", "V-projects", { title: "x" });
    check("seed-id calls reach the seed provider", seedCalls.length === 2, seedCalls.join(","));
    check("…and never the local provider", calls.length === 0, calls.join(","));
  }
  {
    // listProjects always leads with the seed — even when hosted fails.
    const failingRemote = remote.createRemoteProvider({ fetchImpl: async () => new Response("nope", { status: 500 }) });
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: failingRemote,
      seed: reg.seedFake,
      isRemoteAvailable: () => true,
    });
    const listed = await router.listProjects();
    check("the seed project is listed first", listed[0]?.seed === true, JSON.stringify(listed.map((p) => p.project.id)));
    check("…and a hosted failure still lists seed + local", listed.length === 2);
  }
  {
    // Signed out: seed + local, no network.
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({ fetchImpl: async () => { throw new Error("no"); } }),
      seed: reg.seedFake,
      isRemoteAvailable: () => false,
    });
    const listed = await router.listProjects();
    check("signed out, the seed is still listed first", listed[0]?.seed === true && listed.length === 2);
  }
  {
    // The DEFAULT registry wiring includes the seed provider.
    const listed = await getProvider().listProjects();
    check("getProvider()'s default routes the seed id to the seed provider",
      (await getProvider().getNodes("arkaik-self-map"), reg.seedCalls.some((c) => c === "getNodes:arkaik-self-map")));
    check("the default listing leads with the seed project", listed[0]?.seed === true, JSON.stringify(listed.map((p) => p.project.id)));
  }
```

(Note: the default-wiring block must run while `getProvider()` still holds the original router — place it before the `setProvider(marker)` seam test, or re-set the original first. Executor: order it correctly and keep the existing tests passing unchanged.)

- [ ] **Step 3: Run to verify failure.** Run: `node tests/data/provider-registry.test.js` — expected: FAIL (no `seed` option, no `seedProject` export; possibly a loader crash first — that counts).

- [ ] **Step 4: Implement.**

`lib/data/data-provider.ts` — add to `ProjectSummary`:

```ts
  /** True for the built-in public seed project (the Arkaik self-map, cycle 4). */
  seed?: boolean;
```

`lib/data/routing-provider.ts` — add to `RoutingProviderOptions`:

```ts
  /**
   * The built-in public seed project's provider (self-map cycle 4). Optional so
   * a router without one behaves exactly as before; when present, the reserved
   * seed id routes here — checked BEFORE the hosted prefix — and
   * `listProjects()` leads with its summary unconditionally: the public project
   * must appear signed-out, offline, and before auth resolves.
   */
  seed?: DataProvider;
```

Update the dispatch and listing:

```ts
import { isSeedProjectId } from "./seed-project-id";
```

```ts
  const { local, remote, seed, isRemoteAvailable } = options;

  /** The backend that owns this project. */
  const forProject = (projectId: string): DataProvider =>
    seed && isSeedProjectId(projectId) ? seed : isHostedProjectId(projectId) ? remote : local;
```

```ts
    async listProjects(): Promise<ProjectSummary[]> {
      const seedProjects = seed ? await seed.listProjects() : [];
      const localProjects = await local.listProjects();
      if (!(await isRemoteAvailable())) return [...seedProjects, ...localProjects];

      try {
        const hosted = await remote.listProjects();
        return [...seedProjects, ...hosted, ...localProjects];
      } catch (err) {
        console.error("[routing-provider] hosted project listing failed:", err);
        return [...seedProjects, ...localProjects];
      }
    },
```

(`importProject` stays local-only — Task 1's namespace guard means a seed-id bundle can never reach it.)

`lib/data/arkaik-seed.ts` (new — the one module that touches the JSON):

```ts
import arkaikSelfMap from "@/seed/arkaik-self-map.json";

import { createSeedProvider } from "./seed-provider";
import type { ProjectBundle } from "./types";

/**
 * The wired public self-map provider: the build-time-imported seed behind
 * `createSeedProvider`. Module state is per tab and per page load — which is
 * the sandbox's reset semantics: a refresh IS the reset.
 */
export const arkaikSeedProvider = createSeedProvider(() => arkaikSelfMap as unknown as ProjectBundle);
```

`lib/data/provider-registry.ts` — wire it:

```ts
import { arkaikSeedProvider } from "./arkaik-seed";
```

```ts
let currentProvider: DataProvider = createRoutingProvider({
  local: localProvider,
  remote: createRemoteProvider(),
  seed: arkaikSeedProvider,
  isRemoteAvailable: whenHostedAvailabilityKnown,
});
```

- [ ] **Step 5: Verify.** Run: `node tests/data/provider-registry.test.js` && `node tests/data/seed-provider.test.js` — expected: all PASS, including every pre-existing check.

- [ ] **Step 6: Commit.**

```bash
git add lib/data/data-provider.ts lib/data/routing-provider.ts lib/data/arkaik-seed.ts lib/data/provider-registry.ts tests/data/provider-registry.test.js tests/data/load-provider-registry.js
git commit -m "feat: route the reserved seed id to the sandbox provider; always list it"
```

---

### Task 4: The Explore section grouping

**Files:**
- Modify: `lib/data/project-sections.ts`
- Test: `tests/data/project-sections.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/data/project-sections.test.js`, extend the `summary` helper and add checks:

```js
const summary = (id, hosted, seed) => ({
  project: { id, title: id },
  nodeCount: 0,
  edgeCount: 0,
  hosted,
  ...(seed ? { seed: true } : {}),
});
```

```js
  // --- The Explore section (self-map cycle 4) --------------------------------
  const seedSummary = summary("arkaik-self-map", false, true);
  const groupedWithSeed = groupBySection([seedSummary, hosted, backedUp, plain], backups);
  check("a seed summary lands in explore", groupedWithSeed.explore.length === 1 && groupedWithSeed.explore[0] === seedSummary);
  check("…and never in lokal, even with an empty backup set",
    groupBySection([seedSummary], new Set()).lokal.length === 0);
  check("the other sections are unchanged by the seed",
    groupedWithSeed.hosted.length === 1 && groupedWithSeed.synked.length === 1 && groupedWithSeed.lokal.length === 1);
  check("no seed means an empty explore section", grouped.explore.length === 0);
```

- [ ] **Step 2: Run to verify failure.** Run: `node tests/data/project-sections.test.js` — expected: FAIL (`grouped.explore` is undefined).

- [ ] **Step 3: Implement** in `lib/data/project-sections.ts`. `sectionFor` keeps its `CreateTarget` return type (Explore is deliberately NOT a create target); the seed check lives in `groupBySection`:

```ts
/** A project list split into its sections, input order preserved within each.
 * `explore` holds the built-in public project(s); it is not a `CreateTarget`
 * because nothing can be created there. */
export interface GroupedProjects {
  explore: ProjectSummary[];
  hosted: ProjectSummary[];
  synked: ProjectSummary[];
  lokal: ProjectSummary[];
}

/** Split a project list into its sections in one pass. */
export function groupBySection(
  summaries: ProjectSummary[],
  backedUpIds: Set<string>
): GroupedProjects {
  const grouped: GroupedProjects = { explore: [], hosted: [], synked: [], lokal: [] };
  for (const summary of summaries) {
    if (summary.seed) {
      grouped.explore.push(summary);
      continue;
    }
    grouped[sectionFor(summary, backedUpIds)].push(summary);
  }
  return grouped;
}
```

- [ ] **Step 4: Verify.** Run: `node tests/data/project-sections.test.js` — expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/data/project-sections.ts tests/data/project-sections.test.js
git commit -m "feat: explore section — seed summaries group apart from lokal"
```

---

### Task 5: /projects UI — Explore section, Public badge, banner exclusion

**Files:**
- Modify: `app/projects/page.tsx`
- Modify: `components/projects/ProjectCard.tsx`
- Modify: `components/sync/SynkOnboardingBanner.tsx`

No Node test runner covers these client components; the verification is `npx next lint` on the touched files + `npm run build` in Task 7, and Alexis's visual pass via the PR checklist.

- [ ] **Step 1: `ProjectCard.tsx`** — Public badge, no footer for the seed. Add the import and adjust:

```tsx
import { Badge } from "@/components/ui/badge";
```

```tsx
export function ProjectCard({ summary, canHost, moving, onMoveToAccount }: ProjectCardProps) {
  const isSeed = Boolean(summary.seed);
  const showMove = !summary.hosted && !isSeed && canHost;
```

In the `CardTitle`, wrap so the badge sits beside the title (keep the stretched-link pattern intact):

```tsx
        <CardTitle className="flex items-center gap-2 truncate">
          <Link
            href={`/project/${summary.project.id}`}
            className="truncate outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {summary.project.title}
          </Link>
          {isSeed && <Badge variant="secondary">Public</Badge>}
        </CardTitle>
```

(Check `components/ui/badge.tsx` for its actual variant names and pick the neutral one.) Footer branch — a seed card, like a hosted one, is nothing but its link:

```tsx
      {summary.hosted || isSeed ? null : (
        <CardFooter ...
```

Also update the card's doc comment: the seed card suppresses the footer for the same reason a hosted one does — there is nothing to sync, move, or delete.

- [ ] **Step 2: `SynkOnboardingBanner.tsx`** — the banner must never offer to back up the public project. In the `candidates` filter (line ~67), add beside the `hosted` check:

```tsx
    if (bundle.hosted) return false; // already on the server; nothing to back up
    if (bundle.seed) return false; // the public sandbox is not the user's data
```

- [ ] **Step 3: `app/projects/page.tsx`** — render Explore for everyone. `grouped` already carries `explore` after Task 4. Add a small local component above `ProjectsPageBody` (it needs nothing but the group and the card renderer — deliberately no `SectionCreateMenu`, Explore is not a create target):

```tsx
/** The Explore section: the built-in public project(s), for everyone —
 *  signed-in or out. No create controls: nothing can be created here. */
function ExploreSection({
  items,
  renderCard,
}: {
  items: ProjectSummary[];
  renderCard: (summary: ProjectSummary) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-lg font-semibold">
        Explore
        <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{items.map(renderCard)}</div>
    </section>
  );
}
```

Wire it into BOTH branches of the render:

- **Signed-out** (the branch commented "Signed out: no sections"): wrap so Explore renders above the existing content — above the empty state when `grouped.lokal.length === 0`, above the flat grid otherwise:

```tsx
        ) : !signedIn ? (
          <>
            <ExploreSection items={grouped.explore} renderCard={renderCard} />
            {grouped.lokal.length === 0 ? (
              /* existing empty-state block, unchanged */
            ) : (
              /* existing flat grid block, unchanged */
            )}
          </>
        ) : (
```

- **Signed-in**: after the `lokal` `ProjectSection` (their own work first; the standing public fixture last):

```tsx
            <ExploreSection items={grouped.explore} renderCard={renderCard} />
```

Update the signed-out comment to say sections are absent *for the user's own projects* — Explore is not theirs.

- [ ] **Step 4: Lint.** Run: `npx eslint app/projects/page.tsx components/projects/ProjectCard.tsx components/sync/SynkOnboardingBanner.tsx` — expected: no NEW errors in these files (repo memory: main carries pre-existing errors elsewhere; the bar is no new ones in touched files).

- [ ] **Step 5: Commit.**

```bash
git add app/projects/page.tsx components/projects/ProjectCard.tsx components/sync/SynkOnboardingBanner.tsx
git commit -m "feat: Explore section on /projects — the public self-map card for everyone"
```

---

### Task 6: In-project sandbox banner, settings guard, sitemap

**Files:**
- Create: `components/projects/SeedSandboxBanner.tsx`
- Modify: `app/project/[id]/layout.tsx`
- Modify: `app/project/[id]/settings/page.tsx`
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Create `components/projects/SeedSandboxBanner.tsx`.** "Import a copy" exports the CURRENT sandbox state and runs it through the one existing import funnel (`importProjectFromFile`), whose Task-1 guard regenerates the reserved id — what you built is what you keep:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { exportProject, importProjectFromFile } from "@/lib/utils/export";

/**
 * The sandbox banner shown across every page of the public self-map (self-map
 * cycle 4). Reset is a plain reload: the seed provider's state is per page
 * load, so a refresh IS the pristine reset — no bespoke reset path to drift.
 * "Import a copy" snapshots the tab's current sandbox state through the one
 * existing import funnel, which also regenerates the reserved id.
 */
export function SeedSandboxBanner({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function importCopy() {
    setImporting(true);
    try {
      const bundle = await exportProject(projectId);
      const file = new File([JSON.stringify(bundle)], "arkaik-self-map.json", {
        type: "application/json",
      });
      const project = await importProjectFromFile(file);
      toast.success(`"${project.title}" was copied to your projects.`);
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("[SeedSandboxBanner] Failed to import a copy:", err);
      toast.error(err instanceof Error ? err.message : "Could not import a copy.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/40 px-4 py-2">
      <p className="text-sm text-muted-foreground">
        You&apos;re exploring Arkaik&apos;s own map — a live sandbox. Changes stay in this tab and
        vanish on refresh.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="cursor-pointer"
          onClick={() => window.location.reload()}
        >
          <RotateCcwIcon />
          Reset
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          disabled={importing}
          onClick={() => void importCopy()}
        >
          <CopyIcon />
          {importing ? "Importing…" : "Import a copy"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it from the project chrome.** In `app/project/[id]/layout.tsx`, add imports:

```tsx
import { SeedSandboxBanner } from "@/components/projects/SeedSandboxBanner";
import { isSeedProjectId } from "@/lib/data/seed-project-id";
```

and change the inset (the banner must sit above every project page, inside the sidebar inset; add flex column so pages keep filling the remaining height):

```tsx
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        {isSeedProjectId(id) && <SeedSandboxBanner projectId={id} />}
        {children}
      </SidebarInset>
```

(Check `SidebarInset`'s base classes in `components/ui/sidebar.tsx` — if it is already a flex column, do not repeat the classes.)

- [ ] **Step 3: Hide the delete danger zone for the seed.** In `app/project/[id]/settings/page.tsx`, import `isSeedProjectId`, and wrap the "Delete this project" block (~line 112) and its `DeleteConfirmDialog` in `{!isSeedProjectId(id) && ( ... )}`. The provider's `archiveProject` rejection is the backstop; the UI simply should not offer it.

- [ ] **Step 4: Sitemap.** In `app/sitemap.ts` add after the `/projects` entry:

```ts
    { url: `${base}/project/arkaik-self-map`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
```

- [ ] **Step 5: Lint.** Run: `npx eslint components/projects/SeedSandboxBanner.tsx "app/project/[id]/layout.tsx" "app/project/[id]/settings/page.tsx" app/sitemap.ts` — expected: no new errors.

- [ ] **Step 6: Commit.**

```bash
git add components/projects/SeedSandboxBanner.tsx "app/project/[id]/layout.tsx" "app/project/[id]/settings/page.tsx" app/sitemap.ts
git commit -m "feat: sandbox banner, settings guard, sitemap for the public self-map"
```

---

### Task 7: Full verification + PR

**Files:** none new (fixes only if verification finds problems).

- [ ] **Step 1: Full test pass over everything this feature touches:**

```bash
node tests/data/seed-provider.test.js && \
node tests/data/provider-registry.test.js && \
node tests/data/mutation-notifications.test.js && \
node tests/data/project-sections.test.js && \
node tests/data/create-target.test.js && \
node tests/data/import-roundtrip.test.js && \
node tests/data/migrate.test.js && \
node tests/data/seed-import.test.js && \
npm run validate:seeds
```

Expected: every script ends in its "All … passed." line.

- [ ] **Step 2: Build.** Run: `npm run build` — expected: compiles, `/projects` and `/project/[id]` prerender clean (the seed provider must never run browser-only APIs at import time — it is lazy by construction; `structuredClone` exists in Node ≥17).

- [ ] **Step 3: Push and open the PR** against `main` from `cycle4/public-self-map`. Body must include: summary, test evidence, a **visual checklist for Alexis** (Explore section signed-out and signed-in; Public badge; card opens `/project/arkaik-self-map`; banner copy + Reset + Import a copy; sandbox editing works on maps/panels; refresh restores; Settings has no delete; Synk banner never mentions the public project), the known-debt note (six→seven duplicated test-loader tables), and — this is a user-facing change — a **Lab Note** section exactly per CLAUDE.md:

````markdown
## Lab Note

```yaml
en:
  title: "Take Arkaik's own map for a spin — no account needed"
  summary: "A new Explore section on your projects page opens the live map we use to build Arkaik. Poke around, move things, edit freely — it's a sandbox, and a refresh puts everything back. Like what you made? Import a copy and keep it."
fr:
  title: "Balade-toi dans la carte d'Arkaik — sans compte"
  summary: "Une nouvelle section Explore sur ta page projets t'ouvre la carte vivante qu'on utilise pour construire Arkaik. Fouille, déplace, modifie sans crainte : c'est un bac à sable, un simple refresh remet tout en place. Fier du résultat ? Importe une copie et garde-la."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
````

- [ ] **Step 4: Read the PR's comments after opening** (CLAUDE.md requirement — the advisory reminder surfaces Lab Note problems there) and fix the body if flagged. Verify CI goes green.

---

## Self-review notes (already applied)

- Spec coverage: seed provider (T2), routing/listing (T3), namespace guard (T1), Explore section (T4–5), card badge/footer (T5), banner + Reset + Import-a-copy (T6), settings guard (T6), sitemap (T6), tests (T1–4, T7). Spec's `deleteProject` refusal maps to `archiveProject` — the interface has no `deleteProject`; Settings' "Delete" calls `archiveProject`.
- The two spec refinements (reload-as-reset, copy-current-state) are flagged in the header and in code comments; surface them in the PR body.
- Type consistency: `ProjectSummary.seed?: boolean` (T3) is what T4's grouping and T5's card/banner read; `SEED_PROJECT_ID`/`isSeedProjectId` (T1) is what T3's router and T6's chrome read.

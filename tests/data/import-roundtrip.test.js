#!/usr/bin/env node

/**
 * Regression test for the `rewriteBundleProjectId` unknown-key landmine
 * (lib/utils/export.ts, docs/spec/bundle-format.md:40 / issue #201 AC 4).
 *
 * When an imported project's id collides with an existing one, the importer
 * rewrites the id via `rewriteBundleProjectId`. That function historically
 * risked reconstructing the bundle as `{ project, nodes, edges }` and dropping
 * every other top-level key. This test drives the *full* ID-collision import
 * path — parse (must preserve unknown keys) → rewrite (must preserve unknown
 * keys) → import — and asserts the embedded `journal`, `schema_version`, and
 * `project.version` all survive to the stored bundle, with ids rewritten.
 *
 * export.ts is loaded by transpiling it and intercepting its two runtime
 * imports: the real `@arkaik/schema` (so parse/validate behave exactly as in
 * the app) and a stub `provider-registry` module (export.ts reads its provider
 * through `getProvider()`, issue #243) whose stub provider forces one id
 * collision and captures what gets imported.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-export");

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const COLLIDING_ID = "existing-project";
let captured = null;

const stubProvider = {
  getProject: async (id) => (id === COLLIDING_ID ? { project: { id } } : undefined),
  importProject: async (bundle) => {
    captured = bundle;
    return bundle.project;
  },
};

// export.ts reads its provider through the getProvider() seam (issue #243)
// rather than importing local-provider directly, so the stub is shaped like
// provider-registry's export.
const stubProviderRegistry = {
  getProvider: () => stubProvider,
};

function loadExportModule() {
  const schemaExports = loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "export.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "export.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const outFile = path.join(BUILD_DIR, "export.js");
  fs.writeFileSync(outFile, outputText);

  // Intercept the two bare/aliased imports the transpiled module require()s.
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@arkaik/schema") return schemaExports;
    if (request.includes("provider-registry")) return stubProviderRegistry;
    // export.ts reserves the hosted id namespace on import, so it now reads the
    // prefix constant from remote-provider. Only the constant is needed here —
    // that module has no runtime deps of its own.
    if (request.includes("remote-provider")) return { HOSTED_ID_PREFIX: "prj_" };
    if (request.includes("seed-project-id")) return { SEED_PROJECT_ID: "arkaik-self-map" };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[outFile];
    return require(outFile);
  } finally {
    Module._load = originalLoad;
  }
}

async function main() {
  const exportModule = loadExportModule();

  const bundle = {
    schema_version: 1,
    project: {
      id: COLLIDING_ID,
      title: "Colliding Project",
      version: "2.1.0",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      { id: "V-home", project_id: COLLIDING_ID, species: "view", title: "Home", status: "idea", platforms: ["web"] },
    ],
    edges: [],
    journal: [
      { id: "01J9ZK4E4NVQ9K4YB2Q6WPXC1S", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" },
      { id: "01J9ZK4E4NVQ9K4YB2Q6WPXC1T", ts: "2026-01-01T00:01:00.000Z", type: "release.tagged", version: "2.1.0" },
    ],
  };

  // Duck-typed File: importProjectFromFile only calls file.text().
  const file = { text: async () => JSON.stringify(bundle) };
  const createdProject = await exportModule.importProjectFromFile(file);

  assert(captured !== null, "import path reached the provider's importProject");
  assert(
    captured.project.id !== COLLIDING_ID && createdProject.id === captured.project.id,
    "id-collision: project id was rewritten to a fresh id",
  );
  assert(
    captured.nodes[0].project_id === captured.project.id,
    "id-collision: node.project_id was repointed to the new id",
  );
  assert(
    JSON.stringify(captured.journal) === JSON.stringify(bundle.journal),
    "id-collision: embedded `journal` survived the rewrite (no silent stripping)",
  );
  // The import gate migrates before validating (parse → migrate → validate,
  // mirroring lib/services/graph/store.ts), so a pre-v3 bundle is stored under
  // the v3 stamp — never re-persisted as pre-v3 data.
  assert(captured.schema_version === 3, "id-collision: schema_version was stamped to v3 by the migration");
  assert(captured.project.version === "2.1.0", "id-collision: project.version survived the rewrite");

  // --- Client import gate accepts a legacy-vocabulary (pre-v3) bundle ---
  // Regression for the gate validating the RAW input: a v2 bundle carrying
  // `prioritized`/`blocked` (and a journal whose last status_changed.to is a
  // legacy id) must migrate BEFORE strict validation, and the journal must
  // come through byte-identical — history is never rewritten.
  const legacyBundle = {
    schema_version: 2,
    project: {
      id: "legacy-project",
      title: "Legacy Project",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      { id: "V-a", project_id: "legacy-project", species: "view", title: "A", status: "blocked", platforms: ["web"] },
      { id: "V-b", project_id: "legacy-project", species: "view", title: "B", status: "prioritized", platforms: ["web"] },
    ],
    edges: [],
    journal: [
      { id: "01LEGACYA", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" },
      { id: "01LEGACYB", ts: "2026-01-01T00:01:00.000Z", type: "node.created", node_id: "V-b", species: "view", title: "B" },
      { id: "01LEGACYC", ts: "2026-01-01T00:02:00.000Z", type: "node.status_changed", node_id: "V-a", from: "prioritized", to: "blocked" },
    ],
  };
  let migrated = null;
  let gateError = null;
  try {
    migrated = exportModule.parseAndValidateBundle(legacyBundle);
  } catch (err) {
    gateError = err;
  }
  assert(gateError === null, `legacy gate: v2 bundle with legacy statuses is accepted (${gateError ? gateError.message : "ok"})`);
  assert(migrated && migrated.nodes[0].status === "development", "legacy gate: blocked -> development on the returned bundle");
  assert(migrated && migrated.nodes[1].status === "backlog", "legacy gate: prioritized -> backlog on the returned bundle");
  assert(migrated && migrated.schema_version === 3, "legacy gate: returned bundle carries the v3 stamp");
  assert(
    migrated && JSON.stringify(migrated.journal) === JSON.stringify(legacyBundle.journal),
    "legacy gate: journal history untouched by migration",
  );

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

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} import round-trip test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll import round-trip tests passed.");
}

main();

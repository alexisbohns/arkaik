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
  assert(captured.schema_version === 1, "id-collision: schema_version survived the rewrite");
  assert(captured.project.version === "2.1.0", "id-collision: project.version survived the rewrite");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} import round-trip test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll import round-trip tests passed.");
}

main();

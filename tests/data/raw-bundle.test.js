#!/usr/bin/env node

/**
 * The raw bundle editor's load and save (lib/utils/export.ts, issue #429).
 *
 * A hosted project's raw save used to go through `importProject`, which the
 * router always lands locally: the edit was written to a phantom `prj_…` row
 * in IndexedDB and the server never heard of it. These tests pin the split —
 * hosted replaces through the server under the version the editor opened on,
 * local still imports in place — and the two id pins, which differ.
 *
 * export.ts is transpiled and its imports intercepted, the same approach as
 * import-roundtrip.test.js: the real `@arkaik/schema`, and a provider the test
 * swaps per case.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const { loadSchema } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-raw-bundle");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let provider = null;
const calls = [];

function fakeProvider() {
  return {
    async readProject(id, options) {
      calls.push(`readProject:${id}:${options.etag}`);
      return { status: "fresh", value: { project: { id: "orig" }, nodes: [], edges: [] }, etag: 'W/"x"', version: "7" };
    },
    async exportProject(id) {
      calls.push(`exportProject:${id}`);
      return bundleFor(id.startsWith("prj_") ? "orig" : id);
    },
    async importProject(bundle) {
      calls.push(`importProject:${bundle.project.id}`);
      this.imported = bundle;
      return bundle.project;
    },
    async replaceProject(projectId, bundle, options) {
      calls.push(`replaceProject:${projectId}:${options.version}`);
      this.replaced = bundle;
      return { version: "8" };
    },
  };
}

function bundleFor(id) {
  return {
    schema_version: 1,
    project: { id, title: "T", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: "V-home", project_id: id, species: "view", title: "Home", status: "idea", platforms: ["web"] }],
    edges: [],
    journal: [],
  };
}

function loadExportModule() {
  const schemaExports = loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "export.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "export.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const outFile = path.join(BUILD_DIR, "export.js");
  fs.writeFileSync(outFile, outputText);

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@arkaik/schema") return schemaExports;
    if (request.includes("provider-registry")) return { getProvider: () => provider };
    if (request.includes("project-queries")) {
      return {
        invalidateProjects: async () => {},
        // The real one forwards to the provider's conditional read when it has one.
        readProjectBundle: (p, id, options) => p.readProject(id, options),
      };
    }
    if (request.includes("remote-provider")) {
      return { HOSTED_ID_PREFIX: "prj_", isHostedProjectId: (id) => id.startsWith("prj_") };
    }
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
  const exp = loadExportModule();
  const HOSTED = "prj_abc";

  // --- Load ----------------------------------------------------------------------
  provider = fakeProvider();
  calls.length = 0;
  const hostedBase = await exp.loadRawBundle(HOSTED);
  check(
    "a hosted load reads the version BEFORE the bundle, unconditionally",
    calls.join(",") === `readProject:${HOSTED}:null,exportProject:${HOSTED}`,
    calls.join(","),
  );
  check("…and carries that version", hostedBase.version === "7" && hostedBase.bundle.project.id === "orig");

  calls.length = 0;
  const localBase = await exp.loadRawBundle("local-1");
  check(
    "a local load has no version to read",
    localBase.version === null && calls.join(",") === "exportProject:local-1",
    calls.join(","),
  );

  // --- Hosted save ---------------------------------------------------------------
  calls.length = 0;
  const edited = bundleFor("renamed-in-the-editor");
  edited.project.title = "Edited";
  await exp.saveRawBundle(HOSTED, edited, hostedBase);
  check(
    "a hosted save replaces through the server under the opened version — never an import",
    calls.join(",") === `replaceProject:${HOSTED}:7`,
    calls.join(","),
  );
  check(
    "…pinned to the bundle's own id, not the route's prj_ id (bundle_id keeps the repo linked)",
    provider.replaced.project.id === "orig" &&
      provider.replaced.nodes.every((n) => n.project_id === "orig") &&
      provider.replaced.project.title === "Edited",
    JSON.stringify(provider.replaced.project),
  );

  calls.length = 0;
  let error = null;
  try {
    await exp.saveRawBundle(HOSTED, edited, { bundle: hostedBase.bundle, version: null });
  } catch (err) {
    error = err;
  }
  check("a hosted save with no version is refused before anything is sent", error !== null && calls.length === 0, calls.join(","));

  // --- Local save ----------------------------------------------------------------
  calls.length = 0;
  await exp.saveRawBundle("local-1", bundleFor("renamed-in-the-editor"), localBase);
  check(
    "a local save still imports in place, pinned to the route id",
    calls.join(",") === "importProject:local-1" && provider.imported.nodes.every((n) => n.project_id === "local-1"),
    calls.join(","),
  );

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} raw-bundle test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll raw-bundle tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

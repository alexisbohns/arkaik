/**
 * Loads lib/data/local-provider.ts into a running Node process without a
 * bundler, the same transpile-on-the-fly approach the other tests/data
 * loaders use — plus a hand-written in-memory fake for `./db` (lib/data/db.ts)
 * so the provider's real create/update/delete transactions run for real in
 * plain Node.
 *
 * Deliberately no `fake-indexeddb` dev dependency: db.ts's runtime surface
 * that local-provider.ts actually calls (`getDb`, `appendJournalEvents`,
 * `assembleBundle`, `splitBundle`) is small and simple enough to reimplement
 * faithfully by hand — the same "stub the seam, not the browser API" approach
 * tests/data/import-roundtrip.test.js takes for `local-provider` itself, and
 * the same reasoning tests/data/load-emit-events.js documents for staying
 * IndexedDB-free. The fake's `transaction()` just runs its callback (no real
 * atomicity), which is enough to prove the ordering this suite cares about:
 * notifications fire after the transaction's callback resolves, never inside
 * it, never on a thrown error.
 *
 * All of local-provider.ts's *other* runtime dependencies are loaded for
 * real: `./migrate` and `./emit-events` are transpiled fresh (their own
 * `@arkaik/schema` requires rewritten to the built schema package, exactly
 * like load-migrate.js / load-emit-events.js do standalone), and
 * `lib/utils/cycle.ts` is transpiled as-is (its only import is `import type`,
 * which erases, so it has no runtime dependencies to stub).
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-local-provider");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcFile, fileName) {
  const source = fs.readFileSync(srcFile, "utf8");
  return ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS }).outputText;
}

// Hand-written fake for lib/data/db.ts — see the module doc above. Faithfully
// mirrors the real splitBundle/assembleBundle/appendJournalEvents logic
// (they're simple and pure); `getDb`/`__setFakeDb`/`__makeFakeDb` replace the
// real Dexie-backed readiness gate with a settable in-memory store.
const FAKE_DB_SOURCE = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeTable(keyOf) {
  const rows = new Map();
  return {
    async get(key) {
      return clone(rows.get(key));
    },
    async put(row) {
      rows.set(keyOf(row), clone(row));
      return keyOf(row);
    },
    async delete(key) {
      rows.delete(key);
    },
    async toArray() {
      return Array.from(rows.values()).map(clone);
    },
  };
}

function __makeFakeDb() {
  return {
    projects: makeTable((row) => row.id),
    journals: makeTable((row) => row.projectId),
    async transaction(mode, ...args) {
      const callback = args[args.length - 1];
      return await callback();
    },
  };
}

let currentDb = null;
function __setFakeDb(db) {
  currentDb = db;
}

async function getDb() {
  return currentDb;
}

function splitBundle(bundle) {
  const { journal, ...snapshot } = bundle;
  return { snapshot, journal };
}

function assembleBundle(snapshot, events) {
  return events !== undefined ? Object.assign({}, snapshot, { journal: events }) : snapshot;
}

async function appendJournalEvents(db, projectId, events) {
  if (events.length === 0) return;
  const row = await db.journals.get(projectId);
  const existing = (row && row.events) || [];
  await db.journals.put({ projectId, events: existing.concat(events) });
}

exports.getDb = getDb;
exports.appendJournalEvents = appendJournalEvents;
exports.assembleBundle = assembleBundle;
exports.splitBundle = splitBundle;
exports.__setFakeDb = __setFakeDb;
exports.__makeFakeDb = __makeFakeDb;
`;

function loadLocalProvider() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const rewriteSchemaRequire = (text) =>
    text.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);

  // db.js — hand-written fake (FAKE_DB_SOURCE above).
  fs.writeFileSync(path.join(BUILD_DIR, "db.js"), FAKE_DB_SOURCE);

  // cycle.js — transpiled as-is; only `import type` deps, so no rewrite needed.
  fs.writeFileSync(
    path.join(BUILD_DIR, "cycle.js"),
    transpile(path.join(ROOT, "lib", "utils", "cycle.ts"), "cycle.ts"),
  );

  // emit-events.js — transpiled, @arkaik/schema require rewritten to the real build.
  fs.writeFileSync(
    path.join(BUILD_DIR, "emit-events.js"),
    rewriteSchemaRequire(transpile(path.join(ROOT, "lib", "data", "emit-events.ts"), "emit-events.ts")),
  );

  // migrate.js — transpiled, @arkaik/schema require rewritten to the real build.
  fs.writeFileSync(
    path.join(BUILD_DIR, "migrate.js"),
    rewriteSchemaRequire(transpile(path.join(ROOT, "lib", "data", "migrate.ts"), "migrate.ts")),
  );

  // local-provider.js — transpiled; @arkaik/schema and the `@/lib/utils/cycle`
  // alias rewritten (the alias isn't resolvable by plain Node require, so it's
  // pointed at the sibling cycle.js written above; every other import is a
  // real relative path ("./migrate", "./db", "./emit-events") that resolves
  // naturally since all these files live in the same BUILD_DIR).
  let localProviderOut = transpile(path.join(ROOT, "lib", "data", "local-provider.ts"), "local-provider.ts");
  localProviderOut = rewriteSchemaRequire(localProviderOut);
  localProviderOut = localProviderOut.replace(
    /require\((['"])@\/lib\/utils\/cycle\1\)/g,
    `require("./cycle")`,
  );
  const outFile = path.join(BUILD_DIR, "local-provider.js");
  fs.writeFileSync(outFile, localProviderOut);

  for (const name of ["db", "cycle", "emit-events", "migrate", "local-provider"]) {
    delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  }

  const localProviderModule = require(outFile);
  const dbModule = require(path.join(BUILD_DIR, "db.js"));
  return {
    localProvider: localProviderModule.localProvider,
    subscribeToMutations: localProviderModule.subscribeToMutations,
    __makeFakeDb: dbModule.__makeFakeDb,
    __setFakeDb: dbModule.__setFakeDb,
  };
}

module.exports = { loadLocalProvider, BUILD_DIR, SCHEMA_BUILD_DIR };

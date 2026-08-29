#!/usr/bin/env node

/**
 * Pins `foldResolvedFindings` (lib/utils/quality.ts) to its real consumer:
 * `lib/data/local-provider.ts` `getProject` (issue #382 phase E, commit
 * 519b9b6). `foldResolvedFindings` itself is exhaustively covered as a pure
 * function in tests/app/quality.test.js (112 assertions) — this suite does
 * NOT re-test its folding rules. It only pins the wiring: does the provider
 * actually call it, on the read path, with the right inputs, without ever
 * persisting what it folds.
 *
 * Drives the real `local-provider.ts` through tests/data/load-local-provider.js
 * (the hand-written in-memory `./db` fake — see that file's module doc), the
 * same harness tests/data/mutation-notifications.test.js uses.
 */

const fs = require("fs");
const { loadLocalProvider, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-local-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";

function makeQuality(findings) {
  return {
    framework_version: "0.1.0",
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [
      { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "2026-08", ts: ISO },
    ],
    findings,
  };
}

const openFinding = {
  id: "F-1",
  criterion_id: "SEC-01",
  surface: "web",
  title: "t",
  detail: "d",
  evidence: "e",
  impact: 5,
  likelihood: 5,
  cost: "M",
  status: "open",
};

const resolvedEvent = (findingId, over = {}) => ({
  id: `01J${findingId}`,
  ts: "2026-09-01T00:00:00.000Z",
  type: "quality.finding.resolved",
  finding_id: findingId,
  resolved_by: "https://github.com/acme/app/pull/7",
  ...over,
});

function makeBundle(projectId, { quality, journal } = {}) {
  const bundle = {
    schema_version: 3,
    project: {
      id: projectId,
      title: `Project ${projectId}`,
      created_at: ISO,
      updated_at: ISO,
      archived_at: null,
    },
    nodes: [],
    edges: [],
  };
  if (quality !== undefined) bundle.quality = quality;
  if (journal !== undefined) bundle.journal = journal;
  return bundle;
}

async function main() {
  const { localProvider, __makeFakeDb, __setFakeDb } = loadLocalProvider();
  const db = __makeFakeDb();
  __setFakeDb(db);

  // --- 1 + 2: the fold reaches the consumer, and never rewrites the stored
  // snapshot -------------------------------------------------------------
  {
    const PROJECT_ID = "p-resolved";
    await localProvider.importProject(
      makeBundle(PROJECT_ID, {
        quality: makeQuality([openFinding]),
        journal: [resolvedEvent("F-1")],
      }),
    );

    const project = await localProvider.getProject(PROJECT_ID);
    const finding = project.quality?.findings.find((f) => f.id === "F-1");
    check(
      "getProject folds a resolution event onto its finding",
      finding?.status === "resolved",
      JSON.stringify(finding),
    );
    check(
      "the folded finding carries resolved_by from the event",
      finding?.resolved_by === "https://github.com/acme/app/pull/7",
      JSON.stringify(finding),
    );

    // The doctrine: the webhook appends, it never rewrites state. Read the
    // record straight off storage, bypassing the provider's read-time fold
    // entirely, and confirm the stored finding still says "open".
    const record = await db.projects.get(PROJECT_ID);
    const storedFinding = record.snapshot.quality.findings.find((f) => f.id === "F-1");
    check(
      "the stored snapshot's finding is untouched — still open",
      storedFinding?.status === "open",
      JSON.stringify(storedFinding),
    );
  }

  // --- 3: no resolution events -> quality comes back BY REFERENCE ---------
  //
  // The fake `db.projects.get` (tests/data/load-local-provider.js) clones on
  // every call, the same way a real Dexie/IndexedDB read struct-clones — so
  // two independent `db.projects.get()` calls can never be `===`. To pin
  // reference identity we intercept the ONE internal read `getProject` makes
  // and capture the exact record object it receives, then compare it against
  // what `getProject` returns.
  {
    const PROJECT_ID = "p-untouched";
    await localProvider.importProject(
      makeBundle(PROJECT_ID, { quality: makeQuality([openFinding]) }),
    );

    const originalGet = db.projects.get.bind(db.projects);
    let capturedRecord;
    db.projects.get = async (key) => {
      const result = await originalGet(key);
      capturedRecord = result;
      return result;
    };
    let project;
    try {
      project = await localProvider.getProject(PROJECT_ID);
    } finally {
      db.projects.get = originalGet;
    }

    check(
      "no resolution events -> quality is the SAME object the snapshot holds",
      project.quality === capturedRecord.snapshot.quality,
      "a wiring bug that spread a fresh object every time would silently defeat the memo this reference identity exists for",
    );
  }

  // --- 4: no quality section at all -> loads fine, stays undefined --------
  {
    const PROJECT_ID = "p-no-quality";
    await localProvider.importProject(makeBundle(PROJECT_ID));

    let project;
    let threw = false;
    try {
      project = await localProvider.getProject(PROJECT_ID);
    } catch {
      threw = true;
    }
    check("a project with no quality section loads without throwing", !threw);
    check("its quality stays undefined", project?.quality === undefined, JSON.stringify(project?.quality));
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} quality-fold test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll quality-fold tests passed.");
}

main();

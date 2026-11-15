#!/usr/bin/env node

/**
 * The browser provider's weighing writes (lib/data/local-provider.ts
 * `appendWeighingEvents`, docs/rfcs/weighing.md): an assessment, or a
 * positioning, lands in the project's journal row as an event, `getProject`
 * folds it over the stored section, and the snapshot itself is never touched.
 *
 * Runs the real provider over load-local-provider.js's in-memory fake `./db`
 * (deliberately IndexedDB-free), exactly like mutation-notifications.test.js.
 */

const fs = require("fs");
const { loadLocalProvider, BUILD_DIR } = require("./load-local-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";
const PROJECT = "p-weigh";

const bundle = (extra = {}) => ({
  schema_version: 3,
  project: { id: PROJECT, title: "Weigh", created_at: ISO, updated_at: ISO, archived_at: null },
  nodes: [
    { id: "AC-a", project_id: PROJECT, species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { gherkin: "Given a link", values: ["connects"] } },
    { id: "V-home", project_id: PROJECT, species: "view", title: "Home", status: "live", platforms: ["web"] },
  ],
  edges: [],
  ...extra,
});

const assess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "AC-a", criterion: "connects", level: 2, confidence: 2, evidence: "the title says so", ...over });

async function main() {
  const { localProvider, subscribeToMutations, __makeFakeDb, __setFakeDb } = loadLocalProvider();
  const db = __makeFakeDb();
  __setFakeDb(db);
  await localProvider.saveProject(bundle());

  const received = [];
  const unsubscribe = subscribeToMutations((e) => received.push(e));

  // --- a write lands as an event and folds on read ---------------------------
  const before = await localProvider.getProject(PROJECT);
  check("a project with no weighing data reads with no weighing section", before.weighing === undefined);

  const events = await localProvider.appendWeighingEvents(PROJECT, [assess()]);
  check("appending returns the stamped events", events.length === 1 && events[0].type === "weighing.assessment.recorded" && events[0].actor === "arkaik-app");
  check("exactly one mutation notification fires, for this project", received.length === 1 && received[0].projectId === PROJECT, JSON.stringify(received));

  const after = await localProvider.getProject(PROJECT);
  check("getProject folds the event into a weighing section", after.weighing?.assessments?.length === 1);
  const row = after.weighing?.assessments?.[0];
  check("the browser is a person: the scorer is stamped human", row.scorer.kind === "human");
  check("the basis is read off the stored node: fingerprint and set version", /^fp1-/.test(row.basis.fingerprint) && row.basis.set_version === "1.0.0");
  check("the level, confidence and evidence are the caller's", row.level === 2 && row.confidence === 2 && row.evidence === "the title says so");

  const stored = await db.projects.get(PROJECT);
  check("the stored snapshot is never touched — events only", stored.snapshot.weighing === undefined);
  const journal = await db.journals.get(PROJECT);
  check("the journal row holds the event", journal.events.some((e) => e.type === "weighing.assessment.recorded"));

  // --- latest wins, per scorer kind -----------------------------------------
  await localProvider.appendWeighingEvents(PROJECT, [assess({ level: -1, evidence: "second thoughts" })]);
  const rescored = (await localProvider.getProject(PROJECT)).weighing?.assessments ?? [];
  check("a later write replaces the cell", rescored.length === 1 && rescored[0].level === -1);

  // --- a positioning ---------------------------------------------------------
  const positioning = { id: "positioning", version: "1.0.0", subject: "acceptance", scale: { min: -3, max: 3, anchors: {} }, role: "positioning", status: "draft", extends: "value-contribution@1", criteria: [{ id: "connects", weight: 3 }] };
  await localProvider.appendWeighingEvents(PROJECT, [{ type: "weighing.set.saved", set: positioning }]);
  const withSet = (await localProvider.getProject(PROJECT)).weighing;
  check("a saved positioning folds into sets", withSet?.sets?.length === 1 && withSet.sets[0].status === "draft");
  await localProvider.appendWeighingEvents(PROJECT, [{ type: "weighing.set.saved", set: { ...positioning, status: "active" } }]);
  check("saving it again replaces it — latest wins", (await localProvider.getProject(PROJECT)).weighing?.sets?.[0]?.status === "active");

  // --- the gate refuses, all or nothing -------------------------------------
  received.length = 0;
  const eventCount = (await db.journals.get(PROJECT)).events.length;
  let refusal = null;
  try {
    await localProvider.appendWeighingEvents(PROJECT, [assess(), assess({ criterion: "teleports" })]);
  } catch (error) {
    refusal = error;
  }
  check("a bad entry refuses the whole batch", refusal !== null && /unknown_criterion/.test(refusal.message), refusal?.message);
  check("…and writes nothing", (await db.journals.get(PROJECT)).events.length === eventCount);
  check("…and notifies nobody", received.length === 0);
  let viewRefusal = null;
  try {
    await localProvider.appendWeighingEvents(PROJECT, [assess({ subject: "V-home" })]);
  } catch (error) {
    viewRefusal = error;
  }
  check("a view is not a subject of the value matrix", viewRefusal !== null && /unknown_subject/.test(viewRefusal.message), viewRefusal?.message);
  // The browser never sees the HTTP parser: the planner is its only gate, so it must refuse what the route's body parser used to.
  for (const [name, bad] of [
    ["a confidence of 7", { confidence: 7 }],
    ["a fractional level (1.5)", { level: 1.5 }],
    ["an empty subject", { subject: "" }],
    ["evidence over the cap", { evidence: "x".repeat(2001) }],
  ]) {
    const countBefore = (await db.journals.get(PROJECT)).events.length;
    received.length = 0;
    let error = null;
    try {
      await localProvider.appendWeighingEvents(PROJECT, [assess(), assess(bad)]);
    } catch (e) {
      error = e;
    }
    check(`${name} is refused with a message, never a raw throw from the event schema`, error !== null && /Assessment refused — invalid_entry/.test(error.message), error?.message);
    check(`…and nothing is written or notified (${name})`, (await db.journals.get(PROJECT)).events.length === countBefore && received.length === 0);
  }
  let missing = null;
  try {
    await localProvider.appendWeighingEvents("p-nope", [assess()]);
  } catch (error) {
    missing = error;
  }
  check("an unknown project is an error", missing !== null && /not found/.test(missing.message));

  // --- it travels: export carries the events, import folds them back -----------
  const exported = await localProvider.exportProject(PROJECT);
  check("the exported bundle carries the events in its journal", exported.journal.filter((e) => e.type.startsWith("weighing.")).length === 4);
  check("…and no folded section — the section is a read, not a copy", exported.weighing === undefined);
  const db2 = __makeFakeDb();
  __setFakeDb(db2);
  await localProvider.importProject(exported);
  const reimported = await localProvider.getProject(PROJECT);
  check("importing it somewhere else folds the same assessment back", reimported.weighing?.assessments?.[0]?.level === -1 && reimported.weighing?.sets?.[0]?.status === "active");

  // --- an imported section and the events fold together -----------------------------
  const db3 = __makeFakeDb();
  __setFakeDb(db3);
  await localProvider.importProject(bundle({ weighing: { sets: [], matrices: [], assessments: [{ matrix: "value", subject: "AC-a", criterion: "connects", level: 3, scorer: { kind: "agent", id: "arkaik-mcp" }, confidence: 1, ts: "2026-11-14T10:00:00.000Z" }] } }));
  await localProvider.appendWeighingEvents(PROJECT, [assess({ level: 1 })]);
  const merged = (await localProvider.getProject(PROJECT)).weighing?.assessments ?? [];
  check("a packed section's agent row and a browser human row sit side by side", merged.length === 2 && merged.some((a) => a.scorer?.kind === "agent" && a.level === 3) && merged.some((a) => a.scorer?.kind === "human" && a.level === 1));

  unsubscribe();
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`\n${failures} weighing-provider test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing-provider tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

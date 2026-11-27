#!/usr/bin/env node

/**
 * A project's anatomy on the listing (lib/data/project-anatomy.ts): species and
 * platform counts from the nodes, journal events per UTC month, and the twelve
 * bars a card draws against the READER's today.
 */

const fs = require("fs");
const { loadProjectSections, BUILD_DIR } = require("./load-project-sections");
const localLoader = require("./load-local-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const { anatomyOf, lastTwelveMonths, monthKey } = loadProjectSections().anatomy;

  const nodes = [
    { species: "view", platforms: ["web", "ios"] },
    { species: "view", platforms: ["web"] },
    { species: "flow", platforms: [] },
    { species: "acceptance" },
  ];
  const a = anatomyOf(nodes);
  check("species are counted, absent ones left out", same(a.species, { view: 2, flow: 1, acceptance: 1 }), JSON.stringify(a.species));
  check("platforms are counted per node carrying them", same(a.platforms, { web: 2, ios: 1 }), JSON.stringify(a.platforms));
  check("no events → journal is null", a.journal === null);

  const events = [
    { ts: "2026-11-27T10:00:00.000Z" },
    { ts: "2026-11-01T00:00:00.000Z" },
    { ts: "2026-10-31T23:59:59.000Z" },
    { ts: "2025-01-02T00:00:00.000Z" },
    { type: "no-ts" },
  ];
  const j = anatomyOf([], events).journal;
  check("months are keyed off the ISO stamp", same(j.months, { "2026-11": 2, "2026-10": 1, "2025-01": 1 }), JSON.stringify(j.months));
  check("lastAt is the newest stamp", j.lastAt === "2026-11-27T10:00:00.000Z", j.lastAt);
  check("total counts every event, stamped or not", j.total === 5, String(j.total));
  check("only unstamped events → journal is null", anatomyOf([], [{}]).journal === null);
  check("monthKey", monthKey("2026-03-04T05:06:07Z") === "2026-03");

  const bars = lastTwelveMonths(j.months, new Date("2026-11-15T12:00:00Z"));
  check("twelve bars", bars.length === 12, String(bars.length));
  check("the last bar is now's month", bars[11] === 2, JSON.stringify(bars));
  check("the one before is the previous month", bars[10] === 1, JSON.stringify(bars));
  check("a month older than a year is outside", bars.reduce((s, v) => s + v, 0) === 3, JSON.stringify(bars));
  const jan = lastTwelveMonths({ "2025-12": 4, "2026-01": 1 }, new Date("2026-01-10T00:00:00Z"));
  check("the window crosses a year boundary", jan[11] === 1 && jan[10] === 4, JSON.stringify(jan));

  // The local backend's listing carries it, journal included.
  const { localProvider, __makeFakeDb, __setFakeDb } = localLoader.loadLocalProvider();
  __setFakeDb(__makeFakeDb());
  const project = { id: "p-anat", title: "Anat", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
  await localProvider.saveProject({
    schema_version: 3,
    project,
    nodes: [
      { id: "V-a", project_id: "p-anat", species: "view", title: "A", status: "idea", platforms: ["web"] },
      { id: "F-a", project_id: "p-anat", species: "flow", title: "F", status: "idea", platforms: [] },
    ],
    edges: [],
    journal: [{ id: "01KN44ARM0JH4YFMX52BGKNPKZ", ts: "2026-02-03T00:00:00.000Z", actor: "t", type: "node.created", node_id: "V-a", species: "view", title: "A" }],
  });
  const [listed] = await localProvider.listProjects();
  check(
    "the local listing carries species and platforms",
    same(listed?.anatomy?.species, { view: 1, flow: 1 }) && same(listed?.anatomy?.platforms, { web: 1 }),
    JSON.stringify(listed?.anatomy),
  );
  check(
    "the local listing carries the journal's months",
    same(listed?.anatomy?.journal, { months: { "2026-02": 1 }, lastAt: "2026-02-03T00:00:00.000Z", total: 1 }),
    JSON.stringify(listed?.anatomy?.journal),
  );
}

main()
  .catch((err) => {
    failures++;
    console.log(`FAIL: threw — ${err && err.stack}`);
  })
  .finally(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    fs.rmSync(localLoader.BUILD_DIR, { recursive: true, force: true });
    if (failures > 0) {
      console.log(`\n${failures} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll project-anatomy checks passed");
  });

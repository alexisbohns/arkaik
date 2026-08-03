#!/usr/bin/env node

/**
 * Which section a project belongs to (lib/data/project-sections.ts).
 *
 * There are only TWO storage backends — hosted and local. "Synked" is a state
 * of a local project (it has a Synk backup), not a third backend. These tests
 * pin that rule, and in particular that a signed-out session — where the backup
 * set is empty — collapses every local project into Lokal.
 */

const fs = require("fs");
const { loadProjectSections, BUILD_DIR } = require("./load-project-sections");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const summary = (id, hosted, seed) => ({
  project: { id, title: id },
  nodeCount: 0,
  edgeCount: 0,
  hosted,
  ...(seed ? { seed: true } : {}),
});

function main() {
  const { sections } = loadProjectSections();
  const { sectionFor, groupBySection } = sections;

  const hosted = summary("prj_abc", true);
  const backedUp = summary("local-1", false);
  const plain = summary("local-2", false);
  const backups = new Set(["local-1"]);

  check("hosted project is hosted", sectionFor(hosted, backups) === "hosted");
  check(
    "hosted project stays hosted even if its id is in the backup set",
    sectionFor(summary("prj_abc", true), new Set(["prj_abc"])) === "hosted"
  );
  check("local project with a backup is synked", sectionFor(backedUp, backups) === "synked");
  check("local project without a backup is lokal", sectionFor(plain, backups) === "lokal");
  check(
    "empty backup set collapses locals into lokal",
    sectionFor(backedUp, new Set()) === "lokal" && sectionFor(plain, new Set()) === "lokal"
  );

  const grouped = groupBySection([hosted, backedUp, plain], backups);
  check("groupBySection puts hosted in hosted", grouped.hosted.length === 1 && grouped.hosted[0] === hosted);
  check("groupBySection puts backed-up local in synked", grouped.synked.length === 1 && grouped.synked[0] === backedUp);
  check("groupBySection puts plain local in lokal", grouped.lokal.length === 1 && grouped.lokal[0] === plain);

  const ordered = groupBySection(
    [summary("local-a", false), summary("local-b", false), summary("local-c", false)],
    new Set()
  );
  check(
    "groupBySection preserves input order within a bucket",
    ordered.lokal.map((s) => s.project.id).join(",") === "local-a,local-b,local-c"
  );

  // --- The Explore section (self-map cycle 4) --------------------------------
  const seedSummary = summary("arkaik-self-map", false, true);
  const groupedWithSeed = groupBySection([seedSummary, hosted, backedUp, plain], backups);
  check("a seed summary lands in explore", groupedWithSeed.explore.length === 1 && groupedWithSeed.explore[0] === seedSummary);
  check("…and never in lokal, even with an empty backup set",
    groupBySection([seedSummary], new Set()).lokal.length === 0);
  check("the other sections are unchanged by the seed",
    groupedWithSeed.hosted.length === 1 && groupedWithSeed.synked.length === 1 && groupedWithSeed.lokal.length === 1);
  check("no seed means an empty explore section", grouped.explore.length === 0);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll project-section tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

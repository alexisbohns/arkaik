#!/usr/bin/env node

/**
 * The projects page as data (lib/data/project-page-model.ts). These are the
 * rules the card and section components render and must never re-derive:
 * who may move to the account, who gets a sync control, which sections exist
 * signed out, and that the totals leave the public example out.
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

const summary = (id, { hosted = false, seed = false, nodes = 1, edges = 0, updated = "2026-01-01" } = {}) => ({
  project: { id, title: id, created_at: "2026-01-01", updated_at: updated },
  nodeCount: nodes,
  edgeCount: edges,
  hosted,
  ...(seed ? { seed: true } : {}),
});

try {
  const { sections, pageModel } = loadProjectSections();
  const { buildCardModel, buildPageModel } = pageModel;
  const SYNC = { sync: true };
  const card = (s, section, canHost = true) =>
    buildCardModel(s, section, { canHost, moving: false, onMove: () => {}, syncNode: SYNC });

  const local = card(summary("l"), "lokal");
  check("a browser-held project can move to the account", local.move !== null);
  check("a browser-held project gets its sync control", local.syncNode === SYNC);
  check("signed out (no account) nothing can move", card(summary("l"), "lokal", false).move === null);
  const hosted = card(summary("h", { hosted: true }), "hosted");
  check("a hosted project neither moves nor syncs", hosted.move === null && hosted.syncNode === null);
  const seed = card(summary("s", { seed: true }), "explore");
  check("the public example neither moves nor syncs", seed.move === null && seed.syncNode === null && seed.isSeed);
  check("the card links to the project", local.href === "/project/l", local.href);
  check("no anatomy on the summary → null", local.anatomy === null);
  const anatomy = { species: { view: 1 }, platforms: {}, journal: null };
  check("the summary's anatomy rides through", card({ ...summary("a"), anatomy }, "lokal").anatomy === anatomy);

  const list = [
    summary("h1", { hosted: true, nodes: 10, edges: 4, updated: "2026-03-01" }),
    summary("l1", { nodes: 5, edges: 1, updated: "2026-05-01" }),
    summary("seed", { seed: true, nodes: 200, edges: 400 }),
  ];
  const build = (signedIn) =>
    buildPageModel({
      signedIn,
      importing: false,
      grouped: sections.groupBySection(list, new Set()),
      card: (s, section) => card(s, section, signedIn),
      actions: { create() {}, import() {}, restore() {}, generateHref: (t) => `/generate?target=${t}` },
    });

  const inPage = build(true);
  check("signed in: three sections, in order", inPage.sections.map((s) => s.target).join() === "hosted,synked,lokal");
  check("only Synked can restore", inPage.sections.map((s) => s.canRestore).join() === "false,true,false");
  check("totals count your own projects only", JSON.stringify(inPage.totals) === '{"projects":2,"nodes":15,"edges":5}', JSON.stringify(inPage.totals));
  check("the example sits in Explore", inPage.explore.length === 1 && inPage.explore[0].section === "explore");
  check("recent is newest first, without the example", inPage.recent.map((c) => c.id).join() === "l1,h1");
  check("a section carries its copy", inPage.sections[0].title === "Hosted" && /account/.test(inPage.sections[0].blurb));

  const outPage = build(false);
  check("signed out: Lokal only", outPage.sections.map((s) => s.target).join() === "lokal");
} finally {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll project-page-model checks passed");

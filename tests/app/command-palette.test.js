#!/usr/bin/env node

/**
 * ⌘K palette brain (lib/utils/command-palette.ts). Pins the three promises the
 * overlay makes to the keyboard:
 * - the first row is the one Enter should validate (ranking),
 * - Tab fills in the row's own wording (completion),
 * - and every sidebar destination is reachable by typing it (catalogue).
 */

const fs = require("fs");
const { loadCommandPalette, BUILD_DIR } = require("./load-command-palette");

const { buildProjectCommands, buildDocsCommands, rankCommands, completionSuffix, COMMAND_GROUPS } =
  loadCommandPalette();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const commands = buildProjectCommands({
  projectId: "proj-1",
  customMaps: [{ id: "onboarding", title: "Onboarding audit" }],
});

/** The label Enter would validate for a given query. */
function topLabel(query) {
  return rankCommands(commands, query)[0]?.command.label;
}

function commandById(id) {
  return commands.find((command) => command.id === id);
}

// --- catalogue: every sidebar destination is in the palette ---
const expectedHrefs = [
  "/project/proj-1/maps",
  "/project/proj-1/maps/journey",
  "/project/proj-1/maps/system",
  "/project/proj-1/maps/screens",
  "/project/proj-1/maps/onboarding",
  "/project/proj-1/library",
  "/project/proj-1/library?species=view",
  "/project/proj-1/library?species=flow",
  "/project/proj-1/library?species=data-model",
  "/project/proj-1/library?species=api-endpoint",
  "/project/proj-1/acceptances",
  "/project/proj-1/overview",
  "/project/proj-1/pyramid",
  "/project/proj-1/delivery",
  "/project/proj-1/changelog",
  "/project/proj-1/quality/matrix",
  "/project/proj-1/quality/findings",
  "/project/proj-1/settings",
];
const hrefs = new Set(
  commands.filter((command) => command.target.kind === "href").map((command) => command.target.href),
);
for (const href of expectedHrefs) {
  assert(hrefs.has(href), `catalogue reaches ${href}`);
}
assert(
  commands.some((command) => command.target.kind === "action" && command.target.action === "publish"),
  "Publish is reachable as an action, not a route",
);
assert(
  commandById("docs").target.external === true,
  "Documentation is flagged external (new tab, not a client push)",
);

const groupIds = new Set(COMMAND_GROUPS.map((group) => group.id));
assert(
  commands.every((command) => groupIds.has(command.group)),
  "every command belongs to a declared group",
);
assert(
  new Set(commands.map((command) => command.id)).size === commands.length,
  "command ids are unique (React keys and the active-index map depend on it)",
);

// --- ranking: the first suggestion is the obvious one ---
assert(topLabel("acc") === "Acceptances", `"acc" → Acceptances (got ${topLabel("acc")})`);
assert(topLabel("set") === "Settings", `"set" → Settings (got ${topLabel("set")})`);
assert(topLabel("jour") === "Journey", `"jour" → Journey (got ${topLabel("jour")})`);
assert(topLabel("deliv") === "Delivery", `"deliv" → Delivery (got ${topLabel("deliv")})`);
assert(topLabel("Journey") === "Journey", "matching is case-insensitive");
assert(topLabel("onboarding") === "Onboarding audit", "custom maps are searchable by title");

// An exact word wins over the longer label that merely contains it.
assert(topLabel("views") === "Views", `"views" → Views (got ${topLabel("views")})`);

// The Screens map owns its own name: an exact label (10000) outranks the
// Library Views command's "screens" keyword (9000).
assert(topLabel("screens") === "Screens", `"screens" → Screens (got ${topLabel("screens")})`);
assert(topLabel("screenshots") === "Screens", `"screenshots" → Screens (got ${topLabel("screenshots")})`);
assert(
  commandById("map-screens")?.target.href === "/project/proj-1/maps/screens" &&
    commandById("map-screens")?.icon === "screens" &&
    commandById("map-screens")?.group === "maps",
  "map-screens is a Maps command with its own icon, landing on /maps/screens",
);
assert(
  commands.findIndex((command) => command.id === "map-screens") ===
    commands.findIndex((command) => command.id === "map-system") + 1,
  "Screens sits right after System, as in the sidebar",
);

// Keyword hits: a synonym finds the page even though no label contains it.
assert(topLabel("pages") === "Views", `"pages" → Views (got ${topLabel("pages")})`);
assert(topLabel("kanban") === "Delivery", `"kanban" → Delivery (got ${topLabel("kanban")})`);
assert(topLabel("dark mode") === "Toggle theme", `"dark mode" → Toggle theme (got ${topLabel("dark mode")})`);

// A label prefix outranks another command's keyword of the same shape.
const changelogFirst = rankCommands(commands, "chang")[0];
assert(changelogFirst.command.id === "changelog", "label prefix beats keyword-only matches");

// Subsequence, the loosest tier, still finds a two-word label.
assert(topLabel("dmo") === "Data Models", `"dmo" → Data Models (got ${topLabel("dmo")})`);

// Nothing at all matches → no rows, so the overlay can show its empty state.
assert(rankCommands(commands, "zzzqq").length === 0, "a hopeless query ranks nothing");

// An empty query keeps the authored order, so the palette opens reading like
// the sidebar instead of on an arbitrary tie-break.
const idle = rankCommands(commands, "");
assert(idle.length === commands.length, "an empty query keeps every command");
assert(
  idle.every((match, index) => match.command.id === commands[index].id),
  "an empty query preserves declaration order",
);

// --- highlight: what the overlay emphasises, and where ---
const acceptances = rankCommands(commands, "cept")[0];
assert(
  acceptances.command.id === "acceptances" &&
    acceptances.highlight.join(",") === "2,3,4,5",
  `"cept" highlights the matched run inside Acceptances (got ${acceptances.highlight.join(",")})`,
);
const viaKeyword = rankCommands(commands, "pages")[0];
assert(
  viaKeyword.command.id === "library-view" && viaKeyword.highlight.length === 0,
  "a keyword hit highlights nothing — there is no run to underline in the label",
);

// --- completion: what Tab fills in ---
assert(completionSuffix("acc", rankCommands(commands, "acc")[0]) === "eptances", "Tab completes acc → Acceptances");
assert(completionSuffix("J", rankCommands(commands, "J")[0]) === "ourney", "completion is case-insensitive but keeps the label's casing");
assert(
  completionSuffix("page", rankCommands(commands, "page")[0]) === "s",
  "a synonym being typed completes to the synonym, not to the label",
);
assert(
  completionSuffix("dmo", rankCommands(commands, "dmo")[0]) === "",
  "a subsequence match offers no ghost — there is nothing to append",
);
assert(completionSuffix("", rankCommands(commands, "")[0]) === "", "an empty query offers no ghost");
assert(
  completionSuffix("Journey", rankCommands(commands, "Journey")[0]) === "",
  "a fully typed label offers no ghost",
);
assert(
  completionSuffix("  acc", rankCommands(commands, "  acc")[0]) === "",
  "stray whitespace suppresses the ghost rather than drawing a misaligned one",
);
assert(completionSuffix("acc", undefined) === "", "no active row, no ghost");

// --- docs catalogue: the same brain, pointed at the documentation tree ---
const docsPages = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/vision", label: "Vision" },
  { href: "/docs/conventions", label: "Conventions" },
  // Title and filename drift apart on purpose here — that is the case the slug
  // keywords exist for.
  { href: "/docs/graph-model", label: "The five species" },
  { href: "/docs/spec/bundle-format", label: "Bundle Format", section: "Spec" },
  { href: "/docs/spec/journal", label: "Journal", section: "Spec" },
];
const docsCommands = buildDocsCommands({ pages: docsPages });

function docsTopLabel(query) {
  return rankCommands(docsCommands, query)[0]?.command.label;
}

function docsCommandById(id) {
  return docsCommands.find((command) => command.id === id);
}

const docsHrefs = new Set(
  docsCommands
    .filter((command) => command.target.kind === "href")
    .map((command) => command.target.href),
);
for (const page of docsPages) {
  assert(docsHrefs.has(page.href), `docs catalogue reaches ${page.href}`);
}
assert(
  new Set(docsCommands.map((command) => command.id)).size === docsCommands.length,
  "docs command ids are unique (the href makes them so)",
);
assert(
  docsCommands.every((command) => groupIds.has(command.group)),
  "every docs command belongs to a declared group",
);
assert(
  docsCommands
    .filter((command) => command.group === "pages")
    .every((command) => command.target.kind === "href" && !command.target.external),
  "docs pages navigate in place — the docs shell is where you already are",
);
assert(
  docsCommands
    .filter((command) => command.group === "pages")
    .every((command, index) => command.label === docsPages[index].label),
  "docs pages keep the sidebar's reading order",
);

// Ranking: typing the page finds the page.
assert(docsTopLabel("vision") === "Vision", `"vision" → Vision (got ${docsTopLabel("vision")})`);
assert(
  docsTopLabel("bundle") === "Bundle Format",
  `"bundle" → Bundle Format (got ${docsTopLabel("bundle")})`,
);
assert(
  docsTopLabel("conv") === "Conventions",
  `"conv" → Conventions (got ${docsTopLabel("conv")})`,
);

// The address is a synonym: a page whose title says nothing about its filename
// is still reachable by the filename, hyphens or spaces.
assert(
  docsTopLabel("graph-model") === "The five species",
  `"graph-model" → The five species (got ${docsTopLabel("graph-model")})`,
);
assert(
  docsTopLabel("graph model") === "The five species",
  `"graph model" → The five species (got ${docsTopLabel("graph model")})`,
);
assert(
  docsTopLabel("spec/journal") === "Journal",
  `a full slug path finds its page (got ${docsTopLabel("spec/journal")})`,
);
assert(
  completionSuffix("graph-mo", rankCommands(docsCommands, "graph-mo")[0]) === "del",
  "Tab completes the slug being typed, not the unrelated title",
);

// The folder trail rides along as the row's hint, so two same-named pages in
// different sections stay tellable apart.
assert(
  docsCommandById("doc:/docs/spec/journal").hint === "Spec",
  "a nested page shows its section as the hint",
);
assert(
  docsCommandById("doc:/docs/vision").hint === undefined,
  "a top-level page has no section to show",
);

// Actions: the theme is shared with the project palette, Publish is not offered.
assert(
  docsTopLabel("dark mode") === "Toggle theme",
  `"dark mode" → Toggle theme in the docs too (got ${docsTopLabel("dark mode")})`,
);
assert(
  docsCommands.every(
    (command) => !(command.target.kind === "action" && command.target.action === "publish"),
  ),
  "the docs palette never offers Publish — there is no project to publish",
);
assert(
  docsCommandById("back-to-app").target.href === "/projects",
  "the docs palette leads back to the app",
);

// --- search-only rows: ranking and the per-group cap (Screens map stack, part 5) ---
// Read off the module the loader already required at the top of this file: the
// require cache holds it, so this is the same instance, not a second build.
const nodePath = require("path");
const nodePalette = require(nodePath.join(BUILD_DIR, "command-palette.js"));
const { limitSearchOnly, NODE_PENALTY, SEARCH_ONLY_PER_GROUP } = nodePalette;

assert(NODE_PENALTY === 500, `NODE_PENALTY is 500 (got ${NODE_PENALTY})`);
assert(SEARCH_ONLY_PER_GROUP === 6, `SEARCH_ONLY_PER_GROUP is 6 (got ${SEARCH_ONLY_PER_GROUP})`);
assert(
  COMMAND_GROUPS.map((group) => group.id).join(",") === "create,pages,maps,flows,views,library,project,actions",
  `Flows and Views sit right after Maps (got ${COMMAND_GROUPS.map((group) => group.id).join(",")})`,
);
assert(
  COMMAND_GROUPS.find((group) => group.id === "flows")?.label === "Flows" &&
    COMMAND_GROUPS.find((group) => group.id === "views")?.label === "Views",
  "the two new groups read Flows and Views",
);

/** A search-only row by hand: the shape a node row has, with an href target. */
function searchRow(nodeId, label, group = "views") {
  return {
    id: `test:${nodeId}`,
    label,
    group,
    icon: group,
    keywords: [nodeId],
    hint: "test row",
    searchOnly: true,
    target: { kind: "href", href: `/test/${nodeId}` },
  };
}
const handRows = [
  searchRow("V-settings", "Settings"),
  searchRow("V-change", "Change"),
  searchRow("V-home", "Home"),
  searchRow("F-checkin", "Check in", "flows"),
];
const withHandRows = [...commands, ...handRows];
function ranked(query) {
  return rankCommands(withHandRows, query).map((match) => `${match.command.id}@${match.score}`);
}

// The idle palette is unchanged: search-only rows never show on an empty query.
const idleWithRows = rankCommands(withHandRows, "");
assert(
  idleWithRows.length === commands.length &&
    idleWithRows.every((match, index) => match.command.id === commands[index].id),
  "an empty query drops every search-only row and keeps the catalogue's order",
);
assert(
  rankCommands(withHandRows, "   ").every((match) => !match.command.searchOnly),
  "a blank query is an empty one",
);

// NODE_PENALTY: a page beats a node title of the same shape…
assert(
  ranked("settings").slice(0, 2).join(" ") === "settings@10000 test:V-settings@9500",
  `"settings": the page (10000) above a view titled Settings (9500) (got ${ranked("settings").slice(0, 2).join(" ")})`,
);
// …but a node's exact title beats a page's prefix and a page's exact keyword.
assert(
  ranked("change").slice(0, 2).join(" ") === "test:V-change@9500 changelog@7997",
  `"change": an exact view title (9500) above the Changelog prefix (7997) (got ${ranked("change").slice(0, 2).join(" ")})`,
);
assert(
  ranked("home").slice(0, 3).join(" ") === "test:V-home@9500 overview@9000 projects@9000",
  `"home": an exact view title (9500) above two exact page keywords (9000) (got ${ranked("home").slice(0, 3).join(" ")})`,
);
// An id is a keyword: exact at 10000 − 1000 − 500.
assert(
  ranked("v-home").join(" ") === "test:V-home@8500",
  `an id finds its node at 8500 (got ${ranked("v-home").join(" ")})`,
);
assert(
  rankCommands(withHandRows, "v-home")[0].highlight.length === 0,
  "an id hit highlights nothing — the id is a keyword",
);

// limitSearchOnly: at most six search-only rows per group, every other row kept.
const crowd = [
  ...commands,
  ...Array.from({ length: 9 }, (_, index) => searchRow(`V-screen-${index}`, `Screen ${index}`)),
  searchRow("F-screen-a", "Screen flow a", "flows"),
  searchRow("F-screen-b", "Screen flow b", "flows"),
];
const countIn = (matches, group) => matches.filter((match) => match.command.group === group).length;
const crowdRanked = rankCommands(crowd, "screen");
const crowdLimited = limitSearchOnly(crowdRanked);
assert(countIn(crowdRanked, "views") === 9, `nine views match before the cap (got ${countIn(crowdRanked, "views")})`);
assert(countIn(crowdLimited, "views") === 6, `six views remain after it (got ${countIn(crowdLimited, "views")})`);
assert(countIn(crowdLimited, "flows") === 2, `a group under the cap is whole (got ${countIn(crowdLimited, "flows")})`);
assert(
  crowdRanked.filter((match) => !match.command.searchOnly).every((match) => crowdLimited.includes(match)),
  "the cap never drops a page or an action",
);
assert(
  crowdLimited.length === crowdRanked.length - 3 &&
    crowdLimited.every((match, index) => crowdRanked.filter((kept) => crowdLimited.includes(kept))[index] === match),
  "the cap drops only the surplus and keeps the ranked order",
);
assert(
  crowdLimited.filter((match) => match.command.group === "views").map((match) => match.command.label).join(",") ===
    "Screen 0,Screen 1,Screen 2,Screen 3,Screen 4,Screen 5",
  "the six kept are the group's six best",
);
const capTwo = limitSearchOnly(crowdRanked, 2);
assert(
  countIn(capTwo, "views") === 2 && countIn(capTwo, "flows") === 2,
  `an explicit cap applies per group (got views ${countIn(capTwo, "views")}, flows ${countIn(capTwo, "flows")})`,
);
const catalogueA = rankCommands(commands, "a");
assert(limitSearchOnly(catalogueA).length === catalogueA.length, "a catalogue with no search-only rows passes through whole");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll command palette tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);

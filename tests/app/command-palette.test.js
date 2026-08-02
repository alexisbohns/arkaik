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

// Keyword hits: a synonym finds the page even though no label contains it.
assert(topLabel("screens") === "Views", `"screens" → Views (got ${topLabel("screens")})`);
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
const viaKeyword = rankCommands(commands, "screens")[0];
assert(
  viaKeyword.highlight.length === 0,
  "a keyword hit highlights nothing — there is no run to underline in the label",
);

// --- completion: what Tab fills in ---
assert(completionSuffix("acc", rankCommands(commands, "acc")[0]) === "eptances", "Tab completes acc → Acceptances");
assert(completionSuffix("J", rankCommands(commands, "J")[0]) === "ourney", "completion is case-insensitive but keeps the label's casing");
assert(
  completionSuffix("screen", rankCommands(commands, "screen")[0]) === "s",
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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll command palette tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node

/**
 * The project sidebar's navigation model (components/layout/sidebar-nav-model.ts).
 * Every rendering of the sidebar — the Expressive tiles, the Calm tree, the
 * collapsed rail — reads which row is active from this one function, so the
 * subtle rules live, and are pinned, here:
 * - Matrix is the Quality page unless Findings is open;
 * - "All maps" / "All nodes" only when no map / no species is open;
 * - a species row only on its own `?species=` page;
 * - custom maps follow the built-in four, flagged `custom`;
 * - exactly one row is active on any page.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-sidebar-nav");

function transpile(relative, outName, rewrites = {}) {
  let source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  for (const [from, to] of Object.entries(rewrites)) source = source.split(`"${from}"`).join(`"${to}"`);
  const { outputText } = ts.transpileModule(source, {
    fileName: outName.replace(/\.js$/, ".ts"),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  fs.writeFileSync(path.join(BUILD_DIR, outName), outputText);
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
// The model's only runtime import beside lucide-react is the shared species vocabulary.
transpile("lib/config/species-icons.ts", "species-icons.js");
transpile("components/layout/sidebar-nav-model.ts", "sidebar-nav-model.js", {
  "@/lib/config/species-icons": "./species-icons.js",
});
const { buildSidebarNav } = require(path.join(BUILD_DIR, "sidebar-nav-model.js"));

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const base = {
  projectId: "p1",
  currentView: "overview",
  currentSpecies: null,
  currentQualityView: null,
  currentMapId: null,
  customMaps: [{ id: "onboarding", title: "Onboarding audit" }],
};
const nav = (patch) => buildSidebarNav({ ...base, ...patch });
const active = (groups) => groups.flatMap((g) => g.items.filter((i) => i.active).map((i) => i.id));

const groups = nav({});
assert(
  groups.map((g) => g.id).join(",") === "project,quality,maps,library",
  "four groups, in reading order: Project, Quality, Maps, Library",
);
const ids = groups.flatMap((g) => g.items.map((i) => i.id));
assert(new Set(ids).size === ids.length, "every row id is unique (it is the data-nav-item hook)");
assert(
  groups.every((g) => g.items.every((i) => i.href.startsWith("/project/p1/"))),
  "every row links inside the project",
);

const cases = [
  [{ currentView: "overview" }, "overview"],
  [{ currentView: "quality", currentQualityView: "matrix" }, "matrix"],
  [{ currentView: "quality", currentQualityView: null }, "matrix"],
  [{ currentView: "quality", currentQualityView: "findings" }, "findings"],
  [{ currentView: "maps" }, "maps"],
  [{ currentView: "maps", currentMapId: "journey" }, "journey"],
  [{ currentView: "maps", currentMapId: "onboarding" }, "map-onboarding"],
  [{ currentView: "library" }, "library"],
  [{ currentView: "library", currentSpecies: "flow" }, "flow"],
  [{ currentView: "acceptances" }, "acceptances"],
  [{ currentView: "decisions" }, "decisions"],
];
for (const [patch, expected] of cases) {
  const got = active(nav(patch));
  assert(
    got.length === 1 && got[0] === expected,
    `${JSON.stringify(patch)} lights exactly "${expected}" (got ${JSON.stringify(got)})`,
  );
}
assert(active(nav({ currentView: "settings" })).length === 0, "a page with no row (Settings) lights none");

const maps = groups.find((g) => g.id === "maps").items;
const custom = maps[maps.length - 1];
assert(
  custom.custom === true && custom.href === "/project/p1/maps/onboarding" && custom.label === "Onboarding audit",
  "a custom map follows the built-in four, flagged custom, titled as authored",
);
const library = groups.find((g) => g.id === "library").items;
assert(
  library.filter((i) => i.species).map((i) => i.species).join(",") === "acceptance,decision,view,flow,data-model,api-endpoint",
  "Library rows carry their species (the hook species-tinted renderings read)",
);
assert(
  library.find((i) => i.id === "flow").href === "/project/p1/library?species=flow",
  "a species row is the library filtered to it",
);
const chords = groups.flatMap((g) => g.items.filter((i) => i.shortcutId).map((i) => i.shortcutId));
const { NAV_HOTKEY_ROUTES } = (() => {
  transpile("lib/utils/keyboard-shortcuts.ts", "keyboard-shortcuts.js");
  return require(path.join(BUILD_DIR, "keyboard-shortcuts.js"));
})();
assert(
  chords.length === Object.keys(NAV_HOTKEY_ROUTES).length && chords.every((id) => id in NAV_HOTKEY_ROUTES),
  "every ⌥ chord the registry routes is shown on exactly one row",
);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll sidebar nav model tests passed.");

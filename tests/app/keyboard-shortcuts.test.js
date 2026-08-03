#!/usr/bin/env node

/**
 * The ⌘? cheat sheet (lib/utils/keyboard-shortcuts.ts) and the chord that opens
 * it (lib/utils/keyboard.ts). Pins the three promises the dialog makes:
 * - ⌘?/Ctrl+? is recognised however the layout reports the question mark,
 * - it never fires on a bare `?` (that would eat typing),
 * - and the sheet lists chords the app actually answers to, scoped to where
 *   they fire — nothing project-specific leaks into the docs shell.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-keyboard-shortcuts");

function loadModule(relative, outName) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const outPath = path.join(BUILD_DIR, outName);
  fs.writeFileSync(outPath, outputText);
  delete require.cache[outPath];
  return require(outPath);
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

const { getShortcutGroups, formatShortcutKey, MOD_KEY_TOKEN } = loadModule(
  "lib/utils/keyboard-shortcuts.ts",
  "keyboard-shortcuts.js",
);
const { isShortcutsDialogShortcut, isCommandPaletteShortcut } = loadModule(
  "lib/utils/keyboard.ts",
  "keyboard.js",
);

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

function event(overrides) {
  return {
    key: "?",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

// --- the chord ---
assert(isShortcutsDialogShortcut(event({ metaKey: true, shiftKey: true })), "⌘? opens the sheet");
assert(isShortcutsDialogShortcut(event({ ctrlKey: true, shiftKey: true })), "Ctrl+? opens the sheet");
assert(
  isShortcutsDialogShortcut(event({ key: "/", ctrlKey: true, shiftKey: true })),
  "Ctrl+Shift+/ counts too — same physical keys, different report",
);
assert(!isShortcutsDialogShortcut(event({})), "a bare ? never opens the sheet");
assert(
  !isShortcutsDialogShortcut(event({ key: "/", metaKey: true })),
  "⌘/ without Shift is not the chord",
);
assert(
  !isShortcutsDialogShortcut(event({ metaKey: true, altKey: true, shiftKey: true })),
  "adding Alt makes it a different chord",
);
assert(
  !isCommandPaletteShortcut(event({ key: "k", metaKey: true, shiftKey: true })),
  "⌘? and ⌘K cannot both fire — the palette declines Shift",
);

// --- the sheet ---
const projectGroups = getShortcutGroups(true);
const docsGroups = getShortcutGroups(false);

const projectIds = projectGroups.flatMap((group) => group.shortcuts.map((s) => s.id));
const docsIds = docsGroups.flatMap((group) => group.shortcuts.map((s) => s.id));

assert(projectIds.includes("shortcuts"), "the sheet documents the chord that opened it");
assert(docsIds.includes("shortcuts"), "…on every surface, including the docs shell");
assert(
  ["command-palette", "toggle-sidebar", "export", "delete-node"].every((id) =>
    projectIds.includes(id),
  ),
  "every chord the project shell registers is listed",
);
assert(
  !docsIds.some((id) => ["toggle-sidebar", "export", "delete-node"].includes(id)),
  "project-only chords stay out of the docs sheet",
);
assert(
  docsGroups.every((group) => group.shortcuts.length > 0),
  "no empty group survives the scope filter",
);
assert(new Set(projectIds).size === projectIds.length, "shortcut ids are unique");
assert(
  projectGroups.every((group) => group.shortcuts.every((s) => s.keys.length > 0 && s.description)),
  "every row has keys and a description",
);

// --- rendering ---
assert(formatShortcutKey(MOD_KEY_TOKEN, "⌘") === "⌘", "Mod renders as ⌘ on Apple keyboards");
assert(formatShortcutKey(MOD_KEY_TOKEN, "Ctrl") === "Ctrl", "…and as Ctrl elsewhere");
assert(formatShortcutKey(MOD_KEY_TOKEN, null) === "Ctrl", "unknown platform falls back to Ctrl");
assert(formatShortcutKey("K", "⌘") === "K", "plain keys render as themselves");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll keyboard shortcut tests passed");

#!/usr/bin/env node

/**
 * The shortcut registry (lib/utils/keyboard-shortcuts.ts) and the TanStack
 * hotkey strings it hands to `useShortcut`. Pins:
 * - every registered string is a hotkey TanStack accepts,
 * - no two entries claim the same chord (TanStack would fire both, silently),
 * - each chord matches the events it always has — ⌘? however the layout reports
 *   the question mark, never a bare `?` — and nothing it shouldn't,
 * - the cheat sheet lists what the app answers to, scoped to where it fires.
 *
 * `@tanstack/hotkeys` is ESM-only and CI runs Node 20, so it is loaded with a
 * dynamic `import()`, never `require`.
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
    code: "Slash",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  };
}

/** Every file under `dir` with one of `exts`, skipping node_modules. */
function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

async function main() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const hotkeys = await import("@tanstack/hotkeys");
  const registry = loadModule("lib/utils/keyboard-shortcuts.ts", "keyboard-shortcuts.js");
  const {
    getShortcutGroups,
    getShortcut,
    allShortcuts,
    formatShortcutKey,
    formatChord,
    MOD_KEY_TOKEN,
    ALT_KEY_TOKEN,
    NAV_HOTKEY_ROUTES,
  } = registry;

  /** Does any of the entry's registered strings match this event? */
  function fires(id, overrides, platform = "mac") {
    return getShortcut(id).hotkeys.some((hotkey) =>
      hotkeys.matchesKeyboardEvent(event(overrides), hotkey, platform),
    );
  }

  // --- the registry is well-formed ---
  const registered = allShortcuts().filter((s) => s.hotkeys && s.hotkeys.length > 0);
  const strings = registered.flatMap((s) => s.hotkeys.map((hotkey) => ({ id: s.id, hotkey })));

  for (const { id, hotkey } of strings) {
    const result = hotkeys.validateHotkey(hotkey);
    assert(result.valid && result.warnings.length === 0, `${id}: "${hotkey}" is a valid TanStack hotkey`);
  }

  for (const platform of ["mac", "windows"]) {
    const seen = new Map();
    for (const { id, hotkey } of strings) {
      const canonical = hotkeys.normalizeHotkey(hotkey, platform);
      const clash = seen.get(canonical);
      assert(!clash, `${id}: "${hotkey}" is claimed once on ${platform}${clash ? ` (also by ${clash})` : ""}`);
      seen.set(canonical, id);
    }
  }

  let threw = false;
  try {
    getShortcut("no-such-shortcut");
  } catch {
    threw = true;
  }
  assert(threw, "getShortcut refuses an id the registry does not know");

  threw = false;
  try {
    getShortcut("palette-move");
  } catch {
    threw = true;
  }
  assert(threw, "getShortcut refuses a documentation-only row (nothing to register)");

  // --- the chords match what they always have ---
  assert(fires("shortcuts", { metaKey: true, shiftKey: true }), "⌘? opens the sheet");
  assert(fires("shortcuts", { ctrlKey: true, shiftKey: true }, "windows"), "Ctrl+? opens the sheet");
  assert(
    fires("shortcuts", { key: "/", ctrlKey: true, shiftKey: true }, "windows"),
    "Ctrl+Shift+/ counts too — same physical keys, different report",
  );
  assert(
    fires("shortcuts", { key: "?", code: "KeyM", metaKey: true, shiftKey: true }),
    "⌘? on a French AZERTY Mac (? is Shift+, there) opens the sheet",
  );
  assert(
    fires("shortcuts", { key: "?", code: "Minus", ctrlKey: true, shiftKey: true }, "windows"),
    "Ctrl+? on a German layout opens the sheet",
  );
  assert(!fires("shortcuts", { shiftKey: true }), "a bare ? never opens the sheet");
  assert(!fires("shortcuts", { key: "/", metaKey: true }), "⌘/ without Shift is not the chord");
  assert(
    !fires("shortcuts", { metaKey: true, altKey: true, shiftKey: true }),
    "adding Alt makes it a different chord",
  );

  assert(fires("command-palette", { key: "k", code: "KeyK", metaKey: true }), "⌘K opens the palette");
  assert(fires("command-palette", { key: "k", code: "KeyK", ctrlKey: true }, "windows"), "Ctrl+K opens it off-Mac");
  assert(
    !fires("command-palette", { key: "K", code: "KeyK", metaKey: true, shiftKey: true }),
    "⌘? and ⌘K cannot both fire — the palette declines Shift",
  );
  assert(
    !fires("command-palette", { key: "˚", code: "KeyK", metaKey: true, altKey: true }),
    "⌘⌥K is not the palette",
  );

  assert(fires("export", { key: "e", code: "KeyE", metaKey: true }), "⌘E exports");
  assert(!fires("export", { key: "E", code: "KeyE", metaKey: true, shiftKey: true }), "⌘⇧E does not");

  assert(fires("toggle-sidebar", { key: "b", code: "KeyB", metaKey: true }), "⌘B toggles the sidebar");

  assert(fires("close", { key: "Escape", code: "Escape" }), "Escape closes");

  assert(fires("delete-node", { key: "Delete", code: "Delete" }), "Delete deletes");
  assert(fires("delete-node", { key: "Backspace", code: "Backspace" }), "…and so does Backspace");
  assert(
    !fires("delete-node", { key: "Backspace", code: "Backspace", metaKey: true }),
    "⌘Backspace is a text chord, not a delete",
  );

  assert(fires("shot-prev", { key: "ArrowLeft", code: "ArrowLeft" }), "← pages back");
  assert(fires("shot-next", { key: "ArrowRight", code: "ArrowRight" }), "→ pages forward");

  // --- nothing hand-rolls a window shortcut any more ---
  // The two capture-phase Escape interceptors stay: they stop propagation at
  // window capture so an open dropdown's Escape never reaches the panel stack's
  // document listener. Moving them onto TanStack would break exactly that.
  const CAPTURE_INTERCEPTORS = ["components/ui/combobox.tsx", "components/values/ValuePicker.tsx"];
  const sources = ["app", "components", "lib", "hooks"]
    .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
    .flatMap((dir) => walk(path.join(ROOT, dir), [".ts", ".tsx"]));

  for (const file of sources) {
    const relative = path.relative(ROOT, file);
    if (CAPTURE_INTERCEPTORS.includes(relative)) continue;
    const text = fs.readFileSync(file, "utf8");
    assert(
      !/(window|document)\.addEventListener\(\s*["']keydown["']/.test(text),
      `${relative} registers no hand-rolled keydown listener`,
    );
  }

  // Every literal `useShortcut("id"` names a registry row with something to register.
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/useShortcut\(\s*["']([^"']+)["']/g)) {
      let ok = true;
      try {
        getShortcut(match[1]);
      } catch {
        ok = false;
      }
      assert(ok, `${path.relative(ROOT, file)}: useShortcut("${match[1]}") names a registered row`);
    }
  }

  // --- navigation chords ---
  const navGroup = getShortcutGroups(true).find((group) => group.id === "navigation");
  assert(Boolean(navGroup), "the sheet has a Navigation group");
  const navIds = navGroup ? navGroup.shortcuts.map((s) => s.id) : [];
  const routeIds = Object.keys(NAV_HOTKEY_ROUTES);
  assert(
    navIds.length === routeIds.length && navIds.every((id) => routeIds.includes(id)),
    "every navigation row has exactly one route, and every route a row",
  );
  // Built-in maps are served by the dynamic `maps/[mapId]` route, not a
  // literal directory per map — so a route under `maps/` is checked against
  // the id, not the filesystem, and only these two ids are wired up there.
  const BUILT_IN_MAP_IDS = ["journey", "system"];
  assert(
    fs.existsSync(path.join(ROOT, "app", "project", "[id]", "maps", "[mapId]")),
    "the dynamic maps/[mapId] route exists to serve the built-in maps",
  );
  for (const [id, route] of Object.entries(NAV_HOTKEY_ROUTES)) {
    const segments = route.split("/");
    if (segments[0] === "maps" && segments.length > 1) {
      assert(
        segments.length === 2 && BUILT_IN_MAP_IDS.includes(segments[1]),
        `${id} → ${route} names a built-in map (journey or system) on the dynamic maps/[mapId] route`,
      );
    } else {
      assert(
        fs.existsSync(path.join(ROOT, "app", "project", "[id]", ...segments)),
        `${id} → ${route} lands on a real project page`,
      );
    }
  }

  assert(
    fires("nav-overview", { key: "ø", code: "KeyO", altKey: true }),
    "⌥O on a Mac (which types ø) still goes to Overview",
  );
  assert(fires("nav-delivery", { key: "d", code: "KeyD", altKey: true }, "windows"), "Alt+D off-Mac too");
  assert(!fires("nav-acceptances", { key: "a", code: "KeyA" }), "a bare a is not ⌥A");
  assert(fires("toggle-sidebar", { key: "ß", code: "KeyS", altKey: true }), "⌥S also toggles the sidebar");

  // --- Option chords follow the layout ---
  // TanStack's fallback for a garbled Option character assumes US positions;
  // layoutAwareHotkey rebinds Alt+<letter> to the key labelled with it.
  const { layoutAwareHotkey } = registry;
  const azerty = new Map(
    "abcdefghijklmnopqrstuvwxyz".split("").map((letter) => [`Key${letter.toUpperCase()}`, letter]),
  );
  for (const [code, char] of [
    ["KeyQ", "a"],
    ["KeyA", "q"],
    ["KeyW", "z"],
    ["KeyZ", "w"],
    ["Semicolon", "m"],
    ["KeyM", ","],
  ]) {
    azerty.set(code, char);
  }

  assert(layoutAwareHotkey("Alt+A", azerty) === "Alt+[KeyQ]", "AZERTY: ⌥A binds to the key labelled A (KeyQ)");
  assert(layoutAwareHotkey("Alt+M", azerty) === "Alt+[Semicolon]", "AZERTY: ⌥M binds to Semicolon, where M lives");
  assert(layoutAwareHotkey("Alt+O", azerty) === "Alt+[KeyO]", "AZERTY: ⌥O stays on KeyO, now by code");
  assert(layoutAwareHotkey("Mod+K", azerty) === "Mod+K", "Mod chords are left alone");
  assert(layoutAwareHotkey("A", azerty) === "A", "bare keys are left alone");
  assert(layoutAwareHotkey("Alt+A", null) === "Alt+A", "no layout known yet → the chord as written");
  assert(
    layoutAwareHotkey("Alt+A", new Map([["KeyA", "ф"]])) === "Alt+A",
    "no key types the letter → the chord as written",
  );

  const resolvedA = layoutAwareHotkey("Alt+A", azerty);
  assert(hotkeys.validateHotkey(resolvedA).valid, `"${resolvedA}" is a valid TanStack hotkey`);
  assert(
    hotkeys.matchesKeyboardEvent(event({ key: "æ", code: "KeyQ", altKey: true }), resolvedA, "mac"),
    "French Mac: ⌥ + the key labelled A (types æ) goes to Acceptances",
  );
  assert(
    !hotkeys.matchesKeyboardEvent(event({ key: "‡", code: "KeyA", altKey: true }), resolvedA, "mac"),
    "French Mac: ⌥ + the key labelled Q does not",
  );
  assert(
    hotkeys.matchesKeyboardEvent(
      event({ key: "µ", code: "Semicolon", altKey: true }),
      layoutAwareHotkey("Alt+M", azerty),
      "mac",
    ),
    "French Mac: ⌥ + the key labelled M goes to Maps",
  );

  const qwerty = new Map(
    "abcdefghijklmnopqrstuvwxyz".split("").map((letter) => [`Key${letter.toUpperCase()}`, letter]),
  );
  const resolvedQwertyA = layoutAwareHotkey("Alt+A", qwerty);
  assert(resolvedQwertyA === "Alt+[KeyA]", "QWERTY: ⌥A binds to KeyA");
  assert(
    hotkeys.matchesKeyboardEvent(event({ key: "å", code: "KeyA", altKey: true }), resolvedQwertyA, "mac"),
    "QWERTY Mac: ⌥A (types å) still goes to Acceptances",
  );
  assert(
    hotkeys.matchesKeyboardEvent(event({ key: "a", code: "KeyA", altKey: true }), resolvedQwertyA, "windows"),
    "QWERTY Windows: Alt+A still goes to Acceptances",
  );

  // --- learning a layout from typing (Safari, Firefox) ---
  const { learnLetter } = registry;
  let learned = new Map();
  assert(!learnLetter(learned, "KeyQ", "a", true) && learned.size === 0, "learner: nothing learned with ⌘/Ctrl/⌥ held");
  for (const [code, key, label] of [
    ["KeyE", "Dead", "a dead key"],
    ["KeyA", "Process", "an IME keystroke"],
    ["Digit2", "é", "an accented letter"],
    ["", "a", "an empty code"],
    ["Numpad1", "a", "a non-typing code"],
  ]) {
    assert(!learnLetter(learned, code, key, false) && learned.size === 0, `learner: ${label} teaches nothing`);
  }
  assert(learnLetter(learned, "Semicolon", "M", false), "learner: a Shift-typed letter is learned…");
  assert(learned.get("Semicolon") === "m", "…stored lowercase");
  assert(!learnLetter(learned, "Semicolon", "m", false), "learner: re-learning what it knows reports no change");

  learned = new Map();
  learnLetter(learned, "KeyA", "a", false);
  assert(
    learnLetter(learned, "KeyQ", "a", false) && learned.get("KeyQ") === "a" && !learned.has("KeyA"),
    "learner: switching QWERTY → AZERTY moves a to KeyQ and forgets KeyA",
  );

  for (const platform of ["mac", "windows"]) {
    const seen = new Map();
    for (const { id, hotkey } of strings) {
      const canonical = hotkeys.normalizeHotkey(layoutAwareHotkey(hotkey, azerty), platform);
      const clash = seen.get(canonical);
      assert(!clash, `${id}: "${hotkey}" still claims its chord alone on AZERTY/${platform}${clash ? ` (also ${clash})` : ""}`);
      seen.set(canonical, id);
    }
  }

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
  assert(formatShortcutKey(ALT_KEY_TOKEN, "⌘") === "⌥", "Alt renders as ⌥ on Apple keyboards");
  assert(formatShortcutKey(ALT_KEY_TOKEN, "Ctrl") === "Alt", "…and as Alt elsewhere");
  assert(formatShortcutKey(ALT_KEY_TOKEN, null) === "Alt", "unknown platform falls back to Alt");
  assert(formatChord([ALT_KEY_TOKEN, "O"], "⌘") === "⌥O", "a Mac chord chip reads ⌥O");
  assert(formatChord([ALT_KEY_TOKEN, "O"], "Ctrl") === "Alt+O", "…and Alt+O elsewhere");
  assert(formatChord([MOD_KEY_TOKEN, "K"], "⌘") === "⌘K", "the Search chip's ⌘K comes out the same way");
  assert(formatChord([MOD_KEY_TOKEN, "K"], "Ctrl") === "Ctrl+K", "…and Ctrl+K");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll keyboard shortcut tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * The one place that knows every shortcut the app answers to — the data behind
 * the ⌘? dialog (`components/layout/KeyboardShortcutsDialog.tsx`).
 *
 * Deliberately pure: no React, no platform sniffing. Keys are written with a
 * `Mod` token rather than "⌘" or "Ctrl", and `formatShortcutKey` swaps in the
 * label the running platform deserves — the same split `useModKeyLabel`
 * already makes for the palette hint.
 *
 * The handlers stay where they fire (the layout, the sidebar, the panel
 * stack), but they register through `useShortcut(id, …)`, which reads the
 * chord from here — so a binding with no row cannot exist, and a row's chord
 * and the chord the app answers to cannot drift. `hotkeys` holds the TanStack
 * strings; `keys` is only how the sheet draws them.
 *
 * Keep this file import-free: its test transpiles it standalone.
 */

/** Where a shortcut is live. `everywhere` also shows inside a project. */
export type ShortcutScope = "everywhere" | "project" | "map";

export interface ShortcutEntry {
  id: string;
  /** What it does, in the user's words — not the handler's name. */
  description: string;
  /** One chord, e.g. `["Mod", "K"]`. `Mod` renders as ⌘ or Ctrl. */
  keys: readonly string[];
  /** Alternative chord for the same action, e.g. Delete / Backspace. */
  altKeys?: readonly string[];
  /**
   * The TanStack hotkey strings `useShortcut` registers for this row, e.g.
   * `["Mod+K"]`. Absent on rows that document a widget's own keys (the
   * palette's arrows, Enter on a focused node) — those are handled by the
   * widget, not registered as shortcuts.
   */
  hotkeys?: readonly string[];
  scope: ShortcutScope;
}

export interface ShortcutGroup {
  id: string;
  label: string;
  shortcuts: readonly ShortcutEntry[];
}

/** The token every mod-key chord is written with. */
export const MOD_KEY_TOKEN = "Mod";

/** The token every Option/Alt chord is written with. ⌥ on a Mac, Alt elsewhere. */
export const ALT_KEY_TOKEN = "Alt";

const GROUPS: readonly ShortcutGroup[] = [
  {
    id: "general",
    label: "General",
    shortcuts: [
      {
        id: "shortcuts",
        description: "Show keyboard shortcuts",
        keys: [MOD_KEY_TOKEN, "?"],
        // Both readings: `Mod+?` is the character on any layout (AZERTY types ?
        // as Shift+,), `Mod+Shift+/` the US physical keys when a browser reports "/".
        hotkeys: ["Mod+?", "Mod+Shift+/"],
        scope: "everywhere",
      },
      {
        id: "command-palette",
        description: "Open the command palette",
        keys: [MOD_KEY_TOKEN, "K"],
        hotkeys: ["Mod+K"],
        scope: "everywhere",
      },
      {
        id: "toggle-sidebar",
        description: "Show or hide the sidebar",
        keys: [MOD_KEY_TOKEN, "B"],
        altKeys: [ALT_KEY_TOKEN, "S"],
        hotkeys: ["Mod+B", "Alt+S"],
        scope: "project",
      },
      {
        id: "close",
        description: "Close the panel, dialog or overlay on top",
        keys: ["Esc"],
        hotkeys: ["Escape"],
        scope: "everywhere",
      },
    ],
  },
  {
    // One chord per sidebar destination, mnemonic where the letter is free:
    // M is Maps, so the matrix takes X. Held Option paints each chord beside
    // its sidebar item (ProjectSidebar), so these are discoverable in place.
    id: "navigation",
    label: "Go to",
    shortcuts: [
      { id: "nav-overview", description: "Overview", keys: [ALT_KEY_TOKEN, "O"], hotkeys: ["Alt+O"], scope: "project" },
      { id: "nav-pyramid", description: "Pyramid", keys: [ALT_KEY_TOKEN, "P"], hotkeys: ["Alt+P"], scope: "project" },
      { id: "nav-delivery", description: "Delivery", keys: [ALT_KEY_TOKEN, "D"], hotkeys: ["Alt+D"], scope: "project" },
      { id: "nav-changelog", description: "Changelog", keys: [ALT_KEY_TOKEN, "C"], hotkeys: ["Alt+C"], scope: "project" },
      { id: "nav-matrix", description: "Quality matrix", keys: [ALT_KEY_TOKEN, "X"], hotkeys: ["Alt+X"], scope: "project" },
      { id: "nav-findings", description: "Findings", keys: [ALT_KEY_TOKEN, "F"], hotkeys: ["Alt+F"], scope: "project" },
      { id: "nav-maps", description: "All maps", keys: [ALT_KEY_TOKEN, "M"], hotkeys: ["Alt+M"], scope: "project" },
      { id: "nav-journey", description: "Journey map", keys: [ALT_KEY_TOKEN, "J"], hotkeys: ["Alt+J"], scope: "project" },
      { id: "nav-library", description: "Library", keys: [ALT_KEY_TOKEN, "L"], hotkeys: ["Alt+L"], scope: "project" },
      { id: "nav-acceptances", description: "Acceptances", keys: [ALT_KEY_TOKEN, "A"], hotkeys: ["Alt+A"], scope: "project" },
    ],
  },
  {
    id: "palette",
    label: "Command palette",
    shortcuts: [
      {
        id: "palette-move",
        description: "Move through the results",
        keys: ["↑", "↓"],
        scope: "everywhere",
      },
      {
        id: "palette-complete",
        description: "Fill the input with the highlighted result",
        keys: ["Tab"],
        scope: "everywhere",
      },
      {
        id: "palette-run",
        description: "Go to — or run — the highlighted result",
        keys: ["Enter"],
        scope: "everywhere",
      },
    ],
  },
  {
    id: "project",
    label: "Project",
    shortcuts: [
      {
        id: "export",
        description: "Export the project bundle",
        keys: [MOD_KEY_TOKEN, "E"],
        hotkeys: ["Mod+E"],
        scope: "project",
      },
    ],
  },
  {
    id: "map",
    label: "Maps",
    shortcuts: [
      {
        id: "delete-node",
        description: "Delete the node in the open panel",
        keys: ["Delete"],
        altKeys: ["Backspace"],
        hotkeys: ["Delete", "Backspace"],
        scope: "map",
      },
      {
        id: "open-node",
        description: "Open the focused node",
        keys: ["Enter"],
        altKeys: ["Space"],
        scope: "map",
      },
    ],
  },
  {
    id: "screenshots",
    label: "Screenshot preview",
    shortcuts: [
      {
        id: "shot-prev",
        description: "Previous platform",
        keys: ["←"],
        hotkeys: ["ArrowLeft"],
        scope: "project",
      },
      {
        id: "shot-next",
        description: "Next platform",
        keys: ["→"],
        hotkeys: ["ArrowRight"],
        scope: "project",
      },
    ],
  },
];

/**
 * Where each navigation row goes, relative to `/project/<id>/`. Kept beside
 * the rows so the test can hold them one-to-one; ProjectSidebar registers
 * from this table.
 */
export const NAV_HOTKEY_ROUTES: Readonly<Record<string, string>> = {
  "nav-overview": "overview",
  "nav-pyramid": "pyramid",
  "nav-delivery": "delivery",
  "nav-changelog": "changelog",
  "nav-matrix": "quality/matrix",
  "nav-findings": "quality/findings",
  "nav-maps": "maps",
  "nav-journey": "maps/journey",
  "nav-library": "library",
  "nav-acceptances": "acceptances",
};

/**
 * Rebinds an Option letter chord to the physical key that is *labelled* with
 * that letter on the user's layout, e.g. `Alt+A` → `Alt+[KeyQ]` on AZERTY.
 *
 * Why: on macOS Option garbles the character (⌥A types `æ`), so TanStack
 * falls back to `event.code` — assuming US positions. On a French Mac that
 * put ⌥A on the key labelled Q and left ⌥M (on `Semicolon` there) dead. A
 * `[Code]` binding matches `event.code` directly, so resolving the letter
 * through the layout makes the chord follow the label on any layout and OS.
 *
 * `layout` maps `event.code` → the lowercase character that key types
 * (`useKeyboardLayout`). Only `Alt+<letter>` is touched — Mod chords and bare
 * keys report their character fine. With no layout, or no key that types the
 * letter, the chord is returned as written (TanStack's own fallback).
 *
 * Known transient in Safari/Firefox, where the layout is learned from typing:
 * on a partially learned layout (Dvorak with "o" learned but not "s", say) a
 * chord still written as-is falls back to its US position, which may be the
 * key another chord now owns by code — the code binding wins, so the as-is
 * chord goes quiet there until the user types its letter once.
 */
export function layoutAwareHotkey(hotkey: string, layout: ReadonlyMap<string, string> | null): string {
  if (!layout) return hotkey;
  const match = /^Alt\+([A-Z])$/.exec(hotkey);
  if (!match) return hotkey;
  const letter = match[1].toLowerCase();

  // Prefer the letter's own key when the layout agrees, so a QWERTY-shaped
  // map resolves predictably even if some other key also types the letter.
  const ownCode = `Key${match[1]}`;
  if (layout.get(ownCode)?.toLowerCase() === letter) return `Alt+[${ownCode}]`;
  for (const [code, char] of layout) {
    if (char.toLowerCase() === letter) return `Alt+[${code}]`;
  }
  return hotkey;
}

// The writing-system keys of the UI Events `code` spec. Letters live on more
// than `Key*` codes — AZERTY puts M on `Semicolon` — so all of them can teach.
const WRITING_CODE =
  /^(Key[A-Z]|Digit[0-9]|Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|IntlBackslash|IntlRo|IntlYen|Minus|Period|Quote|Semicolon|Slash)$/;

/**
 * One keystroke's lesson for a learned layout (`useKeyboardLayout`, where the
 * browser has no `getLayoutMap`): a typing key that produced a single ASCII
 * letter with no ⌘/Ctrl/⌥ held means `code` types that letter. Shift is fine
 * — the letter is stored lowercase. A letter lives on one key per layout, so
 * after an input-source switch the letter's old key is forgotten.
 *
 * Mutates `learned`; returns whether it changed.
 */
export function learnLetter(
  learned: Map<string, string>,
  code: string,
  key: string,
  modifiersHeld: boolean,
): boolean {
  // ⌘/Ctrl/⌥ can swap or garble the layout (Dvorak–QWERTY ⌘, Option glyphs).
  if (modifiersHeld || !/^[A-Za-z]$/.test(key) || !WRITING_CODE.test(code)) return false;
  const char = key.toLowerCase();
  if (learned.get(code) === char) return false;
  for (const [other, otherChar] of learned) {
    if (otherChar === char) learned.delete(other);
  }
  learned.set(code, char);
  return true;
}

/**
 * The groups worth showing on a given surface. Outside a project (the docs
 * shell, say) the map and project chords are not just unused — they are dead
 * keys, and listing them would be a lie the dialog tells on every open.
 */
export function getShortcutGroups(inProject: boolean): readonly ShortcutGroup[] {
  if (inProject) return GROUPS;

  return GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter((shortcut) => shortcut.scope === "everywhere"),
  })).filter((group) => group.shortcuts.length > 0);
}

/** Every row, in sheet order. */
export function allShortcuts(): readonly ShortcutEntry[] {
  return GROUPS.flatMap((group) => group.shortcuts);
}

/**
 * The row `useShortcut` registers. Throws on an unknown id or a
 * documentation-only row: both are a typo that would otherwise register
 * nothing and fail silently on the first keypress.
 */
export function getShortcut(id: string): ShortcutEntry & { hotkeys: readonly string[] } {
  const entry = allShortcuts().find((shortcut) => shortcut.id === id);
  if (!entry) {
    throw new Error(`Unknown shortcut "${id}" — add a row to lib/utils/keyboard-shortcuts.ts`);
  }
  if (!entry.hotkeys || entry.hotkeys.length === 0) {
    throw new Error(`Shortcut "${id}" documents a widget's keys and has nothing to register`);
  }
  return entry as ShortcutEntry & { hotkeys: readonly string[] };
}

/**
 * Render one key for display. `modLabel` is what `useModKeyLabel` reports —
 * null while the platform is still unknown (SSR), where "Ctrl" is the safer
 * guess than a ⌘ shown to someone who has no ⌘ key. It also decides Alt's
 * glyph.
 */
export function formatShortcutKey(key: string, modLabel: string | null): string {
  if (key === MOD_KEY_TOKEN) return modLabel ?? "Ctrl";
  if (key === ALT_KEY_TOKEN) return modLabel === "⌘" ? "⌥" : "Alt";
  return key;
}

/**
 * A whole chord as one chip's text: glued on a Mac (`⌥O`, `⌘K`), joined with
 * `+` elsewhere (`Alt+O`, `Ctrl+K`) — the convention the Search chip set.
 */
export function formatChord(keys: readonly string[], modLabel: string | null): string {
  const parts = keys.map((key) => formatShortcutKey(key, modLabel));
  return modLabel === "⌘" ? parts.join("") : parts.join("+");
}

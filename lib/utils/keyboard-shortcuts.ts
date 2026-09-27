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
        hotkeys: ["Mod+B"],
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
 * guess than a ⌘ shown to someone who has no ⌘ key.
 */
export function formatShortcutKey(key: string, modLabel: string | null): string {
  return key === MOD_KEY_TOKEN ? modLabel ?? "Ctrl" : key;
}

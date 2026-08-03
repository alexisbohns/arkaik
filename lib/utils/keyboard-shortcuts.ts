/**
 * The one place that knows every shortcut the app answers to — the data behind
 * the ⌘? dialog (`components/layout/KeyboardShortcutsDialog.tsx`).
 *
 * Deliberately pure: no React, no platform sniffing. Keys are written with a
 * `Mod` token rather than "⌘" or "Ctrl", and `formatShortcutKey` swaps in the
 * label the running platform deserves — the same split `useModKeyLabel`
 * already makes for the palette hint.
 *
 * The handlers themselves stay where they fire (the layout, the sidebar, the
 * panel stack). What this file guarantees is that a shortcut nobody can
 * discover does not exist: adding a chord means adding a row here.
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
        scope: "everywhere",
      },
      {
        id: "command-palette",
        description: "Open the command palette",
        keys: [MOD_KEY_TOKEN, "K"],
        scope: "everywhere",
      },
      {
        id: "toggle-sidebar",
        description: "Show or hide the sidebar",
        keys: [MOD_KEY_TOKEN, "B"],
        scope: "project",
      },
      {
        id: "close",
        description: "Close the panel, dialog or overlay on top",
        keys: ["Esc"],
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
        scope: "project",
      },
      {
        id: "shot-next",
        description: "Next platform",
        keys: ["→"],
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

/**
 * Render one key for display. `modLabel` is what `useModKeyLabel` reports —
 * null while the platform is still unknown (SSR), where "Ctrl" is the safer
 * guess than a ⌘ shown to someone who has no ⌘ key.
 */
export function formatShortcutKey(key: string, modLabel: string | null): string {
  return key === MOD_KEY_TOKEN ? modLabel ?? "Ctrl" : key;
}

"use client";

import {
  useHotkeys,
  type Hotkey,
  type HotkeyCallback,
  type UseHotkeyDefinition,
  type UseHotkeyOptions,
} from "@tanstack/react-hotkeys";
import { useKeyboardLayout } from "@/lib/hooks/useKeyboardLayout";
import { getShortcut, layoutAwareHotkey } from "@/lib/utils/keyboard-shortcuts";

/**
 * For a handler whose guard can decline. TanStack prevents the event *before*
 * the callback runs and ignores `defaultPrevented`, so a callback that returns
 * early would still have swallowed the key. With these options the callback
 * owns both: it checks its guards, then calls `event.preventDefault()` itself.
 */
export const GUARDED_HOTKEY = {
  preventDefault: false,
  stopPropagation: false,
} as const satisfies UseHotkeyOptions;

export interface ShortcutBinding {
  /** A row id in `lib/utils/keyboard-shortcuts.ts`. */
  id: string;
  callback: HotkeyCallback;
  options?: UseHotkeyOptions;
}

function toDefinitions(
  { id, callback, options }: ShortcutBinding,
  layout: ReadonlyMap<string, string> | null,
): UseHotkeyDefinition[] {
  // The registry is import-free, so it holds plain strings; the test validates
  // each one against TanStack (and the `[Code]` form layoutAwareHotkey makes),
  // which is what makes this cast honest.
  return getShortcut(id).hotkeys.map((hotkey) => ({
    hotkey: layoutAwareHotkey(hotkey, layout) as Hotkey,
    callback,
    options,
  }));
}

/**
 * Registers several registry rows at once — every chord of every row. Option
 * letter chords are bound to the key labelled with the letter on the user's
 * layout (see `layoutAwareHotkey`), re-registering if the layout changes.
 */
export function useShortcuts(bindings: readonly ShortcutBinding[], commonOptions?: UseHotkeyOptions): void {
  const layout = useKeyboardLayout();
  useHotkeys(
    bindings.flatMap((binding) => toDefinitions(binding, layout)),
    commonOptions,
  );
}

/**
 * Registers one registry row. The callback and options are re-synced on every
 * render, so a callback may close over current state without a ref.
 *
 * Pass every option on every render: TanStack merges options into the live
 * registration, so a key dropped on a later render keeps its old value rather
 * than resetting.
 */
export function useShortcut(id: string, callback: HotkeyCallback, options?: UseHotkeyOptions): void {
  useShortcuts([{ id, callback, options }]);
}

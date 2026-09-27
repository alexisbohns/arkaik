"use client";

import {
  useHotkeys,
  type Hotkey,
  type HotkeyCallback,
  type UseHotkeyDefinition,
  type UseHotkeyOptions,
} from "@tanstack/react-hotkeys";
import { getShortcut } from "@/lib/utils/keyboard-shortcuts";

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

function toDefinitions({ id, callback, options }: ShortcutBinding): UseHotkeyDefinition[] {
  // The registry is import-free, so it holds plain strings; the test validates
  // each one against TanStack, which is what makes this cast honest.
  return getShortcut(id).hotkeys.map((hotkey) => ({ hotkey: hotkey as Hotkey, callback, options }));
}

/** Registers several registry rows at once — every chord of every row. */
export function useShortcuts(bindings: readonly ShortcutBinding[], commonOptions?: UseHotkeyOptions): void {
  useHotkeys(bindings.flatMap(toDefinitions), commonOptions);
}

/**
 * Registers one registry row. The callback and options are re-synced on every
 * render, so a callback may close over current state without a ref.
 */
export function useShortcut(id: string, callback: HotkeyCallback, options?: UseHotkeyOptions): void {
  useShortcuts([{ id, callback, options }]);
}

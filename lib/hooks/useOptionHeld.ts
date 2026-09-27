"use client";

import { useHeldKeys } from "@tanstack/react-hotkeys";

/**
 * True while Option/Alt — and nothing else — is held. ⌥⇧ or ⌥⌘ is someone
 * typing a chord, not asking what the chords are. TanStack's key tracker
 * clears on window blur, so ⌘-Tab away mid-hold leaves nothing painted.
 */
export function useOptionHeld(): boolean {
  const held = useHeldKeys();
  return held.length === 1 && held[0] === "Alt";
}

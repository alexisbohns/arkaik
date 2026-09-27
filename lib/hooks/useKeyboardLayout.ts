"use client";

import { useSyncExternalStore } from "react";
import { getKeyStateTracker } from "@tanstack/react-hotkeys";

/**
 * What key types what: `event.code` → the lowercase character it produces on
 * the user's current layout. `useShortcuts` resolves Option letter chords
 * through it (`layoutAwareHotkey`), because on macOS Option garbles the
 * character (⌥A types `æ`) and TanStack's fallback to `event.code` assumes US
 * key positions — so on AZERTY ⌥A fired on the key labelled Q and ⌥M never
 * fired at all.
 *
 * Two sources, merged into one map shared by every consumer:
 * 1. `navigator.keyboard.getLayoutMap()` (Chromium: Chrome, Edge, the
 *    installed PWA) — authoritative, re-read on window focus since the user
 *    may have switched input source while away.
 * 2. Learned from typing, for Safari and Firefox, which lack that API: every
 *    unmodified keystroke that types a single letter teaches `code → letter`.
 *    It reads TanStack's key-state tracker rather than adding a keydown
 *    listener of its own — the tracker already watches every keydown at
 *    document capture. Learned entries only fill codes the layout map lacks.
 *
 * Until either source knows anything the snapshot is `null` and chords stay
 * as written. The snapshot is the same Map instance until something actually
 * changes, so typing a letter already known re-renders nobody.
 */

interface KeyboardLayoutMap {
  forEach(callback: (value: string, key: string) => void): void;
}
interface NavigatorKeyboard {
  getLayoutMap?: () => Promise<KeyboardLayoutMap>;
}

// The writing-system keys of the UI Events `code` spec. Letters live on more
// than `Key*` codes — AZERTY puts M on `Semicolon` — so all of them can teach.
const WRITING_CODE = /^(Key[A-Z]|Digit[0-9]|Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|IntlBackslash|IntlRo|IntlYen|Minus|Period|Quote|Semicolon|Slash)$/;
const LETTER = /^[A-Za-z]$/;
const CHORD_MODIFIERS = ["Meta", "Control", "Alt", "AltGraph"];

let fromBrowser: ReadonlyMap<string, string> | null = null;
const learned = new Map<string, string>();
let snapshot: ReadonlyMap<string, string> | null = null;
const listeners = new Set<() => void>();
let started = false;

function sameEntries(a: ReadonlyMap<string, string> | null, b: ReadonlyMap<string, string>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const [code, char] of b) if (a.get(code) !== char) return false;
  return true;
}

/** Rebuilds the merged map and notifies only if it differs from the last one. */
function publish(): void {
  const next = new Map(learned);
  if (fromBrowser) for (const [code, char] of fromBrowser) next.set(code, char);
  if (next.size === 0 || sameEntries(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function readLayoutMap(): void {
  try {
    const keyboard = (navigator as Navigator & { keyboard?: NavigatorKeyboard }).keyboard;
    if (typeof keyboard?.getLayoutMap !== "function") return;
    keyboard
      .getLayoutMap()
      .then((layoutMap) => {
        const next = new Map<string, string>();
        layoutMap.forEach((char, code) => next.set(code, char.toLowerCase()));
        fromBrowser = next;
        publish();
      })
      // Rejects in cross-origin iframes and insecure contexts: learn instead.
      .catch(() => {});
  } catch {
    // Same, for engines that throw synchronously.
  }
}

function learnFromTracker(): void {
  const { heldKeys, heldCodes } = getKeyStateTracker().store.state;
  // ⌘/Ctrl/⌥ can swap or garble the layout (Dvorak–QWERTY ⌘, Option glyphs).
  if (heldKeys.some((key) => CHORD_MODIFIERS.includes(key))) return;
  let changed = false;
  for (const [key, code] of Object.entries(heldCodes)) {
    if (!LETTER.test(key) || !code || !WRITING_CODE.test(code)) continue;
    if (fromBrowser?.has(code)) continue;
    const char = key.toLowerCase();
    if (learned.get(code) === char) continue;
    learned.set(code, char);
    changed = true;
  }
  if (changed) publish();
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // Module-lifetime, like the tracker it reads: what it learns is worth
  // keeping across sidebar remounts, and there is at most one of each.
  readLayoutMap();
  window.addEventListener("focus", readLayoutMap);
  try {
    getKeyStateTracker().store.subscribe(learnFromTracker);
  } catch {
    // No tracker, no learning — chords keep TanStack's own fallback.
  }
}

function subscribe(onStoreChange: () => void): () => void {
  start();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): ReadonlyMap<string, string> | null {
  return snapshot;
}

function getServerSnapshot(): null {
  return null;
}

/** The user's keyboard layout as `code → character`, or `null` while unknown. */
export function useKeyboardLayout(): ReadonlyMap<string, string> | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

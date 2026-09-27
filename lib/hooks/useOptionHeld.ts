"use client";

import { useSyncExternalStore } from "react";
import { getKeyStateTracker } from "@tanstack/react-hotkeys";
import { isEditableElement } from "@/lib/utils/keyboard";

// The tracker is a singleton (`KeyStateTracker.getInstance()` under the
// hood), so these can live at module scope: stable `subscribe`/`getSnapshot`
// identities mean `useSyncExternalStore` subscribes once per mount rather
// than resubscribing on every render.
const tracker = getKeyStateTracker();

function onlyOptionHeld(heldKeys: readonly string[]): boolean {
  return heldKeys.length === 1 && heldKeys[0] === "Alt";
}

function subscribe(onStoreChange: () => void): () => void {
  return tracker.store.subscribe(onStoreChange).unsubscribe;
}

function typingInAField(): boolean {
  return typeof document !== "undefined" && isEditableElement(document.activeElement);
}

function getSnapshot(): boolean {
  return onlyOptionHeld(tracker.store.state.heldKeys) && !typingInAField();
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * True while Option/Alt — and nothing else — is held. ⌥⇧ or ⌥⌘ is someone
 * typing a chord, not asking what the chords are. TanStack's key tracker
 * clears on window blur, so ⌘-Tab away mid-hold leaves nothing painted.
 *
 * Also false while focus is in an editable field: on AZERTY `{ } [ ] | ~`
 * are typed with Option, and the chips flashing on every brace would be
 * noise (the chords themselves are ignored in fields anyway). Focus moves
 * don't notify the tracker's store, so Option held *while* focus moves keeps
 * its old answer until the next key event — rare enough to accept.
 *
 * Selects just this boolean via `useSyncExternalStore` rather than reading
 * `useHeldKeys()` and deriving it: that hook hands back a fresh array on
 * every keydown and keyup, and its `useSelector`-based subscription compares
 * with `===`, so a new array reads as a change even when the one thing this
 * hook cares about hasn't — which would re-render every consumer (the whole
 * sidebar) on every keystroke anywhere in the app, including one typed into
 * an unrelated textarea. Selecting the boolean directly means a re-render
 * only happens when the answer actually flips.
 */
export function useOptionHeld(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

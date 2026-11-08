"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_STONE_PREFERENCES,
  STONE_STORAGE_KEY,
  applyStonePreferences,
  parseStonePreferences,
  type StonePreferences,
} from "@/lib/stones/preferences";

/**
 * A module store read through `useSyncExternalStore`, the same shape as
 * `useDisplayPreferences`: SSR renders the defaults (localStorage does not
 * exist there), hydration re-reads the real store, and every subscriber agrees
 * the instant a choice changes — `setItem` fires no `storage` event in the tab
 * that wrote it. Writing also re-applies the skin to <html>, so the whole app
 * changes stone without a reload.
 */
let cache: StonePreferences | null = null;
const listeners = new Set<() => void>();

function read(): StonePreferences {
  if (typeof window === "undefined") return DEFAULT_STONE_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(STONE_STORAGE_KEY);
    return stored ? parseStonePreferences(JSON.parse(stored)) : DEFAULT_STONE_PREFERENCES;
  } catch {
    return DEFAULT_STONE_PREFERENCES;
  }
}

function getSnapshot(): StonePreferences {
  if (!cache) cache = read();
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: StonePreferences, remember: boolean) {
  cache = next;
  try {
    if (remember) window.localStorage.setItem(STONE_STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STONE_STORAGE_KEY);
  } catch {
    // Best-effort: the skin changes now, it just won't be remembered.
  }
  applyStonePreferences(document.documentElement, next);
  for (const listener of listeners) listener();
}

export function useStonePreferences(): {
  preferences: StonePreferences;
  update: (patch: Partial<StonePreferences>) => void;
  reset: () => void;
} {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STONE_PREFERENCES);
  const update = useCallback((patch: Partial<StonePreferences>) => commit({ ...getSnapshot(), ...patch }, true), []);
  const reset = useCallback(() => commit(DEFAULT_STONE_PREFERENCES, false), []);
  return { preferences, update, reset };
}

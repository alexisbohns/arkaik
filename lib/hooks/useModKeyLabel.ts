"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to — the keyboard does not change under the app. */
const subscribe = () => () => {};

function readModKey(): string {
  const platform = navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

/**
 * "⌘" on Apple keyboards, "Ctrl" everywhere else — for rendering shortcut
 * hints. Null on the server: the platform is a client fact, and guessing it
 * during SSR would either hydrate-mismatch or print the wrong key.
 */
export function useModKeyLabel(): string | null {
  return useSyncExternalStore(subscribe, readModKey, () => null);
}

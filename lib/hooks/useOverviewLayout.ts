"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The Overview's two displays: today's card grid, or one row per section. */
export type OverviewLayout = "grid" | "rows";

const STORAGE_KEY = "arkaik:overview-layout";
const DEFAULT_LAYOUT: OverviewLayout = "grid";

const isLayout = (value: string | null): value is OverviewLayout =>
  value === "grid" || value === "rows";

/**
 * Lazily hydrated from localStorage on first read, then cached — which is what
 * makes `getSnapshot` safe to call on every render.
 */
let layout: OverviewLayout | undefined;
const listeners = new Set<() => void>();

/**
 * Guarded twice over, like the product scope store: `window` is absent during
 * SSR, and `localStorage` itself throws in private-mode browsers that enforce a
 * zero quota rather than reporting one.
 */
function read(): OverviewLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLayout(stored) ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function getSnapshot(): OverviewLayout {
  if (layout === undefined) layout = read();
  return layout;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The reader's chosen Overview display, remembered across sessions.
 *
 * Global rather than per project, unlike the product scope: which shape you
 * like reading a dashboard in is a fact about you, not about the product. That
 * is also why it stays out of the URL — a link to the Overview is a link to the
 * product's standing, not to someone else's layout preference.
 *
 * A module store read through `useSyncExternalStore`, matching
 * lib/utils/product-scope-store.ts, rather than `useState` hydrated in an
 * effect: the effect version calls `setState` in an effect body, which is a
 * cascading render and a lint error, and this shape has the same one-frame
 * behaviour without either. `getServerSnapshot` is the default layout because
 * localStorage does not exist during SSR; React renders that through hydration
 * and re-reads the real store immediately after.
 */
export function useOverviewLayout(): [OverviewLayout, (next: OverviewLayout) => void] {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_LAYOUT);

  const choose = useCallback((next: OverviewLayout) => {
    if (getSnapshot() === next) return;
    layout = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort: the layout still switches now, it just won't be remembered.
    }
    for (const listener of listeners) listener();
  }, []);

  return [current, choose];
}

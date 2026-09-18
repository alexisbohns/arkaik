"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How the Acceptances section of a view or flow panel draws one acceptance.
 *
 * `rows` is the default: one line per acceptance — title, id, and one
 * status-coloured platform glyph each. `cards` is the display that shipped
 * first, a bordered block per acceptance with every platform spelled out on its
 * own labelled line. Cards say strictly more; rows let you see the whole list
 * at once, which is what a panel opened *from a view* is usually for.
 */
export type AcceptanceDisplay = "rows" | "cards";

export interface DisplayPreferences {
  acceptanceDisplay: AcceptanceDisplay;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  acceptanceDisplay: "rows",
};

const STORAGE_PREFIX = "arkaik:display-prefs:";

/**
 * `projectId → preferences`, lazily hydrated from localStorage on first read
 * and then cached, which is what makes `getSnapshot` safe to call on every
 * render.
 *
 * Per project rather than global, unlike `useOverviewLayout`: the reader sets
 * this from a project's own Settings page, and a project whose acceptances are
 * three-platform reads very differently from one that is web-only. Held in the
 * browser rather than in the bundle for the reason the product scope is — it is
 * a preference of the person reading, not a fact about the product, and writing
 * it into the graph would put one reader's taste into everyone else's export.
 */
const cache = new Map<string, DisplayPreferences>();
const listeners = new Set<() => void>();

function isAcceptanceDisplay(value: unknown): value is AcceptanceDisplay {
  return value === "rows" || value === "cards";
}

/**
 * Guarded twice over, like the product scope store: `window` is absent during
 * SSR, and `localStorage` itself throws in private-mode browsers that enforce a
 * zero quota rather than reporting one. An unreadable or half-recognised record
 * degrades key by key to the defaults rather than being discarded wholesale.
 */
function read(projectId: string): DisplayPreferences {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!stored) return DEFAULT_DISPLAY_PREFERENCES;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_DISPLAY_PREFERENCES;
    const acceptanceDisplay = (parsed as Partial<DisplayPreferences>).acceptanceDisplay;
    return {
      acceptanceDisplay: isAcceptanceDisplay(acceptanceDisplay)
        ? acceptanceDisplay
        : DEFAULT_DISPLAY_PREFERENCES.acceptanceDisplay,
    };
  } catch {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
}

function getSnapshot(projectId: string): DisplayPreferences {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const value = read(projectId);
  cache.set(projectId, value);
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * This reader's display preferences for one project, remembered across
 * sessions.
 *
 * A module store read through `useSyncExternalStore`, matching
 * `lib/utils/product-scope-store.ts` and `useOverviewLayout`, rather than
 * `useState` hydrated in an effect: the effect version calls `setState` in an
 * effect body, which is a cascading render and a lint error, and this shape has
 * the same one-frame behaviour without either. It is also what makes the
 * Settings control and every open panel agree the instant the choice changes —
 * `localStorage.setItem` fires no `storage` event in the tab that wrote it.
 *
 * `getServerSnapshot` is the defaults, because localStorage does not exist
 * during SSR; React renders those through hydration and re-reads the real store
 * immediately after.
 */
export function useDisplayPreferences(
  projectId: string,
): [DisplayPreferences, (patch: Partial<DisplayPreferences>) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => getSnapshot(projectId),
    () => DEFAULT_DISPLAY_PREFERENCES,
  );

  const update = useCallback(
    (patch: Partial<DisplayPreferences>) => {
      const next = { ...getSnapshot(projectId), ...patch };
      cache.set(projectId, next);
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(next));
      } catch {
        // Best-effort: the display switches now, it just won't be remembered.
      }
      for (const listener of listeners) listener();
    },
    [projectId],
  );

  return [current, update];
}

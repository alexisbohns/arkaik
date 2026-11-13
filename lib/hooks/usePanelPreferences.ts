"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PANEL_PREFERENCES,
  PANEL_PREFERENCES_KEY,
  parsePanelPreferences,
  type PanelPreferences,
} from "@/lib/config/panel-preferences";

export type { PanelLook, PanelPreferences } from "@/lib/config/panel-preferences";

let cached: PanelPreferences | null = null;
const listeners = new Set<() => void>();

function read(): PanelPreferences {
  if (typeof window === "undefined") return DEFAULT_PANEL_PREFERENCES;
  try {
    return parsePanelPreferences(window.localStorage.getItem(PANEL_PREFERENCES_KEY));
  } catch {
    // Storage can throw (private windows, blocked site data): the default it is.
    return DEFAULT_PANEL_PREFERENCES;
  }
}

function apply(preferences: PanelPreferences) {
  const root = document.documentElement;
  if (preferences.look === "calm") root.setAttribute("data-panel-look", "calm");
  else root.removeAttribute("data-panel-look");
}

function getSnapshot(): PanelPreferences {
  if (!cached) cached = read();
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it: follow, so two windows never disagree for long.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PANEL_PREFERENCES_KEY) return;
    cached = parsePanelPreferences(event.newValue);
    apply(cached);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPanelPreferences(patch: Partial<PanelPreferences>) {
  const next = { ...getSnapshot(), ...patch };
  cached = next;
  try {
    window.localStorage.setItem(PANEL_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Not persisted, but still applied for this page.
  }
  apply(next);
  for (const listener of listeners) listener();
}

/**
 * How a reader wants node panels drawn — a preference of the person, not of the
 * project, so it lives in this browser under one key and applies to every
 * project they open.
 *
 * - **Expressive** (the default): a species seal, a hero title, the status as a
 *   lifecycle track, a lit Gherkin.
 * - **Calm**: the species as a glyph, the product as a quiet "in Pebbles" line,
 *   a clamped description, the status as a chip, a Gherkin that reads as lines
 *   until clicked.
 *
 * The look is applied twice, on purpose. `app/m3/panels.css` keys on
 * `<html data-panel-look>`, which `PANEL_PREFERENCES_SCRIPT` sets inline before
 * first paint, so a Calm reader never sees an Expressive flash. Components that
 * render differently per look read `usePanelPreferences()`, whose server
 * snapshot is the default; panels mount after their data loads, so in practice
 * they render once, with the stored look.
 */
export function usePanelPreferences(): PanelPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PANEL_PREFERENCES);
}

/**
 * The node-panel look preference: its type, its storage key, the defensive
 * parser and the inline script that applies it before first paint.
 *
 * A plain module, not a client one, because `app/layout.tsx` (a server
 * component) inlines `PANEL_PREFERENCES_SCRIPT`: a constant exported from a
 * "use client" module would reach it as a client reference, not as the string.
 * The hook that reads and writes it is `lib/hooks/usePanelPreferences.ts`.
 */
export type PanelLook = "expressive" | "calm";

export interface PanelPreferences {
  look: PanelLook;
}

export const DEFAULT_PANEL_PREFERENCES: PanelPreferences = { look: "expressive" };

export const PANEL_PREFERENCES_KEY = "arkaik:panel-prefs";

/** Reads a stored value defensively: anything unrecognised falls back to the default. */
export function parsePanelPreferences(raw: string | null): PanelPreferences {
  if (!raw) return DEFAULT_PANEL_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_PREFERENCES;
    const { look } = parsed as Partial<PanelPreferences>;
    return { look: look === "calm" ? "calm" : "expressive" };
  } catch {
    return DEFAULT_PANEL_PREFERENCES;
  }
}

/**
 * Inline, before hydration: mirrors the stored look onto `<html>`. Only a
 * non-default look writes an attribute, so the stylesheet's default (no
 * attribute) is also what a reader with no preference, or no storage, gets.
 */
export const PANEL_PREFERENCES_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PANEL_PREFERENCES_KEY,
)})||"{}");if(p&&p.look==="calm")document.documentElement.setAttribute("data-panel-look","calm")}catch(e){}})();`;


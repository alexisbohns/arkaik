import { DEFAULT_STONES, STONES, type StoneSide } from "../dist/stones-registry.generated";

/**
 * The reader's stone skin: one light stone, one dark stone, and the radius of
 * stone buttons and sidebar rows (docs/superpowers/specs/2026-11-08-stone-skins-design.md).
 *
 * Held in this browser, not in the bundle, for the reason display preferences
 * are: it is the taste of the person reading, not a fact about the product.
 * Global rather than per project, because the stones are Arkaik's own material.
 */
export interface StonePreferences {
  light: string;
  dark: string;
  radius: number;
}

export const STONE_STORAGE_KEY = "arkaik:stones";
export const RADIUS_MIN = 0;
/** The top of the range reads as "pill": fully rounded at any height. */
export const RADIUS_MAX = 18;
export const RADIUS_DEFAULT = 12;

export const DEFAULT_STONE_PREFERENCES: StonePreferences = {
  light: DEFAULT_STONES.light,
  dark: DEFAULT_STONES.dark,
  radius: RADIUS_DEFAULT,
};

export function stoneIds(side: StoneSide): string[] {
  return STONES.filter((s) => s.side === side).map((s) => s.id);
}

/**
 * Reads a stored record key by key: an unknown stone or an out-of-range radius
 * falls back to its own default without discarding the rest, so a stone
 * removed in a later release costs the reader only that one choice.
 */
export function parseStonePreferences(raw: unknown): StonePreferences {
  if (typeof raw !== "object" || raw === null) return DEFAULT_STONE_PREFERENCES;
  const record = raw as Record<string, unknown>;
  const pick = (side: StoneSide): string => {
    const value = record[side];
    return typeof value === "string" && stoneIds(side).includes(value) ? value : DEFAULT_STONE_PREFERENCES[side];
  };
  const r = record.radius;
  const radius =
    typeof r === "number" && Number.isFinite(r) && r >= RADIUS_MIN && r <= RADIUS_MAX ? Math.round(r) : RADIUS_DEFAULT;
  return { light: pick("light"), dark: pick("dark"), radius };
}

export function radiusValue(radius: number): string {
  return radius >= RADIUS_MAX ? "9999px" : `${radius}px`;
}

export function isDefaultStonePreferences(p: StonePreferences): boolean {
  return (
    p.light === DEFAULT_STONE_PREFERENCES.light &&
    p.dark === DEFAULT_STONE_PREFERENCES.dark &&
    p.radius === DEFAULT_STONE_PREFERENCES.radius
  );
}

/** What css/stones.css and dist/stones.generated.css read: two attributes and one custom property on <html>. */
export function applyStonePreferences(
  root: Pick<HTMLElement, "setAttribute"> & { style: Pick<CSSStyleDeclaration, "setProperty"> },
  p: StonePreferences,
): void {
  root.setAttribute("data-stone-light", p.light);
  root.setAttribute("data-stone-dark", p.dark);
  root.style.setProperty("--stone-radius", radiusValue(p.radius));
}

/**
 * The inline <head> script that applies a stored choice before first paint,
 * the way next-themes applies the theme. Self-contained (no imports at run
 * time), it only ever sets a value it recognises, and swallows every error:
 * the server-rendered defaults are always a valid skin.
 */
export function stoneBootScript(): string {
  const light = JSON.stringify(stoneIds("light"));
  const dark = JSON.stringify(stoneIds("dark"));
  return (
    `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(STONE_STORAGE_KEY)})||"null");` +
    `if(!p||typeof p!=="object")return;var d=document.documentElement;` +
    `if(${light}.indexOf(p.light)>=0)d.setAttribute("data-stone-light",p.light);` +
    `if(${dark}.indexOf(p.dark)>=0)d.setAttribute("data-stone-dark",p.dark);` +
    `var r=p.radius;if(typeof r==="number"&&r>=${RADIUS_MIN}&&r<=${RADIUS_MAX}){var n=Math.round(r);` +
    `d.style.setProperty("--stone-radius",n>=${RADIUS_MAX}?"9999px":n+"px");}` +
    `}catch(e){}})();`
  );
}

/**
 * PREVIEW ONLY: the display faces the cover's preview panel can try for the
 * display, headline and title roles (the h1, section titles, company names,
 * the prompt heading, the bar's "Arkademy"). Ids and labels only, so the
 * client panel can list them without importing the fonts themselves
 * (m3-fonts.ts loads them, on the server). The first is the default.
 */
export const M3_FONT_OPTIONS = [
  { id: "dynapuff", label: "DynaPuff" },
  { id: "gochi-hand", label: "Gochi Hand" },
  { id: "bitcount-grid-single", label: "Bitcount Grid Single" },
  { id: "ruslan-display", label: "Ruslan Display" },
  { id: "yatra-one", label: "Yatra One" },
] as const;

export type M3FontId = (typeof M3_FONT_OPTIONS)[number]["id"];

export const M3_DEFAULT_FONT: M3FontId = "dynapuff";

export function isM3Font(value: unknown): value is M3FontId {
  return M3_FONT_OPTIONS.some((font) => font.id === value);
}

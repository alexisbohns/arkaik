import {
  Bitcount_Grid_Single,
  DynaPuff,
  Inclusive_Sans,
  Ruslan_Display,
  Yatra_One,
} from "next/font/google";

import type { M3FontId } from "@/components/arkademy/m3-font-options";
import { gochiHand } from "@/lib/fonts";

/**
 * The cover's faces. Inclusive Sans is the plain face (body, label, digits);
 * the brand face (display, headline, title) is DynaPuff by default.
 *
 * PREVIEW ONLY: the four other brand faces (the owner's shortlist) exist so the owner can compare
 * them from the preview panel (`?font=`). Every one is in Next 16.2's Google
 * font list, so all go through next/font (self-hosted, no CSS <link>), each
 * with `preload: false`: their @font-face rules ship with the page, but a
 * file is fetched only when a face is actually shown. (next/font needs each
 * call's options written out as a literal, hence the repetition.) Drop this table, and
 * the panel's font group, once a face is chosen.
 */
export const inclusiveSans = Inclusive_Sans({ subsets: ["latin"], display: "swap" });

/** The default brand face, so the one preloaded. */
export const dynaPuff = DynaPuff({ subsets: ["latin"], display: "swap", axes: ["wdth"] });
const bitcountGridSingle = Bitcount_Grid_Single({ subsets: ["latin"], display: "swap", preload: false });
const ruslanDisplay = Ruslan_Display({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });
const yatraOne = Yatra_One({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });

/** Each brand face's CSS font-family, as next/font named it. */
export const M3_BRAND_FAMILIES: Record<M3FontId, string> = {
  "gochi-hand": gochiHand.style.fontFamily,
  dynapuff: dynaPuff.style.fontFamily,
  "bitcount-grid-single": bitcountGridSingle.style.fontFamily,
  "ruslan-display": ruslanDisplay.style.fontFamily,
  "yatra-one": yatraOne.style.fontFamily,
};

/**
 * The faces as custom properties the stylesheet reads: `--md-font` (plain)
 * and `--md-font-brand`, the latter per `[data-font]` on the cover's wrapper
 * (the panel sets it live; the page sets it from `?font=`).
 */
export const M3_FONT_CSS = [
  `:root:has([data-m3="expressive"]){--md-font:${inclusiveSans.style.fontFamily};--md-font-brand:${dynaPuff.style.fontFamily}}`,
  ...Object.entries(M3_BRAND_FAMILIES).map(
    ([id, family]) => `:root:has([data-m3="expressive"][data-font="${id}"]){--md-font-brand:${family}}`,
  ),
].join("\n");

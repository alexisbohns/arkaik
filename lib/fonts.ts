import { Gochi_Hand, Inclusive_Sans } from "next/font/google";

/**
 * The handwritten accent, in one place.
 *
 * It started on the landing hero, then chapter titles wanted it, then the docs
 * page title did — and by then three modules each called `Gochi_Hand()` with
 * the same arguments. `next/font` keys its generated CSS off the call site, so
 * that is three class names for one typeface. One export, one class.
 */
export const gochiHand = Gochi_Hand({
  subsets: ["latin"],
  weight: "400",
});

/**
 * The reading face of the whole app (Tailwind's `font-sans`, through
 * `--font-inclusive-sans` on <html>) and the Arkademy's plain face
 * (components/arkademy/m3-fonts.ts reads `.style.fontFamily`). Declared once
 * here, for the same reason as `gochiHand`: one call site, one download.
 */
export const inclusiveSans = Inclusive_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inclusive-sans",
});

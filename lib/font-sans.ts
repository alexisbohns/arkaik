import { Inclusive_Sans } from "next/font/google";

/**
 * The reading face of the whole app (Tailwind's `font-sans`, through
 * `--font-inclusive-sans` on <html>) and the Arkademy's plain face
 * (components/arkademy/m3-fonts.ts reads `.style.fontFamily`).
 *
 * Declared alone, in a module of its own: the root layout imports it, and
 * `next/font` preloads every face a module declares, so sharing a file with
 * `gochiHand` (lib/fonts.ts) would preload the handwritten face on every route.
 */
export const inclusiveSans = Inclusive_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inclusive-sans",
});

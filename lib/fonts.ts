import { Gochi_Hand } from "next/font/google";

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

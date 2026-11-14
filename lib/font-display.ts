import { DynaPuff } from "next/font/google";

/**
 * DynaPuff, the Expressive display face: the Arkademy's brand face, and the
 * jumbo figures of the app's Expressive surfaces (the Decisions page's status
 * counts and quarter marks), which read it through `--font-display`. Calm keeps
 * the reading face for those figures.
 *
 * One call for every user: `next/font` keys its generated family off the call
 * site, so a second `DynaPuff()` elsewhere would be a second family of the
 * same files. Not imported by the root layout (it preloads Inclusive Sans and
 * nothing else); a route that shows the face imports this module, and that
 * route alone preloads it.
 */
export const dynaPuff = DynaPuff({ subsets: ["latin"], display: "swap", axes: ["wdth"], variable: "--font-display" });

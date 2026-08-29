"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The gallery: score cards in a row, scrolling horizontally when they overflow.
 *
 * Shared by the matrix's per-domain sections and the Overview's Quality
 * section, which show the same `SurfaceScoreCard` in the same row and so have
 * no business owning two ideas of what that row is.
 *
 * `className` is the edge-bleed, which is the caller's to know: the matrix
 * sections and the Overview card both pad by 4, so they hand it `-mx-4 px-4`
 * and the cards run to the surface's edge instead of stopping short of it; the
 * Overview's row layout has no horizontal padding to escape and passes nothing.
 */
export function QualityGallery({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Its own scrollport, and the reason it is per-section rather than shared:
    // one scrollport across every domain means reaching `api` in Security
    // scrolls it out of view in Accessibility, and the reader loses the
    // comparison the moment they use the page. `snap-x` so a flick lands on a
    // card rather than between two.
    //
    // `overscroll-y-auto` is the wheel fix, and it has to name the axis.
    // `globals.css` gives every `.overflow-x-auto` `overscroll-behavior:
    // contain` — there to stop a swipe becoming browser back/forward — and that
    // shorthand sets BOTH axes. A vertical wheel over the gallery therefore had
    // nowhere to go: containment blocks the scroll chaining that would hand it
    // to the surface, and the gallery itself has nothing to scroll vertically.
    // A wheel over a card stopped dead, and the page only scrolled from the
    // hairline of margin between two sections.
    //
    // Measured, not reasoned — the two intuitive fixes are both wrong, and the
    // second is the one this repo already believes in:
    //
    //   overflow-x-auto                      → trapped
    //   + overflow-y-hidden                  → trapped
    //   + overscroll-behavior: auto          → trapped (specificity, not axes)
    //   + overscroll-behavior-y: auto        → scrolls
    //
    // `overflow-y: hidden` does not help because it removes the y axis's
    // *overflow*, not its scroll-container-ness, and `overscroll-behavior`
    // applies to scroll containers either way. **`components/ui/table.tsx`
    // carries that non-fix and is still trapped** — out of scope here, but it
    // is the same bug and the comment there is wrong.
    //
    // `overscroll-x-contain` keeps the half that was actually wanted.
    <div className={cn("flex snap-x gap-2 overflow-x-auto overscroll-x-contain overscroll-y-auto py-1", className)}>
      {children}
    </div>
  );
}

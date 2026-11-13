"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

interface ExampleGalleryProps {
  /** The `<li>` cards, server-rendered: the gallery only scrolls them. */
  children: ReactNode;
  /** Names the scroller for assistive tech. */
  label: string;
  /** The section's heading and intro, set in the page column beside the arrows. */
  header: ReactNode;
  className?: string;
}

/**
 * The cover's examples as an M3 Expressive carousel, uncontained layout:
 * same-size items that flow past the window's edge (multi-browse and hero mask
 * their items, which would crop the cards' text), 8dp apart. Each item morphs
 * as it enters and leaves focus — smaller and rounder at the edges, full size
 * at rest (scroll-driven CSS, off with reduced motion). The arrows are a
 * connected button group.
 *
 * The cover's examples as one horizontal strip: cards side by side, snapping
 * to their start, the next one peeking in so the row reads as "more this way".
 * It bleeds to the window's edges while its first card lines up with the page
 * column (ARKADEMY_COLUMN's 72rem and padding, mirrored in the padding below).
 *
 * The cards stay server-rendered children: every word is in the HTML. The only
 * client work is the two arrows, which page by one card and grey out at either
 * end; a trackpad, a touch swipe or the keyboard (the strip is focusable) scroll
 * it the native way.
 *
 * The strip uses `[overflow-x:auto]`, not `.overflow-x-auto`: globals.css gives
 * that class `overscroll-behavior: contain` on both axes, which would trap the
 * page's vertical wheel over the strip. `overscroll-y-auto` keeps it chaining.
 * `[overflow-y:hidden]` because the strip's height follows the cards in view
 * (see `measure`): a taller card is cut, never scrolled inside the strip.
 * The strip is `relative` so the cards' `sr-only` spans (absolutely placed)
 * are clipped by it rather than widening the whole page.
 */
export function ExampleGallery({
  children,
  label,
  header,
  className,
}: ExampleGalleryProps) {
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
    // The strip takes the height of the cards in view (at least half shown),
    // not of the tallest card anywhere in it: a short card never sits above a
    // band of empty page. A taller card peeking in is cut at the strip's foot
    // until it scrolls in, and the strip grows to it.
    const box = el.getBoundingClientRect();
    let tallest = 0;
    for (const item of Array.from(el.children) as HTMLElement[]) {
      const rect = item.getBoundingClientRect();
      const shown = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
      if (shown >= rect.width / 2) tallest = Math.max(tallest, item.offsetHeight);
    }
    if (tallest > 0) {
      const style = getComputedStyle(el);
      const chrome =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        (el.offsetHeight - el.clientHeight);
      el.style.height = `${Math.ceil(tallest + chrome)}px`;
    }
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const item of Array.from(el.children)) observer.observe(item);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // offsetWidth, not the box: an item scaled on its way out of focus would
    // page by less than a card.
    el.scrollBy({
      left: direction * (card.offsetWidth + gap),
      behavior: reduce ? "auto" : "smooth",
    });
  };

  return (
    <div className={className}>
      <div className="mx-auto flex w-full max-w-6xl items-end justify-between gap-6 px-4 sm:px-6">
        <div className="min-w-0">{header}</div>
        <div className="mx-group shrink-0">
          <button
            type="button"
            onClick={() => page(-1)}
            disabled={edges.start}
            aria-label="Previous example"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => page(1)}
            disabled={edges.end}
            aria-label="Next example"
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      <ul
        ref={scroller}
        tabIndex={0}
        aria-label={label}
        className={cn(
          "mx-carousel relative mt-8 flex items-start snap-x snap-mandatory gap-2 pt-1 pb-4 [overflow-x:auto] [overflow-y:hidden] overscroll-x-contain overscroll-y-auto",
          "transition-[height] ease-(--mx-spring) duration-(--mx-spring-dur) motion-reduce:transition-none",
          "px-4 scroll-px-4 sm:px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))] sm:scroll-px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))]",
          "outline-none",
          "[&>li]:flex [&>li]:w-[min(88%,52rem)] [&>li]:shrink-0 [&>li]:snap-start",
        )}
      >
        {children}
      </ul>
    </div>
  );
}

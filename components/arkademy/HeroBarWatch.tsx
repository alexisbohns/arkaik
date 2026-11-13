"use client";

import { useEffect, useRef } from "react";

/** The attribute the cover's stylesheet reads to give the app bar its own surface. */
const SOLID = "data-mx-bar-solid";

/**
 * Placed at the foot of the cover's hero: while any of the hero is still under
 * the sticky app bar, the bar wears the hero's color (it reads as part of the
 * hero); once the hero has scrolled away, it sets `data-mx-bar-solid` on the
 * root and the bar takes its surface-container color. The attribute goes
 * when the cover does. Without JavaScript the bar keeps the hero's color.
 */
export function HeroBarWatch() {
  const sentinel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const root = document.documentElement;
    const bar = parseFloat(getComputedStyle(root).getPropertyValue("--mx-bar-height")) || 64;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Out of view above the bar: the hero is gone. Out of view below the
        // window (a short window, scrolled to the top): it is not.
        const gone = !entry.isIntersecting && entry.boundingClientRect.top < bar;
        root.toggleAttribute(SOLID, gone);
      },
      { rootMargin: `-${bar}px 0px 0px 0px` },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeAttribute(SOLID);
    };
  }, []);

  return <span ref={sentinel} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />;
}

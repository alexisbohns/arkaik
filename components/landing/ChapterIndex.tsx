"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ChapterIndexProps {
  items: { id: string; title: string }[];
}

/**
 * The chapter column's section index: one line per section, the one in view
 * drawn in the foreground with a longer rule (spec § Chapter column). Driven by
 * an IntersectionObserver over the section elements, which the sections mount
 * with `id={section.id}`; each line is an anchor to its section.
 */
export function ChapterIndex({ items }: ChapterIndexProps) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  // `items` arrives as an RSC prop, so it keeps its identity across the
  // client's own re-renders. If `LandingPart` ever becomes a client
  // component, key this effect on the joined ids instead.
  useEffect(() => {
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  return (
    // Below `lg` the same index is a horizontal chip row (spec § Theme,
    // responsive); above it, the vertical list with rules. Horizontal overflow
    // is an arbitrary property on purpose: globals.css traps the vertical
    // wheel over every `.overflow-x-auto`.
    <nav
      aria-label="Sections"
      className="-mx-6 flex gap-2 px-6 text-sm [overflow-x:auto] lg:mx-0 lg:mt-6 lg:flex-col lg:gap-0 lg:px-0 lg:leading-8 lg:[overflow-x:visible]"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors",
              "lg:rounded-none lg:border-0 lg:px-0 lg:py-0 lg:text-sm",
              active
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn("hidden h-px transition-all lg:block", active ? "w-6 bg-foreground" : "w-3.5 bg-border")}
            />
            {item.title}
          </a>
        );
      })}
    </nav>
  );
}

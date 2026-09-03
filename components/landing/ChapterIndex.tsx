"use client";

import { useEffect, useState } from "react";

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
    <nav aria-label="Sections" className="mt-6 text-sm leading-8">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active ? "true" : undefined}
            className={
              active
                ? "flex items-center gap-2 text-foreground"
                : "flex items-center gap-2 text-muted-foreground hover:text-foreground"
            }
          >
            <span
              aria-hidden
              className={active ? "h-px w-6 bg-foreground transition-all" : "h-px w-3.5 bg-border transition-all"}
            />
            {item.title}
          </a>
        );
      })}
    </nav>
  );
}

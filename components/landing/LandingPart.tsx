import type { ReactNode } from "react";
import type { Part, Section } from "@/components/landing/content";
import { ChapterIndex } from "@/components/landing/ChapterIndex";
import { gochiHand } from "@/components/landing/fonts";

interface LandingPartProps {
  part: Part;
  /** 1-based position and total, for the kicker. */
  number: number;
  total: number;
  sections: Section[];
  children: ReactNode;
}

/**
 * A chapter (spec § Rhythm): the sticky chapter column on the left — mono
 * kicker, handwritten title, one-line intro, the section index — and the
 * sections scrolling on the right. Below 900px the column becomes a header.
 */
export function LandingPart({ part, number, total, sections, children }: LandingPartProps) {
  const kicker = `PART ${String(number).padStart(2, "0")} · OF ${String(total).padStart(2, "0")}`;
  return (
    <section aria-labelledby={`part-${part.id}`} className="grid gap-10 py-20 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
      <div>
        <div className="lg:sticky lg:top-24">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground">{kicker}</p>
          <h2 id={`part-${part.id}`} className={`${gochiHand.className} mt-2 text-[40px] leading-none text-foreground`}>
            {part.title}
          </h2>
          <p className="mt-3 max-w-[260px] text-sm leading-relaxed text-muted-foreground">{part.intro}</p>
          <div className="hidden lg:block">
            <ChapterIndex items={sections.map((s) => ({ id: s.id, title: s.title }))} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-16">{children}</div>
    </section>
  );
}

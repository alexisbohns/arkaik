"use client";

import Link from "next/link";
import { SectionRow, type SectionRowProps } from "@/components/layout/SectionRow";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";

/**
 * The Overview's section props are the shared row's, verbatim. `description` is
 * drawn only by the rows display, whose left column is wide enough to say it;
 * the card's header has room for the numbers and nothing else.
 */
type OverviewSectionProps = SectionRowProps;

/**
 * The dashboard's shared section, in whichever shell the reader picked.
 *
 * Both shells carry the same header material — icon, title, summary line,
 * jump-off link — and differ only in where they put it: stacked above the body
 * in a card, or beside it in a row. Cards call this and never choose; the
 * choice is the page's, read from `OverviewLayoutContext`.
 */
export function OverviewSection(props: OverviewSectionProps) {
  return useOverviewLayoutContext() === "rows" ? <SectionRow {...props} /> : <OverviewCard {...props} />;
}

/**
 * The card shell.
 *
 * The header is the Pyramid element card's header (`PyramidElementCard`): one
 * large icon over a real title with a quiet line beneath it. That line is where
 * a card's summary numbers belong — "412 nodes · 980 edges" is what the reader
 * came for, so it sits under the title rather than as the first row of the body.
 */
function OverviewCard({ title, icon: Icon, subtitle, href, linkLabel, className, children }: OverviewSectionProps) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {href && linkLabel && (
          <Link href={href} className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {linkLabel} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

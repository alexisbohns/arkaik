import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";

/**
 * The detail-panel section scaffold — panel gutter, micro-label heading, body —
 * opened by hand ~10 times across the panel modules (audit `factorization-10`):
 * six sections inside `NodeDetailPanel`, plus `AcceptancesSection` and
 * `PlaylistEditor`.
 *
 * Beyond the dedup this is the one place that knows the panel gutter, which
 * matters when the panel-stack layout next moves. It is exported as
 * {@link PANEL_GUTTER} for the handful of blocks that sit in a panel body
 * without being a section — a node's title block, the raw panel's toolbar — so
 * a gutter change stays one edit rather than a dozen.
 *
 * The gap drifted between `gap-2` (five sections) and `gap-3` (three) with no
 * discernible intent; `gap-2` wins on count, and the three sections that wrapped
 * a large embedded editor can pass `className="gap-3"` if the tighter spacing
 * reads wrong there.
 *
 * `action` is the `AcceptancesSection` variant — a ghost Button pushed to the
 * right of the heading — hoisted here so the next section that needs one does not
 * re-derive the `justify-between` row.
 *
 * The heading is an `<h3>`. It was a `<span>` while the panel stack had no
 * outline to join — a lone `h3` under nothing is worse than no heading — and
 * that decision was deferred here as "a heading-structure decision for the whole
 * panel stack". The stack has since made it: the page names itself `h1`
 * (`PageHeader`), every open record names itself `h2` (`PanelStack`), and these
 * are the record's own sections at level three. Which is what lets a reader walk
 * a panel by heading instead of by scrolling it.
 *
 * `FIELD_LABEL_CLASS` carries the whole look, and Tailwind's preflight strips a
 * heading's own size and weight, so nothing about these moved on screen.
 */

interface PanelSectionProps {
  title: ReactNode;
  /** Right-aligned control in the heading row — typically a ghost `Button`. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The panel gutter. Tighter below `lg`, where a panel is at most half the
 * window and often the whole of it: six units of chrome on each side of a
 * narrow column is a measurable bite out of the line length.
 */
export const PANEL_GUTTER = "px-5 lg:px-6";

/**
 * The gutter, negated — for a block that must bleed to the panel's own edges
 * from inside a gutter'd parent (the criterion panel's findings board). It has
 * to track {@link PANEL_GUTTER} exactly, which is why it lives beside it.
 */
export const PANEL_GUTTER_BLEED = "-mx-5 lg:-mx-6";

export function PanelSection({ title, action, children, className }: PanelSectionProps) {
  return (
    <section className={cn(PANEL_GUTTER, "flex flex-col gap-2", className)}>
      {action ? (
        <div className="flex items-center justify-between">
          <h3 className={FIELD_LABEL_CLASS}>{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className={FIELD_LABEL_CLASS}>{title}</h3>
      )}
      {children}
    </section>
  );
}

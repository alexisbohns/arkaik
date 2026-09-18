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
 * The heading stays a `<span>` rather than becoming an `<h3>`: these are field
 * micro-labels inside a panel that already carries its own header, and promoting
 * them into the document outline is a heading-structure decision for the whole
 * panel stack, not a side effect of extracting a wrapper.
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
          <span className={FIELD_LABEL_CLASS}>{title}</span>
          {action}
        </div>
      ) : (
        <span className={FIELD_LABEL_CLASS}>{title}</span>
      )}
      {children}
    </section>
  );
}

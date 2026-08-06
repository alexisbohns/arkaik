import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";

/**
 * The detail-panel section scaffold — panel gutter, micro-label heading, body —
 * opened by hand ~10 times across the panel modules (audit `factorization-10`):
 * six sections inside `NodeDetailPanel`, plus `AcceptancesSection` and
 * `PlaylistEditor`.
 *
 * Beyond the dedup this is the one place that knows the panel gutter is `px-6`,
 * which matters when the panel-stack layout next moves.
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

export function PanelSection({ title, action, children, className }: PanelSectionProps) {
  return (
    <section className={cn("px-6 flex flex-col gap-2", className)}>
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

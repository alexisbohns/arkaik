"use client";

import { ShieldIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FINDING_STATUS_LABEL } from "@/components/quality/quality-styles";

/**
 * An accepted risk, as the decision it is — the decision log's bordered row
 * with its status stated over the rationale.
 *
 * The card and the finding panel both draw it, and both drew it verbatim: the
 * same border, the same badge, the same muted paragraph, differing only in the
 * spacing of the wrapper around them. That is the duplication `FindingMark`
 * was carved out to end, so this follows it rather than waiting for the two to
 * drift.
 *
 * The wrapper is the caller's, through `className` — `mt-1` on the card, where
 * the callout is one more item in a gap-1 column, and the panel gutter in the
 * panel, where every block sits inside the same inset. Folding either into
 * this file would make the component know about a layout it is only a guest
 * in.
 *
 * An empty note renders nothing at all. Callers derive the note as
 * `verification?.note || detail`, and the `||` only guards the first of those:
 * a finding filed with no detail and verified with no note falls all the way
 * through to `""`, and the box was drawn around an empty paragraph — which is
 * precisely the failure the `||` exists to prevent, one step further along.
 * Guarding here rather than at each call site, because each call site already
 * proved it would forget.
 *
 * **Amber, not the neutral card.** It was `bg-muted/30` with a plain border,
 * which was distinctive while it was the only boxed thing in the panel. The
 * panel now opens with a Risk table and a Criterion card in the same
 * treatment, and three grey boxes in a column read as three helpings of the
 * same kind of thing — which this is not. It is the one block on the screen
 * that records a *decision*, so it wears the colour its own status already
 * owns: `FINDING_STATUS_TILE["accepted-risk"]` is the amber the shield mark
 * carries down the board's rail, and the shield leads the badge here for the
 * same reason.
 */
export function AcceptedRiskCallout({ note, className }: { note?: string; className?: string }) {
  if (!note || note.trim() === "") return null;

  return (
    <div className={className}>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
        <Badge
          variant="outline"
          className="mb-1.5 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
        >
          <ShieldIcon className="size-3" aria-hidden="true" />
          {FINDING_STATUS_LABEL["accepted-risk"]}
        </Badge>
        <p className="text-sm leading-relaxed text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PanelGroupContext } from "@/components/panels/panel-group-context";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";

interface PanelGroupProps {
  title: ReactNode;
  /**
   * Right of the title, left of the chevron — **display only**: a chip, a count,
   * a badge. Never a control. The bar's whole content is the
   * `CollapsibleTrigger`, which Radix renders as a real `<button>`, so anything
   * interactive here would be a button inside a button: invalid HTML, undefined
   * AT behaviour, and an inner control whose clicks the outer trigger swallows.
   * A group that wants an action puts it on the `action` prop of a
   * `PanelSection` one level down, where it sits on a bar of its own.
   */
  meta?: ReactNode;
  /** Open on mount. History passes false; everything else takes the default. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A named, collapsible region of a panel — the level above `PanelSection`.
 *
 * **The bar is the outline entry and the control at once.** An `h3` whose whole
 * content is the `CollapsibleTrigger`: that is the disclosure pattern, and it is
 * what lets a reader both list a panel's regions and open one without leaving
 * the heading. A heading beside a button would give the outline two entries for
 * one thing; a button with no heading would give it none.
 *
 * **`meta` joins the accessible name, deliberately.** It sits inside the
 * trigger, so it is read as part of the button's name and of the `h3`'s text:
 * a Relations bar carrying a severity chip announces as "Relations critical 3".
 * That is the point rather than a side effect — a reader jumping by heading
 * should hear the urgent thing without opening the group — and it is the other
 * half of the reason the slot takes no control.
 *
 * **No bleed.** The panel body carries `py` only — the horizontal gutter is
 * per-section, owned by `PANEL_GUTTER` — so a group dropped in the body is
 * already flush with the panel's edges. The bar re-applies the gutter to its own
 * contents so the title lines up with the prose above and below it.
 *
 * **The container owns the overlap: `flex flex-col -space-y-px`.** Each bar
 * carries `border-y`, so two collapsed groups stacked plainly would show a
 * two-pixel rule between them; pulling each pair a pixel together collapses it
 * into one hairline, which is what makes a run of shut groups read as a table of
 * contents rather than a ladder of double rules.
 *
 * That overlap is a relationship between siblings, so it belongs to the parent
 * and not to each child: a group carrying its own `-mt-px` would pull itself up
 * into whatever precedes it, would sit a pixel high when used alone, and would
 * leave "the column must have no `gap`" as a rule written only in a comment.
 * `-space-y-px` states the same thing structurally — a container cannot be given
 * a `gap` and the overlap at once — so the constraint enforces itself. The
 * groups need a column of their own regardless: the panel body's `gap-4` would
 * otherwise open a four-unit trench between every pair of bars.
 *
 * **Open/closed is per-mount and not stored.** The panel stack keeps hidden
 * panels mounted, so state does survive a trail being unwound and re-walked —
 * but a panel closed and reopened is a panel in its default shape. Remembering
 * it is a real feature and a plausible follow-up; it is not this one, and
 * storing it would mean first deciding whether the memory is the reader's, the
 * project's or the node's.
 */
export function PanelGroup({ title, meta, defaultOpen = true, children }: PanelGroupProps) {
  return (
    <PanelGroupContext.Provider value={true}>
      <Collapsible defaultOpen={defaultOpen}>
        <h3>
          <CollapsibleTrigger
            className={cn(
              PANEL_GUTTER,
              "group flex w-full items-center gap-2 border-y border-border py-2.5 text-left transition-colors hover:bg-muted/50",
            )}
          >
            <span className={FIELD_LABEL_CLASS}>{title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {meta}
              <ChevronRightIcon
                className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                aria-hidden="true"
              />
            </span>
          </CollapsibleTrigger>
        </h3>
        {/* `gap-4` matches the panel body's own spacing between sections, so a
            group's children sit at the same rhythm as the ungrouped blocks
            above them. */}
        <CollapsibleContent className="flex flex-col gap-4 py-4">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </PanelGroupContext.Provider>
  );
}

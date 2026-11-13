"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PanelGroupContext } from "@/components/panels/panel-group-context";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";

interface PanelGroupProps {
  title: ReactNode;
  /**
   * Right of the title, left of the chevron — **display only**: a chip, a count,
   * a badge, a one-line preview. Never a control. The bar's whole content is the
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
 * **Drawn as a headline, by default.** The bar is a sentence-case title at
 * headline size with a small species-tinted mark, and the regions are set apart
 * by breath, not by rules: a panel reads as a sectioned page rather than a
 * ruled list. A reader can switch the groups to floating cards in Settings →
 * Display (`data-panel-groups` on the root); the markup is the same, only
 * `app/m3/panels.css` differs.
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
 * **Open/closed is per-mount and not stored.** The panel stack keeps hidden
 * panels mounted, so state does survive a trail being unwound and re-walked —
 * but a panel closed and reopened is a panel in its default shape.
 */
export function PanelGroup({ title, meta, defaultOpen = true, children }: PanelGroupProps) {
  return (
    <PanelGroupContext.Provider value={true}>
      <Collapsible defaultOpen={defaultOpen} data-np-group className="np-group">
        <h3 className="np-group-h">
          <CollapsibleTrigger className={cn(PANEL_GUTTER, "np-group-bar")}>
            <span className="np-group-title">{title}</span>
            <span className="np-group-meta">
              {meta}
              <span className="np-group-chevron" aria-hidden="true">
                <ChevronDownIcon className="size-4" />
              </span>
            </span>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="np-group-content">
          <div className="np-group-inner">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </PanelGroupContext.Provider>
  );
}

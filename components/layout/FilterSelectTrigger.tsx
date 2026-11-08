"use client";

import type { ComponentProps, ReactNode } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railItemClass } from "@/components/layout/RightRail";

/** The one skin every filter menu trigger wears — Select-backed or menu-backed. */
function filterTriggerClassName(active: boolean, className?: string) {
  return cn(
    "inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-transparent shadow-xs outline-none focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
    active ? "border-foreground/50 bg-accent text-foreground dark:bg-accent/50" : "border-input text-muted-foreground",
    className,
  );
}

interface FilterSelectTriggerProps
  extends Omit<ComponentProps<typeof SelectPrimitive.Trigger>, "children"> {
  /** The glyph that stands for what this menu narrows. */
  icon: ReactNode;
  /** What the menu filters — the accessible name, and the tooltip's first line. */
  label: string;
  /** Whether a filter is currently set, i.e. anything other than "all". */
  active?: boolean;
  /** The current selection in words, shown in the tooltip while `active`. */
  valueLabel?: string;
  /**
   * Show `valueLabel` even while unset — for a menu whose *default* narrows.
   * A status filter that opens on "Open" is hiding rows, and a tooltip that
   * said only "Status" would make the reader work that out for themselves.
   */
  forceValueLabel?: boolean;
  /**
   * `band` (default) is the bordered square of the toolbar bands; `rail` is the
   * borderless rounded button of `RightRail`, where "set" is a filled surface.
   */
  variant?: "band" | "rail";
  /** Which side the tooltip opens on — `left` on the right rail. */
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

/**
 * A filter menu's trigger, compacted to a single square icon button.
 *
 * The filter bands carry up to six controls, and two open side panels squeeze
 * them into a column of stacked pills — so the menus drop their labels and
 * become one glyph each. Nothing is lost that the bar was really showing:
 * a `w-11rem` trigger reading "All values" is a label pretending to be a value.
 * The name lives in the tooltip and in `aria-label`, and the *set* value — the
 * only state worth a glance — is carried by a darkened border plus the tooltip's
 * second line.
 *
 * Radix's chevron is dropped rather than shrunk: at this size the affordance is
 * the button, and a chevron beside a glyph in 36px reads as noise.
 *
 * "Set" is drawn as a darkened border plus a soft filled surface — never the
 * solid `default` fill, which in these bands means "toggle that is on". A menu
 * holding a value and a toggle that is pressed are different states and must
 * not converge on the same treatment; the toggles beside it drop their own
 * background for the same reason.
 *
 * All of the above is the `band` variant. On the right rail (`variant="rail"`)
 * there is no border at all, and "set" is the rail's filled tonal surface
 * (`railItemClass`).
 */
export function FilterSelectTrigger({
  icon,
  label,
  active = false,
  valueLabel,
  forceValueLabel = false,
  variant = "band",
  tooltipSide,
  className,
  ...props
}: FilterSelectTriggerProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SelectPrimitive.Trigger
          data-slot="select-trigger"
          aria-label={label}
          className={variant === "rail" ? railItemClass(active, className) : filterTriggerClassName(active, className)}
          {...props}
        >
          {icon}
        </SelectPrimitive.Trigger>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={variant === "rail" ? 8 : undefined}>
        {(active || forceValueLabel) && valueLabel ? `${label}: ${valueLabel}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

interface FilterMenuTriggerProps
  extends Omit<ComponentProps<typeof DropdownMenuPrimitive.Trigger>, "children"> {
  icon: ReactNode;
  label: string;
  active?: boolean;
  valueLabel?: string;
}

/**
 * {@link FilterSelectTrigger}'s twin for a `DropdownMenu` — for a filter that
 * holds several values at once (checkbox items), which a `Select` cannot. Same
 * square, same "set" treatment, same tooltip, so the two kinds of menu sit in
 * one band without a seam.
 */
export function FilterMenuTrigger({ icon, label, active = false, valueLabel, className, ...props }: FilterMenuTriggerProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuPrimitive.Trigger
          data-slot="dropdown-menu-trigger"
          aria-label={label}
          className={filterTriggerClassName(active, className)}
          {...props}
        >
          {icon}
        </DropdownMenuPrimitive.Trigger>
      </TooltipTrigger>
      <TooltipContent>{active && valueLabel ? `${label}: ${valueLabel}` : label}</TooltipContent>
    </Tooltip>
  );
}

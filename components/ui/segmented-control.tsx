"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Display mode". */
  ariaLabel: string;
  /**
   * Below `md`, show each option as its icon alone.
   *
   * Opt-in, and only ever honoured for an option that HAS an icon — collapsing a
   * text-only option would leave a blank button, which is worse than a wide one.
   * The label survives as the button's accessible name either way, so the
   * collapse is purely visual.
   *
   * For the strips in a page's own toolbar this is off: they sit in a bar that
   * is allowed to wrap. It is on in the layout header, which is one fixed-height
   * row that also holds a title, a trail and a primary action.
   */
  collapseLabels?: boolean;
  className?: string;
}

/**
 * The repo's segmented toggle: an M3 Expressive connected button group of
 * mutually exclusive options.
 *
 * Each option is its own tonal shape, 3px from the next; the group's outer
 * corners are the pill's and the joints 5px, so the strip reads as one
 * object. The chosen option leaves it — rounds up into a full pill, widens,
 * and takes the group's one solid fill — on the fast spring, while the one it
 * replaces settles back into the joint. All of it lives in
 * app/m3/controls.css under `data-slot="segmented-control"`; this file only
 * says which option is chosen (`aria-pressed`).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  collapseLabels = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn("inline-flex items-center", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            // Explicit, because a collapsed option has no text left to name it.
            aria-label={option.label}
            onClick={() => onChange(option.id)}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap outline-none"
          >
            {Icon && <Icon className="size-4" />}
            {collapseLabels && Icon ? (
              <span className="hidden md:inline">{option.label}</span>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}

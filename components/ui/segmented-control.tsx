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

/** The repo's segmented toggle: a bordered strip of mutually exclusive options. */
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
      className={cn("inline-flex items-center rounded-md border bg-background p-1", className)}
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
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
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

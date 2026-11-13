"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The skin every control on the rail wears — a plain button or a menu trigger.
 *
 * Ported from Krabs' `chromeItemClass`. "On" is a filled tonal surface, the
 * Material rail's active indicator; idle is a bare glyph that tints on hover.
 * The fill is a tint of the foreground rather than `bg-secondary`, which sits
 * a hair off white on the `bg-card` pill and was easy to miss; a tint follows
 * the theme, light or dark.
 * Exported so `FilterSelectTrigger`'s `rail` variant can wear the same skin.
 */
export function railItemClass(active = false, className?: string): string {
  return cn(
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
    active
      ? "bg-foreground/10 text-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    className,
  );
}

/**
 * A page's right rail: a narrow column at the window's right edge, after the
 * panel grid, holding the page's filters and view toggles.
 *
 * In the layout flow on purpose. Krabs' rail is a `fixed` floating pill, which
 * needs a translate hack to dodge its own side panel; here panels open to the
 * rail's left, so the rail never has to move. `PageShell` mounts it via its
 * `rail` prop.
 *
 * An `<aside>`, not a `<nav>`: it holds filters and toggles, not links, and a
 * named complementary landmark is what a screen reader should announce.
 *
 * `pr-3 py-3` matches the panel grid's own `p-3` gutter, and `w-15` (60px)
 * leaves exactly the 48px a `RailGroup` needs.
 */
export function RightRail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      className="flex w-15 shrink-0 flex-col items-center gap-3 overflow-y-auto py-3 pr-3"
    >
      {children}
    </aside>
  );
}

/**
 * One cluster of related rail controls — the rounded pills of the Material
 * rail. A rail of several groups reads as several questions ("when?", "how
 * much?"), not one long column of buttons.
 */
export function RailGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className="flex flex-col items-center gap-1 rounded-2xl bg-card p-1.5"
    >
      {children}
    </div>
  );
}

interface RailButtonProps {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  /** Draw the filled "on" surface — for a filter that is set. */
  active?: boolean;
  /** `aria-pressed` for a toggle; leave unset for a plain action. */
  pressed?: boolean;
  onClick: () => void;
}

/** A square icon button on the rail, its tooltip opening away from the edge. */
export function RailButton({ icon: Icon, label, active = false, pressed, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={railItemClass(active)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

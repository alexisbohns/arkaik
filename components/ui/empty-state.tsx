import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The dashed-border "nothing here yet" card, rebuilt at ~12 surfaces before this
 * existed (audit `factorization-3`).
 *
 * The drift it ends is padding and radius, not layout: `p-10` at the nine
 * page-level sites, `p-8` on the pyramid and `p-4` in the two inline slots, with
 * `rounded-xl` and `rounded-lg` chosen at random between them. `default` takes
 * the dominant page treatment (`rounded-xl p-10`); `sm` takes the inline one
 * (`rounded-lg p-4`), which is a genuinely different thing — a placeholder
 * inside a board column or a settings row, not a whole empty surface.
 *
 * `message` and `action` are nodes rather than strings because most call sites
 * pick their copy from the product scope ("No views in Admin", not "No views
 * yet") and the CTA is a real `Button` with its own handler.
 */

interface EmptyStateProps {
  message: ReactNode;
  /** CTA below the message — a `Button`, or a `Button asChild` wrapping a `Link`. */
  action?: ReactNode;
  /** `default` for an empty page surface, `sm` for a placeholder inside a column. */
  size?: "default" | "sm";
  className?: string;
}

export function EmptyState({ message, action, size = "default", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "border border-dashed text-center",
        size === "sm" ? "rounded-lg p-4" : "rounded-xl p-10",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

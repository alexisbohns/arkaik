"use client";

import { ChevronDownIcon, Link2Icon } from "lucide-react";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { productDisplayTitle } from "@/lib/utils/product-scope";
import type { ProductMembership } from "@/lib/utils/product-membership";

/**
 * Radix reserves the empty string for "no selection", so "Unassigned" — a real
 * choice, not an absence — needs a sentinel. It never leaves this file; the
 * value handed back is `null`.
 */
const UNASSIGNED = "__unassigned__";

/**
 * The node's product as a small chip in the panel header, opening a menu.
 *
 * Membership is a property people rarely change and that says nothing in a
 * one-product project, so it rides beside the id rather than taking a labelled
 * field in the body; the caller drops it entirely when `isMembershipSettled`.
 * What it shows is `describeProductMembership`'s answer, never re-derived:
 *
 * - **Unassigned or stale** is drawn as a dashed "open" chip ("No product",
 *   "Stale product") — an honest gap a reader can act on, never a hidden one.
 * - **Derived** (an acceptance that covers something) carries a link glyph, and
 *   the menu says where the answer comes from before it offers the stored
 *   fallback, which applies only if the acceptance stops covering anything.
 */
export function ProductChip({
  membership,
  onChange,
}: {
  membership: ProductMembership;
  /** Write the stored key; null = unassigned. */
  onChange: (productId: string | null) => void;
}) {
  const open = membership.derived ? membership.displayText === "Unassigned" : membership.selected === null;
  const text = open
    ? membership.value && !membership.derived
      ? "Stale product"
      : "No product"
    : membership.displayText;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-open={open || undefined}
              data-size="s"
              className="np-chip"
              aria-label={`${membership.label}: ${open ? "unassigned" : membership.displayText}. Change product`}
            >
              <span className="np-chip-mark" aria-hidden="true">
                <ExpressiveShape shape="cookie12" className="size-full" />
              </span>
              <span className="min-w-0 truncate">{text}</span>
              {membership.derived && <Link2Icon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              <ChevronDownIcon className="np-chip-chevron size-3.5 shrink-0 opacity-70" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{membership.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {membership.derived ? "From what it covers" : "Product"}
        </DropdownMenuLabel>
        {membership.hint && (
          <p className="max-w-64 px-2 pb-2 text-xs leading-snug text-muted-foreground">{membership.hint}</p>
        )}
        {membership.derived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              If it stops covering anything
            </DropdownMenuLabel>
          </>
        )}
        <DropdownMenuRadioGroup
          value={membership.selected ? membership.selected.id : UNASSIGNED}
          onValueChange={(next) => onChange(next === UNASSIGNED ? null : next)}
        >
          <DropdownMenuRadioItem value={UNASSIGNED}>Unassigned</DropdownMenuRadioItem>
          {membership.products.map((product) => (
            <DropdownMenuRadioItem key={product.id} value={product.id}>
              {productDisplayTitle(product)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

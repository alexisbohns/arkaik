"use client";

import { PRODUCT_MEMBERSHIP_SPECIES, type ProductDefinition } from "@arkaik/schema";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Node } from "@/lib/data/types";
import { productDisplayTitle } from "@/lib/utils/product-scope";

/**
 * The Library's bulk action bar. Selection is a **general** mechanism whose
 * first action happens to be moving nodes between products (§ D6).
 *
 * Data models and API endpoints derive their membership from who consumes them,
 * so a move cannot touch them — but their checkboxes are not disabled. Disabling
 * them would tie a general selection mechanism to one action, and would answer
 * "why can't I tick this?" with silence. Naming the subset instead is both
 * honest and short.
 *
 * THE SUBSET IS PHRASED AS A CAPABILITY, NOT AS A PROMISE. "3 of 5 can hold a
 * product" — never "moves 3 of 5". The bar filters on species, but
 * `planProductMove` applies a *second* filter the bar cannot anticipate before a
 * destination is picked: nodes already in the target are skipped. A bar
 * promising "moves 3 of 5" followed by the toast "Those nodes are already
 * there." contradicts itself, and the count cannot be made right before a
 * destination exists — so the claim is what changes. Capability is true whatever
 * is picked.
 *
 * THE DEGENERATE CASE. With no products declared this renders nothing at all,
 * because "Move to product" is its only action and a bar reading "3 selected /
 * Clear" is a control whose only purpose is to be dismissed. A project that has
 * never heard of products must look exactly as it did before products existed,
 * and that guarantee is worth more than a selection mechanism with nothing to
 * do. The page enforces the same rule one level up by not handing the rows a
 * checkbox at all; the guard is repeated here so the component cannot be
 * mounted into a product-less surface by a future caller and quietly break it.
 * *Rejected:* rendering the bar with the menu hidden — same empty affordance,
 * one more branch, and it teaches the word "selected" to a user who has no bulk
 * action available.
 *
 * IT IS OPAQUE AND CARD-SHAPED because it lives inside `StickyToolbar`, which
 * contributes no background of its own — a translucent band there would let the
 * list scroll visibly through it.
 */

/**
 * Radix's `Select` reserves `""` for "nothing chosen", so "Unassigned" — which
 * is a real destination, and the one that pulls a node back out of a product
 * without editing JSON (§ D6) — needs a sentinel of its own.
 */
const UNASSIGNED = "__unassigned__";

interface LibrarySelectionBarProps {
  /** The selected nodes themselves, not just ids: the bar counts by species. */
  selected: readonly Node[];
  /**
   * How many of `selected` the current filter or search is hiding.
   *
   * Selection deliberately survives a filter change — that is what makes the
   * count equal what a move will actually touch — but a bar saying "7 selected"
   * over three ticked rows is an unexplained number, and the only way out of it
   * would be the all-or-nothing Clear. Naming the gap costs a clause.
   */
  hiddenCount: number;
  products: readonly ProductDefinition[];
  onClear: () => void;
  /** `null` means Unassigned — the key is removed, never blanked. */
  onMove: (productId: string | null) => void;
  busy?: boolean;
}

export function LibrarySelectionBar({
  selected,
  hiddenCount,
  products,
  onClear,
  onMove,
  busy,
}: LibrarySelectionBarProps) {
  if (selected.length === 0 || products.length === 0) return null;

  const movable = selected.filter((node) =>
    PRODUCT_MEMBERSHIP_SPECIES.includes(node.species),
  ).length;
  const derived = selected.length - movable;

  // Hoisted out of the JSX: an inline ternary evaluating to `null` still leaves
  // a live <span> in the flex row, and a flex row pays for an empty child with
  // a gap. Either there is a message or there is no element.
  const subtext =
    movable === 0
      ? "None of these can hold a product — data models and endpoints derive theirs."
      : derived > 0
        ? `${movable} of ${selected.length} can hold a product; data models and endpoints derive theirs.`
        : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-2">
      <span className="text-sm font-medium">
        {selected.length} selected
        {hiddenCount > 0 && (
          <span className="font-normal text-muted-foreground">
            {" "}
            ({hiddenCount} not shown by the current filter)
          </span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          `value=""` keeps this a *command* menu rather than a field: it never
          shows a current product, because a selection of many nodes has no
          single one to show, and re-picking the same destination twice has to
          stay possible.
        */}
        <Select
          value=""
          disabled={busy || movable === 0}
          onValueChange={(next) => onMove(next === UNASSIGNED ? null : next)}
        >
          <SelectTrigger aria-label="Move to product" className="h-8 w-56">
            <SelectValue placeholder="Move to product…" />
          </SelectTrigger>
          <SelectContent>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {/* `title` is not validated by `resolveProducts`; the shared
                    fallback renders the id rather than a nameless row. */}
                {productDisplayTitle(product)}
              </SelectItem>
            ))}
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          </SelectContent>
        </Select>

        {subtext !== null && <span className="text-xs text-muted-foreground">{subtext}</span>}
      </div>

      <Button
        variant="ghost"
        className="ml-auto h-8 cursor-pointer"
        onClick={onClear}
        disabled={busy}
      >
        Clear
      </Button>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import type { ProductScopeOption } from "@/lib/utils/product-scope";

/**
 * The product select's **body**, shared by the sidebar's global scope selector
 * and the four surfaces' override controls. Chrome — trigger classes, icon,
 * width — comes from props; everything below the trigger is identical by
 * construction.
 *
 * Two things in here must never drift between the two callers, which is the
 * whole reason it exists. The `__all__` sentinel: Radix reserves the empty
 * string for "no selection", so "All products" — a real member of the domain,
 * not an absence — needs a value of its own, and the sentinel must never leave
 * this file. And the two-line item: a stacked option would otherwise announce
 * and match as its two lines run together ("End-user app3 platforms"), so
 * `textValue` seeds Radix's typeahead key (otherwise the item's `textContent`)
 * and `aria-hidden` drops the secondary line from the accessible name (which
 * Radix derives from the whole ItemText subtree via `aria-labelledby`, and which
 * `textValue` does not reach). Two mechanisms, two fixes. The secondary line is
 * decoration — the name is the title.
 *
 * `value` is the product id or `null` for All products; the sentinel conversion
 * happens on both edges here so no caller ever holds it.
 */
const ALL_PRODUCTS = "__all__";

interface ProductSelectProps {
  value: string | null;
  onChange: (next: string | null) => void;
  options: ProductScopeOption[];
  /** Rendered inside the trigger, before the label — an icon, usually. */
  triggerIcon?: ReactNode;
  /**
   * Compact the trigger to a square icon button — what the surfaces' filter
   * bands use, where this control is one narrowing menu among several. The
   * sidebar's global scope selector keeps the labelled trigger: it names the
   * frame you are in, which is exactly the thing a glyph cannot say.
   */
  iconOnly?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  ariaLabel: string;
  /** Secondary line on the All products row. */
  allProductsHint: string;
}

export function ProductSelect({
  value,
  onChange,
  options,
  triggerIcon,
  iconOnly = false,
  triggerClassName,
  contentClassName,
  ariaLabel,
  allProductsHint,
}: ProductSelectProps) {
  // A value pointing at a product this project no longer declares degrades to
  // "All products" in the trigger rather than leaving it blank.
  const selected = options.find((option) => option.id === value) ?? null;

  return (
    <Select
      value={selected ? selected.id : ALL_PRODUCTS}
      onValueChange={(next) => onChange(next === ALL_PRODUCTS ? null : next)}
    >
      {iconOnly ? (
        <FilterSelectTrigger
          icon={triggerIcon}
          label={ariaLabel}
          active={selected !== null}
          valueLabel={selected?.label}
          className={triggerClassName}
        />
      ) : (
      <SelectTrigger aria-label={ariaLabel} className={triggerClassName}>
        {triggerIcon}
        {/* Children make Radix render this instead of portaling the selected
            item's text in — so the trigger stays one line while the options
            below carry their second, secondary one. */}
        <SelectValue>
          <span className="truncate">{selected ? selected.label : "All products"}</span>
        </SelectValue>
      </SelectTrigger>
      )}
      <SelectContent align="start" className={contentClassName}>
        <SelectItem value={ALL_PRODUCTS} textValue="All products">
          <span className="grid text-left leading-tight">
            <span className="truncate">All products</span>
            <span aria-hidden className="truncate text-xs text-muted-foreground">
              {allProductsHint}
            </span>
          </span>
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            <span className="grid text-left leading-tight">
              <span className="truncate">{option.label}</span>
              <span aria-hidden className="truncate text-xs text-muted-foreground">
                {option.platformLabel}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

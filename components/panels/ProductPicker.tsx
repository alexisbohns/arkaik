"use client";

import type { ProductDefinition } from "@arkaik/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The one control that assigns a node to a product.
 *
 * One component, three forms (the create form, the node detail panel, the
 * acceptance editor), for the same reason `ProductScopeSelector` is one
 * control: the rules about what "unassigned" means are subtle enough that three
 * copies would diverge, and the third copy would be the one that stored `""`.
 *
 * **The caller decides whether to render it at all.** This component does not
 * check whether the project declares products — its callers do, because a form
 * that has no products to offer must not render an empty field, a label, or the
 * word "product" anywhere. That is the degenerate-case guarantee, and it lives
 * at the call site because only the call site knows what layout to omit.
 */

/**
 * Radix reserves the empty string for "no selection", so "Unassigned" — a real
 * choice, not an absence — needs a sentinel. It never leaves this file; the
 * value handed back is `null`.
 */
const UNASSIGNED = "__unassigned__";

interface ProductPickerProps {
  products: readonly ProductDefinition[];
  value: string | null;
  onChange: (productId: string | null) => void;
  /** Defaults to "Product". The acceptance editor overrides it. */
  label?: string;
  /** Secondary line under the control — the caller's explanation, if any. */
  hint?: string;
  disabled?: boolean;
}

/** The product's `title`, or its id when the definition carries none. */
function productLabel(product: ProductDefinition): string {
  return typeof product.title === "string" && product.title.trim() !== "" ? product.title : product.id;
}

export function ProductPicker({
  products,
  value,
  onChange,
  label = "Product",
  hint,
  disabled,
}: ProductPickerProps) {
  // A stored membership naming a product this project no longer declares
  // degrades to Unassigned in the trigger, matching `ProductScopeSelector`. It
  // is displayed, not healed — writing state as a side effect of rendering
  // would make a half-synced bundle permanently forget a real assignment.
  const selected = products.find((product) => product.id === value) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <Select
        value={selected ? selected.id : UNASSIGNED}
        onValueChange={(next) => onChange(next === UNASSIGNED ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {products.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {productLabel(product)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

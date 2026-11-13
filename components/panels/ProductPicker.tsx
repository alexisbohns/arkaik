"use client";

import { useId } from "react";
import type { ProductDefinition } from "@arkaik/schema";
// The blank-title fallback is one rule with one home. This component renders
// the products the three assignment forms offer, so a private copy here would
// be the copy most users actually read.
import { productDisplayTitle } from "@/lib/utils/product-scope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/ui/field";

/**
 * The control that assigns a new node to a product, in the create forms
 * (`NewNodeForm`, `NewAcceptanceForm`).
 *
 * One component for both, for the same reason `ProductScopeSelector` is one
 * control: the rules about what "unassigned" means are subtle enough that two
 * copies would diverge, and the second copy would be the one that stored `""`.
 * An existing node's product is changed from the node panel's header instead
 * (`ProductChip`, `QuietProduct`), which reads `describeProductMembership`.
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
  /** Defaults to "Product". */
  label?: string;
  /** Secondary line under the control — the caller's explanation, if any. */
  hint?: string;
  disabled?: boolean;
}

export function ProductPicker({
  products,
  value,
  onChange,
  label = "Product",
  hint,
  disabled,
}: ProductPickerProps) {
  // Per-mount: a fixed id would make a second picker's label focus the first
  // picker's select.
  const triggerId = useId();
  // A stored membership naming a product this project no longer declares
  // degrades to Unassigned in the trigger, matching `ProductScopeSelector`. It
  // is displayed, not healed — writing state as a side effect of rendering
  // would make a half-synced bundle permanently forget a real assignment.
  const selected = products.find((product) => product.id === value) ?? null;

  return (
    <Field label={label} htmlFor={triggerId} hint={hint}>
      <Select
        value={selected ? selected.id : UNASSIGNED}
        onValueChange={(next) => onChange(next === UNASSIGNED ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger id={triggerId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {products.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {productDisplayTitle(product)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

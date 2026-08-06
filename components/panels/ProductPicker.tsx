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
  /**
   * Render `text` in the trigger **instead of** the selected option's label,
   * while the menu keeps selecting and reporting `value` unchanged.
   *
   * It exists for exactly one caller: the acceptance editor (§ D5). An
   * acceptance's membership is derived from its `covers` anchors, so when it has
   * any, the live answer is the derived product(s) while `value` is the stored
   * fallback that only applies if the acceptance stops covering anything. Without
   * this the trigger would render the fallback as though it were the answer —
   * which is the precise confusion `productsOfAcceptance` was written to prevent.
   *
   * *Rejected:* a separate read-only "derived product" line above an ordinary
   * picker, which puts two different answers to "what product is this?" on
   * screen at once and leaves the reader to guess which one the app believes.
   * *Rejected:* forking a `DerivedProductPicker`, which would duplicate the
   * `UNASSIGNED` sentinel and the stale-key degradation — the two rules this
   * component exists to keep in one place.
   *
   * The stored value is still fully editable; only its *display* is deferred.
   */
  displayOverride?: { text: string };
  disabled?: boolean;
}

export function ProductPicker({
  products,
  value,
  onChange,
  label = "Product",
  hint,
  displayOverride,
  disabled,
}: ProductPickerProps) {
  // Per-mount, because three forms render this control and the panel stack can
  // hold two of them open at once — a fixed id would make the second picker's
  // label focus the first picker's select.
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
          {/* `SelectValue` renders the *selected* option, which is the stored
              value. When a caller has a different live answer it supplies the
              text itself — see `displayOverride`. */}
          {displayOverride ? <span>{displayOverride.text}</span> : <SelectValue />}
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

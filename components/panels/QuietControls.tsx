"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import { productDisplayTitle } from "@/lib/utils/product-scope";
import type { ProductMembership } from "@/lib/utils/product-membership";
import type { StatusId } from "@/lib/config/statuses";
import { cn } from "@/lib/utils";

/**
 * The Calm look's controls: values that read as text until the pointer or the
 * keyboard reaches them, and as plain text when there is no save path — a
 * read-only surface gets the fact, never a dead control.
 */

/** A status as text: its glyph in its tone, and its name. */
export function StatusText({ value, empty = "No status" }: { value: StatusId | undefined; empty?: string }) {
  if (!value) return <span className="np-calm-value np-calm-value-empty">{empty}</span>;
  const Icon = STATUS_ICONS[value];
  return (
    <span className="np-calm-value">
      <Icon className={cn("size-3.5 shrink-0", STATUS_STYLES[value].badge)} aria-hidden="true" />
      {STATUS_LABELS[value]}
    </span>
  );
}

/** A status select whose fill and chevron appear only under the pointer or the keyboard. */
export function QuietStatus({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: StatusId;
  /** Absent on a read-only surface: the status then reads as text. */
  onChange?: (value: StatusId) => void;
  ariaLabel: string;
  className?: string;
}) {
  if (!onChange) {
    return (
      <span className={cn(className, "np-calm-chip-static")}>
        <StatusText value={value} />
      </span>
    );
  }
  return (
    <Select value={value} onValueChange={(next) => onChange(next as StatusId)}>
      <SelectTrigger aria-label={ariaLabel} className={cn("np-calm-quiet-trigger", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <StatusSelectItems />
      </SelectContent>
    </Select>
  );
}

/**
 * Radix reserves the empty string for "no selection", so "Unassigned" — a real
 * choice, not an absence — needs a sentinel. It never leaves this file.
 */
const UNASSIGNED = "__unassigned__";

/**
 * The product as a quiet select. The trigger shows what the panel should SAY
 * (`displayText`: derived for a covering acceptance, "Unassigned" for a stale
 * key, never healed); the list edits the stored key, with the explanation at
 * its top. The derived and stale cases are said in the trigger's name, since a
 * line this quiet has no room to say them on screen.
 */
export function QuietProduct({
  membership,
  onChange,
  className,
  leading,
}: {
  membership: ProductMembership;
  onChange: (productId: string | null) => void;
  className?: string;
  leading?: ReactNode;
}) {
  const stale = !membership.derived && membership.value !== null && membership.selected === null;
  const qualifier = membership.derived ? "from what it covers" : stale ? `was “${membership.value}”` : null;
  const items = (
    <>
      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
      {membership.products.map((product) => (
        <SelectItem key={product.id} value={product.id}>
          {productDisplayTitle(product)}
        </SelectItem>
      ))}
    </>
  );
  return (
    <Select
      value={membership.selected ? membership.selected.id : UNASSIGNED}
      onValueChange={(next) => onChange(next === UNASSIGNED ? null : next)}
    >
      <SelectTrigger
        aria-label={`Product: ${membership.displayText}${qualifier ? `, ${qualifier}` : ""}`}
        className={cn("np-calm-quiet-trigger", className)}
      >
        <span className={cn("np-calm-value", membership.displayText === "Unassigned" && "np-calm-value-empty")}>
          {leading}
          <span className="truncate">{membership.displayText}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="max-w-80">
        {membership.hint ? (
          <SelectGroup>
            <SelectLabel className="np-calm-menu-hint">{membership.hint}</SelectLabel>
            {items}
          </SelectGroup>
        ) : (
          items
        )}
      </SelectContent>
    </Select>
  );
}

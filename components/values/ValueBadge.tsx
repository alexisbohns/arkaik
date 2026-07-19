"use client";

import type { ValueId } from "@arkaik/schema";
import { VALUES } from "@/lib/config/values";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";

const VALUE_BY_ID = new Map(VALUES.map((v) => [v.id, v]));

export function ValueIcon({ valueId, className }: { valueId: ValueId; className?: string }) {
  const Icon = VALUE_ICON_COMPONENTS[valueId];
  return <Icon className={className ?? "size-3.5"} aria-hidden="true" />;
}

/** Icon + label chip for a value element. */
export function ValueBadge({ valueId }: { valueId: ValueId }) {
  const value = VALUE_BY_ID.get(valueId);
  if (!value) return null;
  return (
    <span
      title={value.label}
      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      <ValueIcon valueId={valueId} className="size-3" />
      <span className="truncate">{value.label}</span>
    </span>
  );
}

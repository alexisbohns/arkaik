"use client";

import Link from "next/link";
import { PlatformAvailability } from "@/components/graph/nodes/PlatformAvailability";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PlatformId } from "@/lib/config/platforms";
import type { PyramidElement } from "@/lib/utils/pyramid";

export interface PyramidElementViewProps {
  element: PyramidElement;
  label: string;
  description: string;
  href: string;
  /**
   * The scope's effective platforms, handed straight to `PlatformAvailability`
   * — which owns the arity rule. Nothing here inspects the length; a card that
   * decided its own shape is exactly the drift the primitive exists to prevent.
   */
  platforms: PlatformId[];
}

/** Grid card: a large value icon over the label, its definition, and its availability. */
export function PyramidElementCard({ element, label, description, href, platforms }: PyramidElementViewProps) {
  const served = element.acceptanceCount > 0;

  return (
    <Link
      href={href}
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 ${served ? "" : "opacity-55"}`}
    >
      <ValueIcon valueId={element.value} className="size-7 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold leading-tight">{label}</h3>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      </div>
      {/* `countLabel` is stated rather than left to the default: the rollup is
          one value element's, so the number beside the bar is acceptances —
          and in the bar that label is visible text, not a hover-card footer. */}
      <PlatformAvailability
        rollup={element.rollup}
        platforms={platforms}
        count={element.acceptanceCount}
        size="lg"
        countLabel="acceptances"
      />
    </Link>
  );
}

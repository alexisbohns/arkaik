"use client";

import Link from "next/link";
import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PyramidElement } from "@/lib/utils/pyramid";

export interface PyramidElementViewProps {
  element: PyramidElement;
  label: string;
  description: string;
  href: string;
}

/** Grid card: a large value icon over the label, its definition, and the ring set. */
export function PyramidElementCard({ element, label, description, href }: PyramidElementViewProps) {
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
      <PlatformRingSet rollup={element.rollup} count={element.acceptanceCount} size="lg" />
    </Link>
  );
}

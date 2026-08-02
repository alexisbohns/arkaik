"use client";

import Link from "next/link";
import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PyramidElementViewProps } from "./PyramidElementCard";

/** List row: the same content on one line, rings right-aligned. */
export function PyramidElementRow({ element, label, description, href }: PyramidElementViewProps) {
  const served = element.acceptanceCount > 0;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40 ${served ? "" : "opacity-55"}`}
    >
      <ValueIcon valueId={element.value} className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </div>
      <PlatformRingSet rollup={element.rollup} count={element.acceptanceCount} size="sm" />
    </Link>
  );
}

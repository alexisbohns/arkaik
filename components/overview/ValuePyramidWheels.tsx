"use client";

import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBreakdownPopover } from "@/components/graph/nodes/StatusBreakdownPopover";
import { StatusRing } from "@/components/graph/nodes/StatusRing";
import { ValueIcon } from "@/components/values/ValueBadge";
import { VALUE_TIERS_CONFIG, VALUES } from "@/lib/config/values";
import { getRollupTotalSegments } from "@/lib/utils/platform-status";
import { splitTierColumns, type PyramidElement, type PyramidTier } from "@/lib/utils/pyramid";

const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((tier) => [tier.id, tier]));
const VALUE_LABEL = new Map(VALUES.map((value) => [value.id, value.label]));

interface ValuePyramidWheelsProps {
  tiers: PyramidTier[];
  /** Where an element's wheel jumps to — the acceptances carrying that value. */
  hrefForValue: (value: string) => string;
}

/**
 * The 30 value elements as one wheel each, laid out as a pyramid on its side.
 *
 * Tiers read left to right, base first: the functional tier's fourteen elements
 * stack as two columns of seven, emotional as two of five, life-changing as
 * three and two, and social impact's single element is the apex. Every column
 * is vertically centred, so the silhouette is a triangle pointing right — the
 * Pyramid page's shape, at a size a dashboard row can hold.
 *
 * The columns come from `splitTierColumns`, which derives them from each tier's
 * own length; nothing here knows that the taxonomy is 14/10/5/1.
 *
 * Each wheel is the element's delivery across every platform in scope, not one
 * ring per platform: thirty wheels is already the density limit of a row, and
 * the per-platform reading is what the Pyramid page itself is for. An element
 * nothing speaks to draws the bare muted track and dims, which is how the
 * Pyramid grid has always shown "unserved".
 */
export function ValuePyramidWheels({ tiers, hrefForValue }: ValuePyramidWheelsProps) {
  return (
    <div className="flex items-stretch gap-4 overflow-x-auto pb-1">
      {tiers.map((tier) => {
        const config = TIER_CONFIG.get(tier.tier);
        const addressed = tier.elements.filter((element) => element.acceptanceCount > 0).length;

        return (
          <div key={tier.tier} className="flex shrink-0 flex-col items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5">
              {splitTierColumns(tier.elements).map((column, index) => (
                <div key={index} className="flex flex-col justify-center gap-1.5">
                  {column.map((element) => (
                    <ValueWheel key={element.value} element={element} href={hrefForValue(element.value)} />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: config?.color }}
                aria-hidden="true"
              />
              <span className="text-[11px] text-muted-foreground">
                {config?.label ?? tier.tier}
                <span className="ml-1 tabular-nums opacity-70">
                  {addressed}/{tier.elements.length}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ValueWheel({ element, href }: { element: PyramidElement; href: string }) {
  const label = VALUE_LABEL.get(element.value) ?? element.value;
  const segments = getRollupTotalSegments(element.rollup);
  const served = element.acceptanceCount > 0;
  const description = served
    ? `${label}: ${element.acceptanceCount} acceptance${element.acceptanceCount === 1 ? "" : "s"}`
    : `${label}: nothing addresses this yet`;

  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          className={`block transition-opacity hover:opacity-100 ${served ? "" : "opacity-45"}`}
          aria-label={description}
        >
          <StatusRing segments={segments} size="sm" label={description}>
            <ValueIcon valueId={element.value} className="size-3 text-muted-foreground" />
          </StatusRing>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-60 p-3">
        <StatusBreakdownPopover
          title={label}
          segments={segments}
          footer={
            served
              ? `${element.acceptanceCount} acceptance${element.acceptanceCount === 1 ? "" : "s"} carry this element`
              : "Nothing addresses this element yet"
          }
        />
      </HoverCardContent>
    </HoverCard>
  );
}

"use client";

import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBreakdownPopover } from "@/components/graph/nodes/StatusBreakdownPopover";
import { StatusRing } from "@/components/graph/nodes/StatusRing";
import { ValueIcon } from "@/components/values/ValueBadge";
import { VALUE_TIERS_CONFIG, VALUES, type ValueId } from "@/lib/config/values";
import { getRollupTotalSegments } from "@/lib/utils/platform-status";
import { splitTierColumns, type PyramidElement, type PyramidTier } from "@/lib/utils/pyramid";

const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((tier) => [tier.id, tier]));
const VALUE_LABEL = new Map(VALUES.map((value) => [value.id, value.label]));

/**
 * What a wheel does when clicked: navigate somewhere (the Overview, which jumps
 * to the Pyramid) or select in place (the Pyramid page's own pane, which swaps
 * to the value's presentation without leaving the page).
 */
type WheelTarget =
  | { hrefForValue: (value: string) => string; onSelectValue?: never }
  | { onSelectValue: (value: ValueId) => void; hrefForValue?: never };

type ValuePyramidWheelsProps = WheelTarget & {
  tiers: PyramidTier[];
  /**
   * `horizontal` (default) lays the pyramid on its side for a dashboard row;
   * `vertical` stands it upright for a narrow column — apex on top, functional
   * base at the bottom.
   */
  orientation?: "horizontal" | "vertical";
};

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
export function ValuePyramidWheels({ tiers, orientation = "horizontal", ...target }: ValuePyramidWheelsProps) {
  if (orientation === "vertical") return <VerticalWheels tiers={tiers} target={target} />;

  return (
    // `overflow-y-hidden` is load-bearing, not tidying: `overflow-x: auto`
    // computes the *other* axis to `auto` too, so a container one pixel taller
    // than its content becomes a vertical scroll container and swallows every
    // wheel event over the pyramid — the page stops scrolling under the
    // cursor. Pinning y to `hidden` gives the wheel back to the page. Nothing
    // is clipped: the columns are centred and shorter than the track.
    <div className="flex items-stretch gap-4 overflow-x-auto overflow-y-hidden pb-1">
      {tiers.map((tier) => {
        const config = TIER_CONFIG.get(tier.tier);
        const addressed = tier.elements.filter((element) => element.acceptanceCount > 0).length;

        return (
          <div key={tier.tier} className="flex shrink-0 flex-col items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5">
              {splitTierColumns(tier.elements).map((column, index) => (
                <div key={index} className="flex flex-col justify-center gap-1.5">
                  {column.map((element) => (
                    <ValueWheel key={element.value} element={element} target={target} />
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

/**
 * The same pyramid stood upright: tiers read bottom to top, base first, and a
 * tier's columns become rows. The rows are reversed within each tier so every
 * tier is narrower at its top than at its bottom (life-changing reads 2 over 3,
 * not 3 over 2), and every row starts at the same left edge — a staircase whose
 * steps line up under the labels rather than a centred triangle.
 *
 * Each tier's label is joined to its wheels: a hairline runs from the label to
 * a bracket spanning that tier's rows, so which wheels a label names is read
 * off the drawing, not guessed from proximity. The label column is as wide as
 * the longest label plus a minimum run of line, so shorter labels get longer
 * lines and every bracket stands on one vertical.
 */
function VerticalWheels({ tiers, target }: { tiers: PyramidTier[]; target: WheelTarget }) {
  return (
    <div className="grid grid-cols-[auto_auto] items-center justify-start gap-y-3">
      {[...tiers].reverse().map((tier) => {
        const config = TIER_CONFIG.get(tier.tier);
        const addressed = tier.elements.filter((element) => element.acceptanceCount > 0).length;

        return (
          <div key={tier.tier} className="contents">
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: config?.color }}
                aria-hidden="true"
              />
              <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                {config?.label ?? tier.tier}
                <span className="ml-1 tabular-nums opacity-70">
                  {addressed}/{tier.elements.length}
                </span>
              </span>
              <span className="ml-1 h-px min-w-6 flex-1 bg-border" aria-hidden="true" />
            </div>
            <div className="flex flex-col items-start gap-1.5 border-l py-1 pl-3">
              {splitTierColumns(tier.elements)
                .reverse()
                .map((row, index) => (
                  <div key={index} className="flex gap-1.5">
                    {row.map((element) => (
                      <ValueWheel key={element.value} element={element} target={target} />
                    ))}
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ValueWheel({ element, target }: { element: PyramidElement; target: WheelTarget }) {
  const label = VALUE_LABEL.get(element.value) ?? element.value;
  const segments = getRollupTotalSegments(element.rollup);
  const served = element.acceptanceCount > 0;
  const description = served
    ? `${label}: ${element.acceptanceCount} acceptance${element.acceptanceCount === 1 ? "" : "s"}`
    : `${label}: nothing addresses this yet`;
  const onSelect = target.onSelectValue;
  const ring = (
    <StatusRing segments={segments} size="sm" label={description}>
      <ValueIcon valueId={element.value} className="size-3 text-muted-foreground" />
    </StatusRing>
  );

  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(element.value)}
            className={`block cursor-pointer rounded-full transition-opacity outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${served ? "" : "opacity-45"}`}
            aria-label={description}
          >
            {ring}
          </button>
        ) : (
          <Link
            href={target.hrefForValue?.(element.value) ?? "#"}
            className={`block transition-opacity hover:opacity-100 ${served ? "" : "opacity-45"}`}
            aria-label={description}
          >
            {ring}
          </Link>
        )}
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

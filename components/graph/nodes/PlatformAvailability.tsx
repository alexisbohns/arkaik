"use client";

import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup, StatusSegment } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments, getRollupTotalSegments } from "@/lib/utils/platform-status";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { STATUS_LABELS, STATUS_STYLES } from "./node-styles";
import { PlatformRingSet } from "./PlatformRingSet";
import type { StatusRingSize } from "./StatusRing";

/**
 * All-zero segments — what the track draws at arity 0, where the scope has no
 * platform for anything to be counted against. A rollup is keyed entirely by
 * platform, so "no platforms in scope" and "nothing counted" are the same fact;
 * summing an empty rollup states it without a special case.
 */
const NOTHING_COUNTED = getRollupTotalSegments({ counts: {}, totals: {} });

/**
 * The bar's accessible name. The rings get theirs from `StatusRing`, and the
 * platform icon that used to name this track in `PlatformGaugeList` is gone by
 * design — without this the bar would be an unlabelled div. It says "Status"
 * rather than a platform name for the same reason the icon went: at arity ≤ 1
 * there is no platform to distinguish.
 */
function describeTrack(segments: readonly StatusSegment[]): string {
  const present = segments.filter((segment) => segment.count > 0);
  if (present.length === 0) return "Status: nothing counted yet";

  const parts = present.map((segment) => `${segment.count} ${STATUS_LABELS[segment.status].toLowerCase()}`);
  return `Status: ${parts.join(", ")}`;
}

interface PlatformAvailabilityProps {
  rollup: PlatformStatusRollup;
  /** The scope's effective platforms — the sole input to the arity rule. */
  platforms: PlatformId[];
  count: number;
  size?: StatusRingSize;
  /**
   * Names what `count` counts. Defaults to `PlatformRingSet`'s own default so
   * the two shapes never label the same number differently — and here the label
   * is load-bearing rather than decorative: in the bar the count is visible
   * text, not a ring centre a hover card explains.
   */
  countLabel?: string;
  platformCountLabel?: string;
}

/**
 * **The arity rule lives here and nowhere else.**
 *
 * Two or more effective platforms → the aggregate ring plus one ring per
 * platform, as before. One or zero → a single bar with the count beside it: at
 * arity 1 the aggregate ring and the platform ring carry identical numbers, and
 * a lone ring beside three-ring cards in another scope reads as *data missing*
 * rather than *absent*.
 *
 * **The bar carries no platform icon at either arity, so 1 and 0 render
 * identically — that is the invariant, not a coincidence.** Scoped to a
 * single-platform product the reader wants a status with no notion of platform
 * at all: the scope selector already says "Admin — Web only", so a Web icon
 * repeated on every card and row is chrome that earns nothing. Dropping it is
 * also what makes the spec's "arity 0 is rendered identically to arity 1" true
 * rather than approximately true. Hence one markup path below for both arities;
 * only *which* counts feed the track differs, and at arity 0 there are none by
 * construction. Nothing here may grow an arity-dependent branch.
 *
 * Every platform-bearing surface composes this rather than choosing a shape
 * itself, so the Pyramid and the Overview can never disagree. The choice itself
 * is `platformAvailabilityShape` in lib/utils/product-scope.ts, where a plain
 * Node test can pin the 2-platform boundary; this component is the switch over
 * it and nothing more.
 */
export function PlatformAvailability({
  rollup,
  platforms,
  count,
  size = "sm",
  countLabel = "acceptances",
  platformCountLabel,
}: PlatformAvailabilityProps) {
  if (platformAvailabilityShape(platforms) === "rings") {
    return (
      <PlatformRingSet
        rollup={rollup}
        platforms={platforms}
        count={count}
        size={size}
        countLabel={countLabel}
        platformCountLabel={platformCountLabel}
      />
    );
  }

  // Destructured rather than length-tested on purpose: `only` is simply the
  // platform in scope, and its absence at arity 0 means there is nothing to
  // count — not a second case to render.
  const [only] = platforms;
  const segments = only ? getPlatformRollupSegments(rollup, only) : NOTHING_COUNTED;
  const counted = segments.some((segment) => segment.count > 0);

  // `PlatformGaugeList`'s track, minus the platform icon and its gutter. Written
  // out rather than delegated with a `showPlatformIcon={false}` prop because at
  // arity 0 that component's own empty guard returns `null`, leaving the count
  // stranded beside a phantom gap that reads as a layout fault rather than as
  // "not tracked". Delegating would therefore have needed two paths kept
  // pixel-identical by hand — exactly the divergence this invariant forbids.
  // The muted fill is the answer the rest of the app already gives an empty
  // rollup: `StatusRing` draws its track alone for an unserved value element.
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 sm:w-32">
        <div
          className="flex h-2 overflow-hidden rounded-md bg-muted"
          role="img"
          aria-label={describeTrack(segments)}
        >
          {counted ? (
            segments.map((segment) => {
              if (segment.count === 0) return null;
              return (
                <div
                  key={segment.status}
                  className={STATUS_STYLES[segment.status].dot}
                  style={{ width: `${segment.ratio * 100}%` }}
                  title={`${segment.status}: ${segment.percentage}%`}
                />
              );
            })
          ) : (
            <div className="h-full w-full bg-muted-foreground/25" title="No counted statuses" />
          )}
        </div>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
        {countLabel ? ` ${countLabel}` : ""}
      </span>
    </div>
  );
}

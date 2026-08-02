"use client";

import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { PlatformGaugeList } from "./PlatformGaugeList";
import { PlatformRingSet } from "./PlatformRingSet";
import type { StatusRingSize } from "./StatusRing";

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
 * rather than *absent*. Arity 0 (a CLI, a public API) renders the same bar with
 * no platform icon, because "availability is not tracked here" and "tracked on
 * exactly one runtime" are the same picture.
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

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 sm:w-32">
        {platforms.length === 0 ? (
          // Not a third shape — the *same* bar, in its empty state. A rollup is
          // keyed entirely by platform, so a scope with no platforms has no
          // counted statuses to draw and `PlatformGaugeList` correctly renders
          // nothing at all. Left alone that strands the count beside a phantom
          // gap, which reads as a layout fault rather than as "not tracked".
          // The muted track is the answer the rest of the app already gives to
          // an empty rollup (`StatusRing` draws its track alone; a gauge with
          // no data draws exactly these classes) — minus the platform icon,
          // because there is no platform to name.
          <div className="flex h-2 overflow-hidden rounded-md bg-muted">
            <div className="h-full w-full bg-muted-foreground/25" title="Availability is not tracked here" />
          </div>
        ) : (
          <PlatformGaugeList rollup={rollup} platforms={platforms} compact />
        )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
        {countLabel ? ` ${countLabel}` : ""}
      </span>
    </div>
  );
}

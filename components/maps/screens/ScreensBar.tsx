"use client";

import { CircleCheckIcon, CircleDashedIcon, LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import { cn } from "@/lib/utils";
import type { WallLens } from "@/lib/utils/screen-wall";

export interface ScreensBarProps {
  /** `wall.platforms`: the lens options, in `PLATFORMS` order. */
  platforms: readonly PlatformId[];
  lens: WallLens;
  onLensChange: (lens: WallLens) => void;
  /** Read by a visually hidden `aria-live="polite"` line ("Showing iOS. 4 gaps."). */
  announcement: string;
  gapsOnly: boolean;
  /** `gapCount(wall, lens)`: distinct (view, lens platform) pairs live with a stale shot or none. */
  gapCount: number;
  onGapsOnlyChange: (next: boolean) => void;
}

const SIDE_BY_SIDE: SegmentedControlOption<WallLens> = { id: "side", label: "Side by side", icon: LayersIcon };

/** Gaps only on a lens with nothing to fix: "No gaps on iOS"; side by side, "No gaps on any platform". */
function noGapsLine(lens: WallLens): string {
  return lens === "side" ? "No gaps on any platform" : `No gaps on ${PLATFORM_LABELS[lens]}`;
}

/**
 * The Screens map's one bar (spec § The bottom bar), at the bottom centre of
 * the canvas: the lens — one option per platform of the scope, then "Side by
 * side" — and the gaps switch with its count. The lens is hidden when the
 * scope has fewer than two platforms (the arity rule: with one there is
 * nothing to choose); the gaps switch is always there.
 *
 * A `bg-card` segment in the Toolbar skin. Below a 40rem canvas it spans the
 * width (the controller's `@container` gives it 12px gutters), the lens takes
 * what the switch leaves and collapses to icons below `md` — the segmented
 * control's own breakpoint, which `components/ui/` keeps as it is. It never
 * scrolls sideways: every `.overflow-x-auto` traps the vertical wheel
 * (app/globals.css).
 *
 * With gaps only on and nothing to fix on the lens, a status pill above the
 * bar says so ("No gaps on iOS") and nothing on the wall fades; the switch
 * stays on and shows 0.
 */
export function ScreensBar({
  platforms,
  lens,
  onLensChange,
  announcement,
  gapsOnly,
  gapCount,
  onGapsOnlyChange,
}: ScreensBarProps) {
  const lensOptions: SegmentedControlOption<WallLens>[] = [
    ...platforms.map((platform) => ({
      id: platform,
      label: PLATFORM_LABELS[platform],
      icon: PLATFORM_ICONS[platform],
    })),
    SIDE_BY_SIDE,
  ];
  const gapsWord = `${gapCount} ${gapCount === 1 ? "gap" : "gaps"}`;

  return (
    <>
      {/* Gaps only with nothing to fix fades nothing (the controller hands the
          canvas no fade): this says why, in the map's pill style, above the bar. */}
      {gapsOnly && gapCount === 0 && (
        <div
          role="status"
          data-no-gaps=""
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm"
        >
          <CircleCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{noGapsLine(lens)}</span>
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Screens display"
        className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-md @max-[40rem]:w-full"
      >
        {platforms.length >= 2 && (
          <SegmentedControl<WallLens>
            options={lensOptions}
            value={lens}
            onChange={onLensChange}
            ariaLabel="Platform lens"
            collapseLabels
            className="@max-[40rem]:flex @max-[40rem]:min-w-0 @max-[40rem]:flex-1 @max-[40rem]:[&>button]:flex-1 @max-[40rem]:[&>button]:justify-center"
          />
        )}
        <Button
          type="button"
          variant={gapsOnly ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={gapsOnly}
          aria-label={`Gaps only, ${gapsWord}`}
          onClick={() => onGapsOnlyChange(!gapsOnly)}
          className="cursor-pointer"
        >
          <CircleDashedIcon aria-hidden />
          <span>Gaps only</span>
          <span
            data-gap-count=""
            className={cn(
              "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
              gapCount > 0 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
            )}
          >
            {gapCount}
          </span>
        </Button>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </>
  );
}

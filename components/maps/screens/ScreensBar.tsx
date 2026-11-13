"use client";

import { useEffect, useRef } from "react";
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
 * A `bg-card` segment in the Toolbar skin. It answers to the canvas's own
 * width (the controller's `@container`), never the window's: a panel narrows
 * the canvas without narrowing the window. From a 33rem canvas up every
 * label shows on one line (the labelled bar is about 481px, plus its 12px
 * gutters; every `@max-[33rem]` below is that one breakpoint). Below it the bar spans the width, the lens options show their
 * icons only (each keeps its accessible name and gets a `title`) and the gaps
 * switch keeps its icon and count and drops its word — so nothing wraps or
 * overlaps down to a 280px canvas. The segmented control collapses its labels
 * by the viewport (`md`), and `components/ui/` is not edited by hand, so the
 * bar overrides that from outside: its label spans show or hide by the
 * container query instead. It never scrolls sideways: every
 * `.overflow-x-auto` traps the vertical wheel (app/globals.css).
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

  // A lens option shown as its icon alone still says what it is on hover: the
  // shared control takes no per-option `title`, so the bar copies each
  // option's accessible name onto it once the buttons exist.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const lensNames = lensOptions.map((option) => option.label).join("|");
  useEffect(() => {
    toolbarRef.current?.querySelectorAll<HTMLButtonElement>('[role="group"] > button').forEach((button) => {
      const name = button.getAttribute("aria-label");
      if (name) button.title = name;
    });
  }, [lensNames]);

  return (
    <>
      {/* Gaps only with nothing to fix fades nothing (the controller hands the
          canvas no fade): this says why, in the map's pill style, above the bar. */}
      {gapsOnly && gapCount === 0 && (
        <div
          role="status"
          data-no-gaps=""
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-(--md-surface-container) px-3 py-1.5 text-xs shadow-(--m3-elev-1)"
        >
          <CircleCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{noGapsLine(lens)}</span>
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Screens display"
        ref={toolbarRef}
        // A floating M3 bar: no stroke, a full pill at elevation 2, its
        // controls (app/m3/controls.css, `role="toolbar"`) a step denser than
        // a page band's, 36px, so the bar stays as wide as it was.
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-(--md-surface-container) p-1.5 whitespace-nowrap shadow-(--m3-elev-2) [--m3-ctl-h:2.25rem] @max-[33rem]:w-full"
      >
        {platforms.length >= 2 && (
          <SegmentedControl<WallLens>
            options={lensOptions}
            value={lens}
            onChange={onLensChange}
            ariaLabel="Platform lens"
            collapseLabels
            className="[&>button>span]:inline! @max-[33rem]:flex @max-[33rem]:min-w-0 @max-[33rem]:flex-1 @max-[33rem]:[&>button]:flex-1 @max-[33rem]:[&>button]:justify-center @max-[33rem]:[&>button>span]:hidden!"
          />
        )}
        <Button
          type="button"
          variant={gapsOnly ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={gapsOnly}
          aria-label={`Gaps only, ${gapsWord}`}
          title="Gaps only"
          onClick={() => onGapsOnlyChange(!gapsOnly)}
          className="cursor-pointer"
        >
          <CircleDashedIcon aria-hidden />
          <span className="@max-[33rem]:hidden">Gaps only</span>
          <span
            data-gap-count=""
            className={cn(
              "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
              gapCount > 0 ? "bg-tone-amber/15 text-tone-amber" : "bg-(--md-surface-container-highest) text-(--md-on-surface-variant)",
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

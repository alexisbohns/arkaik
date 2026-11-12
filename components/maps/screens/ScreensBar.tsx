"use client";

import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { WallLens } from "@/lib/utils/screen-wall";

export interface ScreensBarProps {
  /** `wall.platforms`: one lens option each, in `PLATFORMS` order. */
  platforms: readonly PlatformId[];
  lens: WallLens;
  onLensChange: (lens: WallLens) => void;
  /** Read by a visually hidden `aria-live="polite"` line ("Showing iOS."). */
  announcement: string;
}

/**
 * The Screens map's one piece of chrome: a small bar at the bottom centre of
 * the canvas holding the platform lens. The controller renders it only when
 * the scope offers two platforms or more (the arity rule): with one there is
 * nothing to choose.
 *
 * A `bg-card` segment in the Toolbar skin. Below a 40rem canvas it spans the
 * width (the controller's `@container` gives it 12px gutters) and the lens
 * collapses to icons below `md` — the segmented control's own breakpoint,
 * which `components/ui/` keeps as it is. It never scrolls sideways: every
 * `.overflow-x-auto` traps the vertical wheel (app/globals.css).
 */
export function ScreensBar({ platforms, lens, onLensChange, announcement }: ScreensBarProps) {
  const options: SegmentedControlOption<WallLens>[] = platforms.map((platform) => ({
    id: platform,
    label: PLATFORM_LABELS[platform],
    icon: PLATFORM_ICONS[platform],
  }));

  return (
    <div
      role="toolbar"
      aria-label="Screens display"
      className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-md @max-[40rem]:w-full"
    >
      <SegmentedControl<WallLens>
        options={options}
        value={lens}
        onChange={onLensChange}
        ariaLabel="Platform lens"
        collapseLabels
        className="@max-[40rem]:flex @max-[40rem]:w-full @max-[40rem]:[&>button]:flex-1 @max-[40rem]:[&>button]:justify-center"
      />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

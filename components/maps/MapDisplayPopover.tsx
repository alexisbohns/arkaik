"use client";

import type { ReactNode } from "react";
import {
  CircleDashedIcon,
  EyeIcon,
  EyeOffIcon,
  ListIcon,
  PieChartIcon,
  RowsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  type MapDisplayOptions,
  type MapFlowPlatformsMode,
  type MapViewPlatformsMode,
  type ResolvedMapDisplay,
} from "@arkaik/schema";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

/** Which controls a renderer can honour — System maps draw no flow cards. */
export interface MapDisplayControls {
  images?: boolean;
  flowPlatforms?: boolean;
  viewPlatforms?: boolean;
}

const ALL_CONTROLS: Required<MapDisplayControls> = {
  images: true,
  flowPlatforms: true,
  viewPlatforms: true,
};

interface MapDisplayPopoverProps {
  /** The map's resolved display — every key present. */
  value: ResolvedMapDisplay;
  /** Receives only the keys that changed, to be merged into the stored override. */
  onChange: (patch: MapDisplayOptions) => void;
  /** Names the map in the popover header, e.g. "Recording Loop". */
  mapTitle?: string;
  controls?: MapDisplayControls;
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-[11px] leading-snug text-muted-foreground/80">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The Display button: per-map card rendering, saved against this map alone
 * (docs/spec/maps.md § Display Options). It replaces the old project-wide
 * compact/large preset — the same two looks are still one click apart, but
 * each parameter now moves on its own and a project's Journey and its
 * Recording Loop can disagree.
 */
export function MapDisplayPopover({
  value,
  onChange,
  mapTitle,
  controls = ALL_CONTROLS,
}: MapDisplayPopoverProps) {
  const { images = false, flowPlatforms = false, viewPlatforms = false } = controls;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="cursor-pointer">
          <SlidersHorizontalIcon className="size-4" />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h4 className="text-sm font-semibold">Display</h4>
            <p className="text-[11px] text-muted-foreground">
              {mapTitle ? `Saved for “${mapTitle}” only.` : "Saved for this map only."}
            </p>
          </div>

          {images && (
            <Field label="Images" hint="Screenshots, falling back to the cover art.">
              <SegmentedControl
                ariaLabel="Images"
                className="w-full [&>button]:flex-1"
                value={value.images ? "shown" : "hidden"}
                onChange={(next) => onChange({ images: next === "shown" })}
                options={[
                  { id: "shown", label: "Show", icon: EyeIcon },
                  { id: "hidden", label: "Hide", icon: EyeOffIcon },
                ]}
              />
            </Field>
          )}

          {flowPlatforms && (
            <Field label="Flow platforms" hint="How a flow card sums up its delivery.">
              <SegmentedControl
                ariaLabel="Flow platform delivery"
                className="w-full [&>button]:flex-1"
                value={value.flow_platforms}
                onChange={(next) => onChange({ flow_platforms: next as MapFlowPlatformsMode })}
                options={[
                  { id: "rings", label: "Rings", icon: PieChartIcon },
                  { id: "bars", label: "Lines", icon: ListIcon },
                ]}
              />
            </Field>
          )}

          {viewPlatforms && (
            <Field label="View platforms" hint="How a view card shows where it ships.">
              <SegmentedControl
                ariaLabel="View platform availability"
                className="w-full [&>button]:flex-1"
                value={value.view_platforms}
                onChange={(next) => onChange({ view_platforms: next as MapViewPlatformsMode })}
                options={[
                  { id: "chips", label: "Chips", icon: CircleDashedIcon },
                  { id: "rows", label: "Lines", icon: RowsIcon },
                ]}
              />
            </Field>
          )}

          {!images && !flowPlatforms && !viewPlatforms && (
            <p className="text-xs text-muted-foreground">This map has nothing to tweak.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

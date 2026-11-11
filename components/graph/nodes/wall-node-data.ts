import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { WallLens, WallScreen } from "@/lib/utils/screen-wall";

/**
 * The `data` of the Screens map's React Flow nodes (`ScreensCanvas` builds
 * them). `type` aliases, not interfaces: React Flow constrains node data to
 * `Record<string, unknown>`, which an interface does not satisfy.
 *
 * Fields later parts need (dimming, selection, keyboard moves) are added by
 * those parts as required fields, in the same commit as the builder that fills
 * them — a field nothing fills would be a lie the type checker cannot see.
 */

/** A loaded shot's measured width / height, reported for the slot's current value. */
export type AspectReport = (viewId: string, platform: PlatformId, value: string, ratio: number) => void;

export type WallFrameData = {
  frameId: string;
  viewId: string;
  stripId: string;
  stripTitle: string;
  /** The view's states, shared by every frame that shows it. */
  screen: WallScreen;
  lens: WallLens;
  /** `wall.platforms`: the scope's menu, in `PLATFORMS` order. */
  platforms: readonly PlatformId[];
  /** `WallBox.shotWidth`: the shot box, centred in the node. */
  shotWidth: number;
  /** "in Yes of Has a streak?" when the frame is the first item of an arm, else null. */
  armContext: string | null;
  /** The Minimap's fill: the lens platform's status (side by side: the highest in `getRollupDisplayStatus` order). */
  status?: StatusId;
  onActivate: (frameId: string, viewId: string, stripId: string) => void;
  onAspect: AspectReport;
};

export type WallHeaderData = {
  stripId: string;
  flowId: string | null;
  title: string;
  /** `stripCountsLine(wall, strip, lens)`. */
  countsLine: string;
  /** "no-flows": the Journey pointer line above "Not in a flow", for a scope with views and no flow. */
  note: "no-flows" | null;
  /** A change rings the header for 2s (a jump tile landed here); 0 = never rung. */
  ringVersion: number;
  onOpenFlow: ((flowId: string) => void) | null;
};

export type WallMarkerData = {
  variant: "arm" | "end" | "empty";
  branch: "condition" | "junction" | null;
  /** The branch's own label ("Has a streak?"); "" for an empty-flow marker. */
  label: string;
  /** The arm's label ("Yes", "No", a junction case); "" for end and empty markers. */
  arm: string;
  /** An arm with no items, or the empty-flow ghost. */
  empty: boolean;
};

export type WallJumpData = {
  flowId: string;
  title: string;
  screenCount: number;
  onJump: (flowId: string) => void;
};

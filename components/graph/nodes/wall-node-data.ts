import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { WallLens, WallScreen, WallTouch } from "@/lib/utils/screen-wall";

/**
 * The `data` of the Screens map's React Flow nodes (`ScreensCanvas` builds
 * them). `type` aliases, not interfaces: React Flow constrains node data to
 * `Record<string, unknown>`, which an interface does not satisfy.
 *
 * Fields later parts need (dimming, selection, keyboard moves) are added by
 * those parts as required fields, in the same commit as the builder that fills
 * them — a field nothing fills would be a lie the type checker cannot see.
 */

/** A loaded shot's measured width / height, reported for the slot's current shot: `value` is its fingerprint (aspect-cache `shotKey`), never the shot itself. */
export type AspectReport = (viewId: string, platform: PlatformId, value: string, ratio: number) => void;

/** The selected frame (part 4): the frame, the view it shows, and the strip it sits in. */
export interface WallSelection {
  frameId: string;
  viewId: string;
  stripId: string;
}

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
  /** Gaps only, and this frame shows no gap under the lens: drawn at 15% and greyscale, still clickable. */
  dimmed: boolean;
  /** Gaps only, side by side, and this frame is a gap: its rows that are not gaps, drawn at 35%. Empty otherwise. */
  dimmedRows: readonly PlatformId[];
  /** This frame is the selection: the ring and `aria-current`; the touch chips hang off it. */
  selected: boolean;
  /** An arrow key on the focused frame; the controller picks the neighbour and moves focus there. */
  onMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;
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
  /** Gaps only, and no view in the strip is a gap under the lens: the header softens to 40%. */
  dimmed: boolean;
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
  /** Gaps only: a marker is never a gap, so it fades with everything that is not one. */
  dimmed: boolean;
};

export type WallJumpData = {
  flowId: string;
  title: string;
  screenCount: number;
  onJump: (flowId: string) => void;
  /** Gaps only: a jump tile is never a gap, so it fades with everything that is not one. */
  dimmed: boolean;
};

/**
 * A touch chip under the selected frame (part 4): an endpoint or data model the
 * view touches, or "+N more" (which opens the view's own panel). Rendered
 * aria-hidden with tabIndex -1: the inspector's Touches list is its accessible twin.
 */
export type WallChipData =
  | { kind: "touch"; frameId: string; touch: WallTouch; onOpen: (nodeId: string) => void }
  | { kind: "more"; frameId: string; viewId: string; count: number; onOpen: (nodeId: string) => void };

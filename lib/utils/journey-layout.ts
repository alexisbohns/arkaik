/**
 * The Journey map's layout (docs/superpowers/specs/2026-10-08-journey-canvas-rework-design.md).
 *
 * `buildJourneyGraph` walks the journey — the compose closure, then each
 * expanded flow's playlist with its branches — and returns the structure it
 * walked as a tree of blocks. `layoutJourney` turns that tree into positions,
 * synchronously and deterministically: a toggle moves only what sits after the
 * toggled flow in its own sequence, and re-centres the rows that contain it.
 */

export type JourneyBlock =
  /**
   * A card. `children` are the blocks hung under it: the compose children of a
   * closure node, or the playlist sequence of an expanded flow.
   */
  | { kind: "node"; id: string; children: JourneyBlock[] }
  /** Playlist entries one after the other. */
  | { kind: "sequence"; items: JourneyBlock[] }
  /** The synthetic branch card, its arms side by side. */
  | { kind: "branch"; id: string; arms: JourneyBlock[] };

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

/** Reading direction: `DOWN` stacks a sequence top to bottom, `RIGHT` left to right. */
export type JourneyDirection = "DOWN" | "RIGHT";

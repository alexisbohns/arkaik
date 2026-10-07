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

/** Space along the reading direction between a card and the row under it, and between sequence items. */
export const GAP_MAIN = 48;
/** Space across the reading direction between siblings in a row. */
export const GAP_CROSS = 40;

/** A block's extent in reading-direction (`main`) and across it (`cross`). */
interface Extent {
  main: number;
  cross: number;
}

const EMPTY: Extent = { main: 0, cross: 0 };

const childrenOf = (block: JourneyBlock): JourneyBlock[] =>
  block.kind === "sequence" ? block.items : block.kind === "node" ? block.children : block.arms;

/**
 * Place every card of the block tree. Pure and synchronous.
 *
 * In abstract axes — `main` is the reading direction, `cross` the other one:
 * a card's children form a row across, `GAP_MAIN` below it, and the card is
 * centred over the row; a sequence stacks its items along `main`, each centred
 * on the sequence's cross-centre; a branch is a card over the row of its arms.
 * Every flow and view card is `CARD_WIDTH` wide, so a sequence of cards is a
 * straight line. A toggle therefore moves only the items after the toggled
 * flow in its own sequence, and re-centres the rows that contain it — nothing
 * else.
 *
 * `direction` swaps the axes: `DOWN` reads top to bottom, `RIGHT` left to right.
 */
export function layoutJourney(
  roots: readonly JourneyBlock[],
  sizeOf: (id: string) => Size,
  direction: JourneyDirection = "DOWN",
): Map<string, Point> {
  const extents = new Map<JourneyBlock, Extent>();

  const cardExtent = (id: string): Extent => {
    const size = sizeOf(id);
    return direction === "DOWN" ? { main: size.height, cross: size.width } : { main: size.width, cross: size.height };
  };

  const rowExtent = (blocks: readonly JourneyBlock[]): Extent => {
    let main = 0;
    let cross = 0;
    for (const block of blocks) {
      const extent = measure(block);
      if (extent.cross === 0) continue;
      cross += (cross > 0 ? GAP_CROSS : 0) + extent.cross;
      main = Math.max(main, extent.main);
    }
    return { main, cross };
  };

  const measure = (block: JourneyBlock): Extent => {
    const known = extents.get(block);
    if (known) return known;

    let extent: Extent;
    if (block.kind === "sequence") {
      let main = 0;
      let cross = 0;
      for (const item of block.items) {
        const itemExtent = measure(item);
        if (itemExtent.cross === 0) continue;
        main += (main > 0 ? GAP_MAIN : 0) + itemExtent.main;
        cross = Math.max(cross, itemExtent.cross);
      }
      extent = main === 0 ? EMPTY : { main, cross };
    } else {
      const card = cardExtent(block.id);
      const row = rowExtent(childrenOf(block));
      extent = {
        main: card.main + (row.main > 0 ? GAP_MAIN + row.main : 0),
        cross: Math.max(card.cross, row.cross),
      };
    }

    extents.set(block, extent);
    return extent;
  };

  const positions = new Map<string, Point>();
  const put = (id: string, main: number, cross: number) => {
    const at = { main: Math.round(main), cross: Math.round(cross) };
    positions.set(id, direction === "DOWN" ? { x: at.cross, y: at.main } : { x: at.main, y: at.cross });
  };

  const placeRow = (blocks: readonly JourneyBlock[], main: number, crossCentre: number) => {
    const row = rowExtent(blocks);
    let cross = crossCentre - row.cross / 2;
    for (const block of blocks) {
      const extent = measure(block);
      if (extent.cross === 0) continue;
      place(block, main, cross + extent.cross / 2);
      cross += extent.cross + GAP_CROSS;
    }
  };

  const place = (block: JourneyBlock, main: number, crossCentre: number) => {
    if (block.kind === "sequence") {
      let cursor = main;
      for (const item of block.items) {
        const extent = measure(item);
        if (extent.cross === 0) continue;
        place(item, cursor, crossCentre);
        cursor += extent.main + GAP_MAIN;
      }
      return;
    }

    const card = cardExtent(block.id);
    put(block.id, main, crossCentre - card.cross / 2);
    placeRow(childrenOf(block), main + card.main + GAP_MAIN, crossCentre);
  };

  placeRow(roots, 0, rowExtent(roots).cross / 2);
  return positions;
}

/** The node or branch block carrying `id`, searched depth-first; `null` when none does. */
export function findBlock(roots: readonly JourneyBlock[], id: string): JourneyBlock | null {
  for (const block of roots) {
    if (block.kind !== "sequence" && block.id === id) return block;
    const hit = findBlock(childrenOf(block), id);
    if (hit) return hit;
  }
  return null;
}

/** Every card id inside a block, the block's own card first. */
export function blockNodeIds(block: JourneyBlock | null): string[] {
  if (!block) return [];
  const ids: string[] = [];
  const walk = (current: JourneyBlock) => {
    if (current.kind !== "sequence") ids.push(current.id);
    childrenOf(current).forEach(walk);
  };
  walk(block);
  return ids;
}

/** The bounding box of a block's cards, from placed positions; `null` for an empty block. */
export function blockBounds(
  block: JourneyBlock | null,
  positions: ReadonlyMap<string, Point>,
  sizeOf: (id: string) => Size,
): Rect | null {
  let rect: Rect | null = null;
  for (const id of blockNodeIds(block)) {
    const at = positions.get(id);
    if (!at) continue;
    const size = sizeOf(id);
    if (!rect) {
      rect = { x: at.x, y: at.y, width: size.width, height: size.height };
      continue;
    }
    const right = Math.max(rect.x + rect.width, at.x + size.width);
    const bottom = Math.max(rect.y + rect.height, at.y + size.height);
    rect.x = Math.min(rect.x, at.x);
    rect.y = Math.min(rect.y, at.y);
    rect.width = right - rect.x;
    rect.height = bottom - rect.y;
  }
  return rect;
}

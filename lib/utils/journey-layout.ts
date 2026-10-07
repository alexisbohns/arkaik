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

const childrenOf = (block: JourneyBlock): JourneyBlock[] =>
  block.kind === "sequence" ? block.items : block.kind === "node" ? block.children : block.arms;

/** One piece of a contour: over the main interval `[from, to)`, the edge sits at `value` across. */
interface Segment {
  from: number;
  to: number;
  value: number;
}

/** A placed block, in its own frame: card offsets, its two contours, and the line it is centred on. */
interface Placed {
  offsets: Map<string, { main: number; cross: number }>;
  /** The leftmost card edge at every main position the block occupies. */
  left: Segment[];
  /** The rightmost card edge at every main position the block occupies. */
  right: Segment[];
  /** The cross position of the block's card centre (a sequence: its line). */
  centre: number;
  /** Where the block ends along main. */
  mainEnd: number;
}

const breakpoints = (a: Segment[], b: Segment[]): number[] =>
  [...new Set([...a, ...b].flatMap((segment) => [segment.from, segment.to]))].sort((x, y) => x - y);

const valueAt = (segments: Segment[], from: number, to: number): number | undefined =>
  segments.find((segment) => segment.from <= from && segment.to >= to)?.value;

/** The pointwise combination of two contours — `Math.min` for a left edge, `Math.max` for a right one. */
function combine(a: Segment[], b: Segment[], pick: (x: number, y: number) => number): Segment[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const points = breakpoints(a, b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const x = valueAt(a, from, to);
    const y = valueAt(b, from, to);
    const value = x === undefined ? y : y === undefined ? x : pick(x, y);
    if (value === undefined) continue;
    const last = out[out.length - 1];
    if (last && last.to === from && last.value === value) last.to = to;
    else out.push({ from, to, value });
  }
  return out;
}

const shiftSegments = (segments: Segment[], by: number): Segment[] =>
  by === 0 ? segments : segments.map((segment) => ({ ...segment, value: segment.value + by }));

const shiftPlaced = (placed: Placed, by: number): Placed =>
  by === 0
    ? placed
    : {
        offsets: new Map([...placed.offsets].map(([id, at]) => [id, { main: at.main, cross: at.cross + by }])),
        left: shiftSegments(placed.left, by),
        right: shiftSegments(placed.right, by),
        centre: placed.centre + by,
        mainEnd: placed.mainEnd,
      };

/**
 * How far right `next` must move so that, wherever the two overlap along
 * main, its left edge clears `right` by `gap`. Negative when it could even
 * move left; the caller clamps as it sees fit.
 */
function clearance(right: Segment[], next: Segment[], gap: number): number {
  let needed = -Infinity;
  for (const r of right) {
    for (const n of next) {
      if (r.to <= n.from || n.to <= r.from) continue;
      needed = Math.max(needed, r.value + gap - n.value);
    }
  }
  return needed;
}

/**
 * Place every card of the block tree. Pure and synchronous.
 *
 * In abstract axes — `main` is the reading direction, `cross` the other one.
 * A card's children form a row across, `GAP_MAIN` below it; a sequence stacks
 * its items along `main`, each centred on the sequence's line; a branch is a
 * card over the row of its arms.
 *
 * Rows pack by contour, the Reingold–Tilford way: each sibling moves right
 * only as far as its left contour needs to clear the contour of everything
 * before it, so a wide subtree tucks under a leaf neighbour instead of
 * claiming its whole bounding box. A card is centred between its first and
 * last child. Every flow and view card is `CARD_WIDTH` wide, so a sequence of
 * cards is a straight line. A toggle therefore never moves anything along
 * `main` outside the toggled flow's own sequence, and slides what sits to its
 * right across by at most the block's growth.
 *
 * `direction` swaps the axes: `DOWN` reads top to bottom, `RIGHT` left to right.
 */
export function layoutJourney(
  roots: readonly JourneyBlock[],
  sizeOf: (id: string) => Size,
  direction: JourneyDirection = "DOWN",
): Map<string, Point> {
  const cardExtent = (id: string) => {
    const size = sizeOf(id);
    return direction === "DOWN" ? { main: size.height, cross: size.width } : { main: size.width, cross: size.height };
  };

  const empty = (main: number): Placed => ({ offsets: new Map(), left: [], right: [], centre: 0, mainEnd: main });

  /** Pack `blocks` left to right at `main`, each in its own frame, and merge them into one. */
  const placeRow = (blocks: readonly JourneyBlock[], main: number): { row: Placed; first: Placed | null; last: Placed | null } => {
    let row = empty(main);
    let first: Placed | null = null;
    let last: Placed | null = null;
    for (const block of blocks) {
      const placed = place(block, main);
      if (placed.offsets.size === 0) continue;
      const by = first === null ? 0 : Math.max(clearance(row.right, placed.left, GAP_CROSS), 0);
      const shifted = shiftPlaced(placed, by);
      row = {
        offsets: new Map([...row.offsets, ...shifted.offsets]),
        left: combine(row.left, shifted.left, Math.min),
        right: combine(row.right, shifted.right, Math.max),
        centre: 0,
        mainEnd: Math.max(row.mainEnd, shifted.mainEnd),
      };
      first ??= shifted;
      last = shifted;
    }
    return { row, first, last };
  };

  const place = (block: JourneyBlock, main: number): Placed => {
    if (block.kind === "sequence") {
      // Items one under the other, every one centred on the line at 0.
      let cursor = main;
      let placed = empty(main);
      for (const item of block.items) {
        const itemAlone = place(item, cursor);
        const itemPlaced = shiftPlaced(itemAlone, -itemAlone.centre);
        if (itemPlaced.offsets.size === 0) continue;
        placed = {
          offsets: new Map([...placed.offsets, ...itemPlaced.offsets]),
          left: [...placed.left, ...itemPlaced.left],
          right: [...placed.right, ...itemPlaced.right],
          centre: 0,
          mainEnd: itemPlaced.mainEnd,
        };
        cursor = itemPlaced.mainEnd + GAP_MAIN;
      }
      return placed;
    }

    const card = cardExtent(block.id);
    const { row, first, last } = placeRow(childrenOf(block), main + card.main + GAP_MAIN);
    const centre = first && last ? (first.centre + last.centre) / 2 : 0;
    const cardLeft = centre - card.cross / 2;
    const cardSegment = { from: main, to: main + card.main };
    return {
      offsets: new Map([[block.id, { main, cross: cardLeft }], ...row.offsets]),
      left: combine([{ ...cardSegment, value: cardLeft }], row.left, Math.min),
      right: combine([{ ...cardSegment, value: cardLeft + card.cross }], row.right, Math.max),
      centre,
      mainEnd: Math.max(main + card.main, row.mainEnd),
    };
  };

  const { row } = placeRow(roots, 0);
  const minCross = Math.min(0, ...[...row.offsets.values()].map((at) => at.cross));
  const positions = new Map<string, Point>();
  for (const [id, at] of row.offsets) {
    const main = Math.round(at.main);
    const cross = Math.round(at.cross - minCross);
    positions.set(id, direction === "DOWN" ? { x: cross, y: main } : { x: main, y: cross });
  }
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

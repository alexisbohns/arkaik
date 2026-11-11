import type { PlatformId } from "@/lib/config/platforms";
import type { Rect } from "@/lib/utils/journey-layout";
import type { Wall, WallItem, WallLens } from "@/lib/utils/screen-wall";

/**
 * The Screens map's layout (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § Layout): strips stacked top to bottom, each a header over one row of items
 * left to right ("Not in a flow" wraps). Computed directly — no ELK — and
 * synchronously, so a lens change or a measured shot re-lays the wall in one
 * pass. All values are px in flow coordinates.
 */

export type { Rect } from "@/lib/utils/journey-layout";

/** Height of every frame's shot box. */
export const FRAME_H = 280;
/** Caption under the box: title line + state line. */
export const CAPTION_GAP = 8;
export const CAPTION_H = 36;
/** Box + caption: 324. */
export const FRAME_NODE_H = FRAME_H + CAPTION_GAP + CAPTION_H;
/** A frame node is never narrower; the box centres in it. */
export const FRAME_MIN_W = 144;
/** Width / height before a shot loads, and for ghosts. */
export const DEFAULT_ASPECT: Record<PlatformId, number> = { web: 1.6, ios: 0.4615, android: 0.45 };
/** Clamp on measured aspects. */
export const ASPECT_MIN = 0.3;
export const ASPECT_MAX = 2.4;
/** Between consecutive items in a strip. */
export const ITEM_GAP = 24;
/** Marker widths; both are FRAME_H tall, top-aligned with boxes. */
export const ARM_W = 24;
export const END_W = 12;
/** Jump tile, centred on the box: (FRAME_H − JUMP_H) / 2 = JUMP_Y. */
export const JUMP_W = 144;
export const JUMP_H = 96;
export const JUMP_Y = 92;
/** The empty-flow ghost, FRAME_H tall. */
export const EMPTY_W = 280;
/** Strip header and the space under it. */
export const HEADER_H = 44;
export const HEADER_GAP = 12;
/** A header is as wide as its strip, at least this. */
export const HEADER_MIN_W = 360;
/** Between one strip's last row and the next header. */
export const STRIP_GAP = 72;
/** Only "Not in a flow" wraps. */
export const LOOSE_PER_ROW = 8;
export const ROW_GAP = 40;
/** Between platform rows in a side-by-side frame. */
export const SIDE_ROW_GAP = 6;
/** Platform tag column, state word column. */
export const SIDE_TAG_W = 28;
export const SIDE_WORD_W = 72;
/** Touch chips. */
export const CHIP_W = 220;
export const CHIP_H = 28;
export const CHIP_GAP = 6;
export const CHIP_MAX = 8;
/** Chips start this far below the selected frame node. */
export const CHIP_OFFSET = 16;
/** Below this zoom, frames drop images and captions. */
export const LOD_ZOOM = 0.35;

/** The gaps around a side-by-side mini: after the tag column, before the word column. */
export const SIDE_TAG_GAP = 6;
export const SIDE_WORD_GAP = 8;

export type WallBoxKind = "header" | "frame" | "arm" | "end" | "jump" | "empty";

export interface WallBox extends Rect {
  id: string;
  kind: WallBoxKind;
  stripId: string;
  row: number;
  /** Frames only: the shot box width (≤ width, centred in it); null for every other kind. */
  shotWidth: number | null;
}

export interface WallLayout {
  /** Strip by strip, item by item: the DOM and Tab order. */
  boxes: WallBox[];
  strips: ReadonlyMap<string, Rect>;
  bounds: Rect;
}

/** Measured width / height of a loaded shot, or undefined. */
export type AspectOf = (viewId: string, platform: PlatformId) => number | undefined;

export function clampAspect(aspect: number): number {
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
}

/** The aspect a mini or a box is drawn at: the measured one while the cell shows a shot, else the platform default. */
function aspectFor(wall: Wall, viewId: string, platform: PlatformId, aspectOf: AspectOf): number {
  const cell = wall.screens.get(viewId)?.cells[platform];
  if (cell?.shot && cell.state !== "absent") {
    const measured = aspectOf(viewId, platform);
    if (measured !== undefined && Number.isFinite(measured) && measured > 0) return clampAspect(measured);
  }
  return DEFAULT_ASPECT[platform];
}

/** Side-by-side geometry of one frame, n = wall.platforms.length (spec § Layout). */
export function sideGeometry(
  wall: Wall,
  viewId: string,
  aspectOf: AspectOf,
): { rowHeight: number; miniWidths: Partial<Record<PlatformId, number>>; shotWidth: number } {
  const n = Math.max(1, wall.platforms.length);
  const rowHeight = (FRAME_H - (n - 1) * SIDE_ROW_GAP) / n;
  const miniWidths: Partial<Record<PlatformId, number>> = {};
  let widest = 0;
  for (const platform of wall.platforms) {
    const width = Math.round(rowHeight * aspectFor(wall, viewId, platform, aspectOf));
    miniWidths[platform] = width;
    widest = Math.max(widest, width);
  }
  return { rowHeight, miniWidths, shotWidth: SIDE_TAG_W + SIDE_TAG_GAP + widest + SIDE_WORD_GAP + SIDE_WORD_W };
}

function frameShotWidth(wall: Wall, viewId: string, lens: WallLens, aspectOf: AspectOf): number {
  if (lens === "side") return sideGeometry(wall, viewId, aspectOf).shotWidth;
  return Math.round(FRAME_H * aspectFor(wall, viewId, lens, aspectOf));
}

/** An item's size and its offset from the top of its row. */
function itemBox(
  item: WallItem,
  wall: Wall,
  lens: WallLens,
  aspectOf: AspectOf,
): { width: number; height: number; dy: number; shotWidth: number | null } {
  switch (item.kind) {
    case "frame": {
      const shotWidth = frameShotWidth(wall, item.viewId, lens, aspectOf);
      return { width: Math.max(shotWidth, FRAME_MIN_W), height: FRAME_NODE_H, dy: 0, shotWidth };
    }
    case "jump":
      return { width: JUMP_W, height: JUMP_H, dy: JUMP_Y, shotWidth: null };
    case "arm":
      return { width: ARM_W, height: FRAME_H, dy: 0, shotWidth: null };
    case "end":
      return { width: END_W, height: FRAME_H, dy: 0, shotWidth: null };
    case "empty":
      return { width: EMPTY_W, height: FRAME_H, dy: 0, shotWidth: null };
  }
}

/**
 * Positions for every header and item. Strips start at x = 0; the header sits
 * at the strip's y, items `HEADER_H + HEADER_GAP` below it, advancing by width
 * + `ITEM_GAP`. The lens changes widths, never the vertical rhythm.
 */
export function layoutWall(wall: Wall, lens: WallLens, aspectOf: AspectOf): WallLayout {
  const boxes: WallBox[] = [];
  const strips = new Map<string, Rect>();
  let y = 0;
  let maxWidth = 0;

  wall.strips.forEach((strip, index) => {
    if (index > 0) y += STRIP_GAP;
    const top = y;
    const itemsTop = top + HEADER_H + HEADER_GAP;
    const wraps = strip.flowId === null;
    const header: WallBox = { id: strip.id, kind: "header", stripId: strip.id, row: 0, x: 0, y: top, width: HEADER_MIN_W, height: HEADER_H, shotWidth: null };
    boxes.push(header);

    let x = 0;
    let row = 0;
    let inRow = 0;
    let contentWidth = 0;
    for (const item of strip.items) {
      if (wraps && inRow === LOOSE_PER_ROW) {
        row += 1;
        inRow = 0;
        x = 0;
      }
      const rowTop = itemsTop + row * (FRAME_NODE_H + ROW_GAP);
      const { width, height, dy, shotWidth } = itemBox(item, wall, lens, aspectOf);
      boxes.push({ id: item.id, kind: item.kind, stripId: strip.id, row, x, y: rowTop + dy, width, height, shotWidth });
      contentWidth = Math.max(contentWidth, x + width);
      x += width + ITEM_GAP;
      inRow += 1;
    }

    const rows = row + 1;
    const width = Math.max(contentWidth, HEADER_MIN_W);
    const height = HEADER_H + HEADER_GAP + rows * FRAME_NODE_H + (rows - 1) * ROW_GAP;
    header.width = width;
    strips.set(strip.id, { x: 0, y: top, width, height });
    maxWidth = Math.max(maxWidth, width);
    y = top + height;
  });

  return { boxes, strips, bounds: { x: 0, y: 0, width: maxWidth, height: y } };
}

/* --- Camera, keyboard neighbours, chips ------------------------------------ */

/**
 * The viewport that shows `rect`: zoom = clamp(min((W − 2p) / w, (H − 2p −
 * bottomInset) / h), minZoom, maxZoom). On each axis the rect is centred in
 * the space above the bottom inset, or start-aligned (left, top) at the
 * padding when it overflows that space at this zoom.
 */
export function frameViewport(
  rect: Rect,
  viewport: { width: number; height: number },
  options: { padding: number; bottomInset: number; minZoom: number; maxZoom: number },
): { x: number; y: number; zoom: number } {
  const { padding, bottomInset, minZoom, maxZoom } = options;
  const roomW = viewport.width - 2 * padding;
  const roomH = viewport.height - 2 * padding - bottomInset;
  const fit = Math.min(roomW / rect.width, roomH / rect.height);
  const zoom = Math.min(maxZoom, Math.max(minZoom, fit));
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  const x = w > roomW ? padding - rect.x * zoom : (viewport.width - w) / 2 - rect.x * zoom;
  const y = h > roomH ? padding - rect.y * zoom : (viewport.height - bottomInset - h) / 2 - rect.y * zoom;
  return { x, y, zoom };
}

/** The opening camera's padding (screen px) and zoom bounds. The padding is WallCamera's WALL_CAMERA_PADDING. */
const OPENING_PADDING = 32;
const OPENING_MIN_ZOOM = 0.7;
const OPENING_MAX_ZOOM = 1;

/**
 * The map's first viewport: the first strip's header at the top-left of the
 * usable canvas (the viewport less `insets`), `OPENING_PADDING` in from it, at
 * the zoom that fits the strip's full width into the usable width, clamped to
 * [0.7, 1] so captions stay readable. A strip too wide for the canvas at 0.7
 * stays left-aligned and runs off to the right — the strips below it show
 * underneath instead of empty canvas above it. Height never sets the zoom, so
 * `insets.bottom` only matters to callers that share the insets with
 * `frameViewport`. No strip: the identity viewport.
 */
export function openingViewport(
  layout: WallLayout,
  viewport: { width: number; height: number },
  insets: { top?: number; right?: number; bottom?: number; left?: number } = {},
): { x: number; y: number; zoom: number } {
  const first = layout.strips.values().next();
  if (first.done) return { x: 0, y: 0, zoom: 1 };
  const rect = first.value;
  const top = insets.top ?? 0;
  const left = insets.left ?? 0;
  const roomW = viewport.width - left - (insets.right ?? 0) - 2 * OPENING_PADDING;
  const zoom = Math.min(OPENING_MAX_ZOOM, Math.max(OPENING_MIN_ZOOM, roomW / rect.width));
  return { x: left + OPENING_PADDING - rect.x * zoom, y: top + OPENING_PADDING - rect.y * zoom, zoom };
}

/** A React Flow viewport: screen = flow × zoom + (x, y). */
type Viewport = { x: number; y: number; zoom: number };

/**
 * The strip the reader is in: the one whose rect is nearest the viewport's
 * vertical centre (distance 0 inside it; a tie goes to the first strip in
 * layout order). null with no strip. Horizontal position plays no part — a
 * strip is a row.
 */
export function stripNearViewport(
  layout: WallLayout,
  viewport: Viewport,
  size: { width: number; height: number },
): string | null {
  const centreY = (size.height / 2 - viewport.y) / viewport.zoom;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [id, rect] of layout.strips) {
    const distance = centreY < rect.y ? rect.y - centreY : Math.max(0, centreY - (rect.y + rect.height));
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * After a lens change, the viewport that keeps the reader in `stripId`: when
 * the viewport's horizontal centre falls outside the strip's extent in the
 * new `layout`, the same zoom and vertical position, panned so the strip's
 * start sits `padding` in from the left edge. null when the centre is still
 * inside the strip (nothing moves) or the strip is not in `layout`.
 */
export function keepStripViewport(
  layout: WallLayout,
  stripId: string,
  viewport: Viewport,
  size: { width: number; height: number },
  padding: number,
): Viewport | null {
  const rect = layout.strips.get(stripId);
  if (!rect) return null;
  const centreX = (size.width / 2 - viewport.x) / viewport.zoom;
  if (centreX >= rect.x && centreX <= rect.x + rect.width) return null;
  return { x: padding - rect.x * viewport.zoom, y: viewport.y, zoom: viewport.zoom };
}

/**
 * The arrow-key neighbour among frames only: left/right within the row;
 * up/down to the frame in the previous/next row (or strip) whose centre x is
 * nearest, skipping rows with no frame. null at the edges, and for an id that
 * is not a frame.
 */
export function neighbourFrame(layout: WallLayout, frameId: string, dir: "left" | "right" | "up" | "down"): string | null {
  const rows: WallBox[][] = [];
  let rowKey: string | null = null;
  for (const box of layout.boxes) {
    if (box.kind !== "frame") continue;
    const key = `${box.stripId}\u0000${box.row}`;
    if (key !== rowKey) {
      rows.push([]);
      rowKey = key;
    }
    rows[rows.length - 1].push(box);
  }

  const rowIndex = rows.findIndex((row) => row.some((box) => box.id === frameId));
  if (rowIndex < 0) return null;
  const row = rows[rowIndex];
  const current = row.find((box) => box.id === frameId)!;

  if (dir === "left" || dir === "right") {
    const index = row.indexOf(current);
    return row[dir === "left" ? index - 1 : index + 1]?.id ?? null;
  }

  const target = rows[dir === "up" ? rowIndex - 1 : rowIndex + 1];
  if (!target) return null;
  const centre = current.x + current.width / 2;
  let best = target[0];
  for (const box of target) {
    if (Math.abs(box.x + box.width / 2 - centre) < Math.abs(best.x + best.width / 2 - centre)) best = box;
  }
  return best.id;
}

/** Chip rects under a frame node: a column at the frame's x, `CHIP_OFFSET` below it. */
export function chipRects(frame: WallBox, count: number): Rect[] {
  const rects: Rect[] = [];
  for (let index = 0; index < count; index += 1) {
    rects.push({
      x: frame.x,
      y: frame.y + frame.height + CHIP_OFFSET + index * (CHIP_H + CHIP_GAP),
      width: CHIP_W,
      height: CHIP_H,
    });
  }
  return rects;
}

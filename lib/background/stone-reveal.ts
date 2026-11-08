/**
 * The stone hidden in the home hero's ASCII terrain. The stone is a fixed
 * stencil — an ordered-dither bitmap of the brand mark, one bit per grid cell
 * — and the terrain's drifting clouds are the light that reveals it: a cloud
 * passing over a stroke cell keeps (and deepens) its density, a cloud passing
 * over the stone's white body thins out. Where there is no cloud there is
 * nothing to see, so how obvious the stone is depends entirely on the
 * weather — a faint hint one moment, the whole mark under a passing bank of
 * cloud the next.
 *
 * Everything here is pure and canvas-free so the math stays easy to reason
 * about; the component owns the DOM, the image load and the frame loop.
 */

/** 4×4 ordered-dither (Bayer) threshold matrix, row-major, values 0..15. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A cell's Bayer threshold re-centred to `[-0.5, 0.5)`. */
export function bayerOffset(col: number, row: number): number {
  return (BAYER_4[(row & 3) * 4 + (col & 3)] + 0.5) / 16 - 0.5;
}

/** The stone's square footprint on the character grid, in cells. */
export interface StoneRect {
  col: number;
  row: number;
  size: number;
}

/**
 * Centres a square stone on a `cols × rows` grid, as large as `fitHeight` of
 * the grid's height allows while staying within `fitWidth` of its width
 * (the width cap is what keeps it whole on a portrait phone). Returns null
 * when the result would be too few cells to read as anything.
 */
export function fitStone(
  cols: number,
  rows: number,
  fitHeight: number,
  fitWidth: number,
  minCells: number,
): StoneRect | null {
  const size = Math.floor(Math.min(rows * fitHeight, cols * fitWidth));
  if (size < minCells) return null;
  return {
    col: Math.floor((cols - size) / 2),
    row: Math.floor((rows - size) / 2),
    size,
  };
}

/**
 * Turns an RGBA bitmap of the stone rasterized at one pixel per cell into two
 * per-cell grids: `cover` (alpha — is this cell on the stone at all) and
 * `ink` (inverted luma — 1 on the black strokes, 0 on the white body). Thin
 * strokes come out as partial values, which the dither then renders as
 * sparse glyphs rather than dropping them.
 */
export function sampleStone(
  data: ArrayLike<number>,
  size: number,
): { cover: Float32Array<ArrayBuffer>; ink: Float32Array<ArrayBuffer> } {
  const cover = new Float32Array(size * size);
  const ink = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const alpha = data[o + 3] / 255;
    cover[i] = alpha;
    ink[i] = alpha > 0 ? 1 - (data[o] + data[o + 1] + data[o + 2]) / (3 * 255) : 0;
  }
  return { cover, ink };
}

/**
 * Lights one cell of the stone stencil with the terrain's own value (0..1).
 * The cell's ink is ordered-dithered against its Bayer offset into a single
 * bit: an ink cell is brightened by `inkGain` (never above `inkCeiling`, and
 * never dimmer than the terrain), a body cell is dimmed to `paperGain` of the
 * terrain. `cover` (the stone's alpha, eased in on mount) blends the result
 * back towards the untouched terrain at the stone's rim. Zero terrain stays
 * zero either way — the stone only ever shows where a cloud lights it.
 */
export function lightStone(
  value: number,
  ink: number,
  cover: number,
  dither: number,
  inkGain: number,
  paperGain: number,
  inkCeiling: number,
): number {
  if (cover <= 0) return value;
  const lit = ink + dither > 0.5 ? Math.max(value, Math.min(value * inkGain, inkCeiling)) : value * paperGain;
  return value + (lit - value) * cover;
}

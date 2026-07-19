/**
 * Tuning for the home page's ASCII "ridged mountains" background
 * (issue #280), ported from ComputerK's CodePen
 * (https://codepen.io/ComputerK/pen/jENaeKp). Values are a direct port of
 * the pen's `CONFIG` object except `maxOpacity`, which is new here since
 * the app paints the theme's foreground color over the page background
 * instead of the pen's plain white-on-black.
 */

/** Noise-space scale per pixel. Lower = larger, slower-rolling ridges. */
export const NOISE_SCALE = 0.004;

/** Grid cell size in CSS px — one ASCII character per cell. */
export const CHAR_SIZE = 10;

/** Distance in px over which the texture fades in from each canvas edge. */
export const EDGE_DISTANCE = 100;

/** Cells whose edge-fade factor falls below this are skipped entirely. */
export const BRIGHTNESS_THRESHOLD = 0.05;

/** Octaves of ridged noise layered together. */
export const OCTAVE_NUM = 4;

/** Frequency multiplier applied per successive octave. */
export const FREQ_MULTIPLIER = 2.2;

/** Amplitude multiplier applied per successive octave. */
export const AMP_MULTIPLIER = 0.45;

/** Animation frame rate cap, in fps. */
export const FRAME_RATE = 30;

/** Speed the noise field pans per rendered frame, in noise-space units. */
export const NOISE_PAN_SPEED = 0.001;

/** Brightness ramp, darkest to brightest. */
export const ASCII_CHARS = [" ", ".", ":", "-", "~", "+", "=", "^", "*", "#", "@", "█"];

/**
 * Ceiling on the foreground color's alpha, applied on top of each cell's
 * brightness/edge-fade factor. Keeps the texture a subtle backdrop rather
 * than the pen's stark full-contrast terminal look.
 */
export const MAX_OPACITY = 0.35;

/**
 * On mount, the texture eases in from `INTRO_START_FACTOR × MAX_OPACITY`
 * (soft, logo-first) up to the full `MAX_OPACITY` (ridges, contrast) over
 * `INTRO_DURATION_MS`, instead of appearing at full contrast immediately.
 * Skipped under `prefers-reduced-motion: reduce`, which renders straight at
 * full contrast.
 */
export const INTRO_DURATION_MS = 6000;

/** Opacity fraction the texture starts at when the intro begins. */
export const INTRO_START_FACTOR = 0.06;

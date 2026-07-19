/**
 * Tuning for the icon-wobble effect (issue #271).
 *
 * The filter is an `feTurbulence` → `feDisplacementMap` pair applied to every
 * `svg.lucide` via CSS `filter: url(#…)`. The filter primitives run in
 * `userSpaceOnUse` space, which for a lucide icon is its `viewBox="0 0 24 24"`
 * coordinate system — shared by *every* lucide icon regardless of rendered px.
 * That is what makes a single filter per icon name read proportionally the same
 * at a 16px nav icon and a 96px empty-state icon, with no per-size variants.
 *
 * Values were calibrated visually against Chromium (see the prototype's 150px
 * reference of a subtle hand-drawn bend). Displacement and frequency are in
 * viewBox units / cycles-per-viewBox-unit.
 */

/** Displacement amplitude, in viewBox units (out of 24). ~8% of the icon. */
export const DISPLACEMENT_SCALE = 2;

/** Turbulence base frequency, in cycles per viewBox unit (~1.4 cycles / icon). */
export const BASE_FREQUENCY = 0.06;

/** Octaves of noise. 1 reads as one confident hand-drawn bend (higher = rougher). */
export const OCTAVES = 1;

/** Boil animation rate while hovered/focused (spec: 4–6 fps). */
export const BOIL_FPS = 5;

/**
 * Seed offsets applied to a filter's base seed during a boil, cycled on repeat.
 * A short ping-pong (base → +1 → +2 → +1 → base → …) reads as a gentle "boil"
 * rather than a jittery scramble.
 */
export const BOIL_SEED_STEPS = [0, 1, 2, 1] as const;

/** Icons carrying this class are left un-wobbled (perf/fidelity escape hatch). */
export const NO_WOBBLE_CLASS = "no-wobble";

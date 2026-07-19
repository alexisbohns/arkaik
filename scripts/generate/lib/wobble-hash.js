"use strict";

/**
 * Deterministic seed derivation for the icon-wobble filter registry
 * (docs/spec — issue #271). Build-time only: seeds are baked into the
 * generated artifacts so the runtime never hashes.
 *
 * The seed picks which slice of `feTurbulence` noise an icon gets. Keeping it a
 * pure function of the icon's kebab-case name is what makes the wobble feel
 * "static" — the same icon wobbles identically across sessions and reloads, and
 * different icons wobble differently from one another.
 */

/** Number of distinct seeds. `feTurbulence` seed is an integer; 20 slices give
 * plenty of visual variety while leaving headroom for the +2 boil ping-pong. */
const SEED_SPACE = 20;

/** FNV-1a (32-bit), a small deterministic string hash with good dispersion. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Base seed for an icon's kebab-case name, in `[0, SEED_SPACE)`. */
function seedFor(name) {
  return fnv1a(name) % SEED_SPACE;
}

module.exports = { SEED_SPACE, fnv1a, seedFor };

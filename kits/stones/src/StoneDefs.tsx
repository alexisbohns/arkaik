/**
 * The shared paint server stone icons stroke with: `url(#stone-icon)`.
 *
 * Mounted once at the app root, like `WobbleFilters`. Its stops read
 * `--stone-icon-1..3`, which css/stones.css maps to the secondary stone's icon
 * tone for the current theme — so the gradient follows the reader's stones and
 * the theme with no JavaScript. `userSpaceOnUse` in lucide's 24×24 viewBox,
 * because an objectBoundingBox gradient paints nothing on a perfectly straight
 * stroke (its box has no height). The stops resolve where the gradient is
 * defined, not where it is used — a subtree that forces the other theme
 * (`.stone-scope-*`) needs its own gradient.
 *
 * A server component: static markup, no hydration cost.
 */
export function StoneDefs() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id="stone-icon" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="8" y2="24">
          <stop offset="0" style={{ stopColor: "var(--stone-icon-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stone-icon-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--stone-icon-3)" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

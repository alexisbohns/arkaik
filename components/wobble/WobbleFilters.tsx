import { WOBBLE_ICONS } from "@/lib/wobble/wobble-registry.generated";
import {
  BASE_FREQUENCY,
  DISPLACEMENT_SCALE,
  OCTAVES,
} from "@/lib/wobble/constants";

/**
 * The shared, hidden SVG filter registry for the icon-wobble effect (issue
 * #271). Mounted once at the app root, it renders one `<filter>` per distinct
 * lucide icon name; the generated CSS (`app/wobble.generated.css`) points every
 * `svg.lucide-<name>` at its `#wob-<name>` filter.
 *
 * A server component — the markup is fully static and deterministic (seeds are
 * baked at build time), so it's server-rendered with no hydration mismatch and
 * no flash of un-wobbled icons.
 *
 * Filter primitives run in `userSpaceOnUse` space — for a lucide icon, its
 * shared `viewBox="0 0 24 24"` — so a single filter per name reads
 * proportionally the same across every rendered icon size. `data-base-seed`
 * lets the boil driver (`lib/wobble/boil.ts`) restore the resting seed on
 * hover-out.
 */
export function WobbleFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {WOBBLE_ICONS.map(({ name, seed }) => (
          <filter
            key={name}
            id={`wob-${name}`}
            primitiveUnits="userSpaceOnUse"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency={BASE_FREQUENCY}
              numOctaves={OCTAVES}
              seed={seed}
              data-base-seed={seed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={DISPLACEMENT_SCALE}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { LOGO_VIEWBOX, LogoPaths } from "./logo-paths";

/**
 * The Arkaik wordmark with a continuous hand-drawn "boil" — the same
 * `feTurbulence → feDisplacementMap` trick used for the lucide icons
 * (`docs/icon-wobble.md`), but tuned for the logo's large `viewBox="0 0 1080
 * 216"` fill glyphs instead of a 24-unit stroke icon.
 *
 * The boil is driven by a declarative SMIL `<animate>` on the turbulence
 * `seed`, *not* a JS interval. This matters for a continuous, no-interaction
 * boil for two reasons the icon driver doesn't hit (it only ever boils while
 * you're hovering, i.e. moving the cursor):
 *   1. A bare `setAttribute("seed", …)` doesn't reliably invalidate an SVG
 *      filter for repaint — the browser only repaints when something else does
 *      (e.g. cursor movement), so an idle JS boil visibly stalls. SMIL drives
 *      the repaint every frame regardless of interaction.
 *   2. A JS-mutated attribute drifts from React's virtual DOM and trips a
 *      hydration/Fast-Refresh mismatch. SMIL keeps the markup deterministic.
 *
 * `calcMode="discrete"` swaps between whole-integer seeds — each an unrelated
 * noise field — which is exactly the frame-swap "on twos/threes" look of a
 * hand-drawn boil. Under `prefers-reduced-motion: reduce` we `pauseAnimations()`
 * the SVG timeline, freezing the resting distorted shape (no motion, still
 * hand-drawn).
 *
 * ── Tuning (all in the shared 1080×216 viewBox space) ──────────────────────
 * Iterate on these live; they need no rebuild.
 */

/** Turbulence base frequency, in cycles per viewBox unit. Lower = longer, more
 *  confident bends; higher = finer, jitterier grain. */
const BASE_FREQUENCY = 0.01;

/** Displacement amplitude, in viewBox units (edges shift up to ±SCALE/2). */
const DISPLACEMENT_SCALE = 20;

/** Octaves of noise. 1 = one clean bend; higher adds surface roughness. */
const OCTAVES = 1;

/** Frame swaps per second — the "on twos/threes" feel of a hand-drawn boil. */
const BOIL_FPS = 4;

/** Distinct noise fields cycled while boiling. Each seed is an unrelated field,
 *  so swapping between them is what produces the boil. */
const BOIL_SEEDS = [0, 1, 2, 3];

const FILTER_ID = "arkaik-logo-boil";

/** SMIL `values` list + `dur` derived from the tuning above. `discrete` holds
 *  each seed for `dur / BOIL_SEEDS.length`, i.e. one frame at BOIL_FPS. */
const BOIL_VALUES = BOIL_SEEDS.join(";");
const BOIL_DUR = `${(BOIL_SEEDS.length / BOIL_FPS).toFixed(4)}s`;

export function ArkaikLogoBoil({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      // pauseAnimations() freezes the SVG timeline (the only animation here is
      // the boil), leaving the static hand-drawn distortion in place.
      if (reduce.matches) svg.pauseAnimations();
      else svg.unpauseAnimations();
    };

    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={LOGO_VIEWBOX}
      role="img"
      aria-label="Arkaik"
      className={cn("w-full overflow-visible text-primary", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter
          id={FILTER_ID}
          primitiveUnits="userSpaceOnUse"
          x="-10%"
          y="-30%"
          width="120%"
          height="160%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={BASE_FREQUENCY}
            numOctaves={OCTAVES}
            seed={BOIL_SEEDS[0]}
            result="noise"
          >
            <animate
              attributeName="seed"
              values={BOIL_VALUES}
              dur={BOIL_DUR}
              calcMode="discrete"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={DISPLACEMENT_SCALE}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#${FILTER_ID})`}>
        <LogoPaths />
      </g>
    </svg>
  );
}

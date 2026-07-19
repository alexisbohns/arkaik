"use client";

/**
 * Home page ASCII "ridged mountains" background (issue #280) — a port of
 * ComputerK's CodePen (https://codepen.io/ComputerK/pen/jENaeKp) from p5.js
 * to a hand-rolled Canvas2D loop, matching how the rest of the app's
 * continuous animation (`ArkaikLogoBoil`, the wobble system) avoids
 * creative-coding/animation library dependencies.
 *
 * A grid of monospace ASCII characters is shaded by 4-octave ridged Perlin
 * noise (see `lib/background/perlin.ts`), which folds/cubes the noise field
 * into vein-like ridges that read as flowing terrain. The noise field pans
 * a little every rendered frame for a slow, living drift. Color is the
 * app's theme `--foreground` at a low, brightness-modulated alpha, so it
 * reads as a subtle backdrop in both light and dark mode rather than the
 * pen's stark white-on-black terminal look.
 */

import { useEffect, useRef } from "react";

import { perlin2 } from "@/lib/background/perlin";
import {
  AMP_MULTIPLIER,
  ASCII_CHARS,
  BRIGHTNESS_THRESHOLD,
  CHAR_SIZE,
  EDGE_DISTANCE,
  FRAME_RATE,
  FREQ_MULTIPLIER,
  MAX_OPACITY,
  NOISE_PAN_SPEED,
  NOISE_SCALE,
  OCTAVE_NUM,
} from "@/lib/background/constants";

const FREQUENCIES = Array.from({ length: OCTAVE_NUM }, (_, i) => FREQ_MULTIPLIER ** i);
const AMPLITUDES = Array.from({ length: OCTAVE_NUM }, (_, i) => AMP_MULTIPLIER ** i);
const MAX_NOISE_VAL = AMPLITUDES.reduce((sum, amp) => sum + amp, 0);
const FRAME_INTERVAL_MS = 1000 / FRAME_RATE;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
}

/** Ridged noise: folds/cubes a smooth field into vein-like ridges. */
function getRidgedNoise(x: number, y: number, offsetX: number, offsetY: number): number {
  let noiseVal = 0;
  for (let i = 0; i < OCTAVE_NUM; i++) {
    const frequency = FREQUENCIES[i];
    const amplitude = AMPLITUDES[i];
    const raw = perlin2(
      x * frequency * NOISE_SCALE + offsetX,
      y * frequency * NOISE_SCALE + offsetY,
    );
    const p01 = clamp((raw + 1) / 2, 0, 1);
    let n = 1 - Math.abs(p01);
    n = 1 - Math.abs(n * 2 - 1);
    n = n * n * n;
    noiseVal += n * amplitude;
  }
  return noiseVal / MAX_NOISE_VAL;
}

/** Parses this app's `H S% L%` custom-property triples into `[r, g, b]`. */
function hslTripleToRgb(triple: string): [number, number, number] {
  const [h, s, l] = triple
    .trim()
    .split(/\s+/)
    .map((part) => parseFloat(part));
  const sFrac = (s || 0) / 100;
  const lFrac = (l || 0) / 100;

  if (sFrac === 0) {
    const gray = Math.round(lFrac * 255);
    return [gray, gray, gray];
  }

  const q = lFrac < 0.5 ? lFrac * (1 + sFrac) : lFrac + sFrac - lFrac * sFrac;
  const p = 2 * lFrac - q;
  const hueToRgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hFrac = (h || 0) / 360;
  return [
    Math.round(hueToRgb(hFrac + 1 / 3) * 255),
    Math.round(hueToRgb(hFrac) * 255),
    Math.round(hueToRgb(hFrac - 1 / 3) * 255),
  ];
}

export function AsciiTerrainBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fontFamily = `${getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim() || "ui-monospace"}, monospace`;

    let cols = 0;
    let rows = 0;
    let noiseCache = new Float32Array(0);
    let fadeCache = new Float32Array(0);
    let offsetX = 0;
    let offsetY = 0;
    let rgb: [number, number, number] = [0, 0, 0];
    let rafId = 0;
    let lastFrameTime = 0;
    let resizePending = false;
    let reduced = false;
    let lastCssWidth = -1;
    let lastCssHeight = -1;

    const readColor = () => {
      rgb = hslTripleToRgb(getComputedStyle(document.documentElement).getPropertyValue("--foreground"));
    };

    const setupContext = () => {
      ctx.font = `${CHAR_SIZE}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    };

    const updateNoiseCache = () => {
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          noiseCache[col * rows + row] = getRidgedNoise(col, row, offsetX, offsetY);
        }
      }
    };

    const render = () => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const half = CHAR_SIZE / 2;
      let currentAlpha = -1;
      const [r, g, b] = rgb;

      for (let col = 0; col < cols; col++) {
        const x = col * CHAR_SIZE + half;
        for (let row = 0; row < rows; row++) {
          const index = col * rows + row;
          const fadeFactor = fadeCache[index];
          if (fadeFactor < BRIGHTNESS_THRESHOLD) continue;

          let noiseVal = clamp(mapRange(noiseCache[index], 0, 1, -0.2, 1.2), 0, 1);
          noiseVal = Math.pow(noiseVal, 1.5);
          const alpha = Math.pow(noiseVal, 0.8) * MAX_OPACITY * fadeFactor;

          if (Math.abs(alpha - currentAlpha) > 1 / 255) {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
            currentAlpha = alpha;
          }

          const charIndex = Math.floor(mapRange(noiseVal, 0, 1, 0, ASCII_CHARS.length - 0.01));
          const y = row * CHAR_SIZE + half;
          ctx.fillText(ASCII_CHARS[charIndex], x, y);
        }
      }
    };

    const frame = (time: number) => {
      rafId = requestAnimationFrame(frame);
      if (time - lastFrameTime < FRAME_INTERVAL_MS) return;
      lastFrameTime = time;

      updateNoiseCache();
      render();
      offsetX += NOISE_PAN_SPEED;
      offsetY += NOISE_PAN_SPEED;
    };

    const start = () => {
      cancelAnimationFrame(rafId);
      if (reduced) {
        updateNoiseCache();
        render();
      } else {
        lastFrameTime = 0;
        rafId = requestAnimationFrame(frame);
      }
    };

    // Setting canvas.width/height always clears the bitmap, even to the same
    // value — guard on an actual size change so the animation loop's own
    // repaint (or, under reduced motion, an explicit re-render below) is the
    // only thing that ever touches pixels once sized.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = Math.max(1, Math.round(canvas.clientWidth));
      const cssHeight = Math.max(1, Math.round(canvas.clientHeight));
      if (cssWidth === lastCssWidth && cssHeight === lastCssHeight) return;
      lastCssWidth = cssWidth;
      lastCssHeight = cssHeight;

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupContext();

      cols = Math.floor(cssWidth / CHAR_SIZE);
      rows = Math.floor(cssHeight / CHAR_SIZE);
      noiseCache = new Float32Array(cols * rows);
      fadeCache = new Float32Array(cols * rows);

      const half = CHAR_SIZE / 2;
      for (let col = 0; col < cols; col++) {
        const x = col * CHAR_SIZE + half;
        const fadeX = clamp(Math.min(x, cssWidth - x) / EDGE_DISTANCE, 0, 1);
        for (let row = 0; row < rows; row++) {
          const y = row * CHAR_SIZE + half;
          const fadeY = clamp(Math.min(y, cssHeight - y) / EDGE_DISTANCE, 0, 1);
          fadeCache[col * rows + row] = fadeX * fadeY;
        }
      }

      // The animation loop repaints on its own next tick; under reduced
      // motion nothing else will, so re-render the static frame now.
      if (reduced) {
        updateNoiseCache();
        render();
      }
    };

    const scheduleResize = () => {
      if (resizePending) return;
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        resize();
      });
    };

    readColor();
    resize();

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyReducedMotion = () => {
      reduced = reducedMotionQuery.matches;
      start();
    };
    applyReducedMotion();
    reducedMotionQuery.addEventListener("change", applyReducedMotion);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      reducedMotionQuery.removeEventListener("change", applyReducedMotion);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
    />
  );
}

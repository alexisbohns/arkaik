"use client";

import { PaletteIcon } from "lucide-react";
import { useState } from "react";

import {
  M3_DEFAULT_FONT,
  M3_FONT_OPTIONS,
  type M3FontId,
} from "@/components/arkademy/m3-font-options";
import { M3_DEFAULT_SCHEME, M3_SCHEMES, type M3SchemeId } from "@/components/arkademy/m3-schemes";

/**
 * PREVIEW ONLY — a tool for reviewing, not a feature: a floating panel, bottom
 * right, that swaps the cover's whole M3 scheme (light and dark) and the face
 * of its display, headline and title roles, live. Each choice is kept in the
 * URL (`?scheme=`, `?font=`, combined) so a link shows the same thing; the
 * page reads both on the server, so a shared link renders right from the
 * first paint.
 *
 * It sets `data-scheme` / `data-font` on the cover's `[data-m3]` wrapper (the
 * stylesheet keys the roles and the faces' tuning on them) and rewrites the
 * URL in place, with no navigation. A native <details> and radio inputs:
 * keyboard and screen readers get the platform's own behavior.
 */
export function SchemePicker({ initial, initialFont }: { initial: M3SchemeId; initialFont: M3FontId }) {
  const [scheme, setScheme] = useState<M3SchemeId>(initial);
  const [font, setFont] = useState<M3FontId>(initialFont);
  const currentScheme = M3_SCHEMES.find((option) => option.id === scheme) ?? M3_SCHEMES[0];
  const currentFont = M3_FONT_OPTIONS.find((option) => option.id === font) ?? M3_FONT_OPTIONS[0];

  /** Sets (or, for the default, clears) one attribute on the wrapper and its URL parameter. */
  const apply = (name: "scheme" | "font", value: string, fallback: string) => {
    const wrapper = document.querySelector<HTMLElement>("[data-m3]");
    const url = new URL(window.location.href);
    if (value === fallback) {
      wrapper?.removeAttribute(`data-${name}`);
      url.searchParams.delete(name);
    } else {
      wrapper?.setAttribute(`data-${name}`, value);
      url.searchParams.set(name, value);
    }
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <details className="mx-picker fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
      <summary className="mx-picker-button">
        <PaletteIcon aria-hidden="true" />
        <span className="mx-picker-tag">Preview</span>
        <span className="truncate">
          {currentScheme.label} · {currentFont.label}
        </span>
      </summary>
      <div className="mx-picker-panel">
        <div role="radiogroup" aria-labelledby="mx-picker-scheme" className="flex flex-col gap-0.5">
          <p id="mx-picker-scheme" className="mx-label-l px-3 pb-1 text-(--md-on-surface-variant)">
            Color scheme · seed and M3 variant
          </p>
          {M3_SCHEMES.map((option) => (
            <label key={option.id} className="mx-picker-option">
              <input
                type="radio"
                name="m3-scheme"
                value={option.id}
                checked={option.id === scheme}
                onChange={() => {
                  setScheme(option.id);
                  apply("scheme", option.id, M3_DEFAULT_SCHEME);
                }}
              />
              <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
                {option.swatch.map((color, i) => (
                  <span
                    key={i}
                    className="size-5 rounded-full ring-2 ring-(--md-surface-container-high)"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="mx-numeral text-[11px] text-(--md-on-surface-variant)">{option.seed}</span>
            </label>
          ))}
        </div>
        <div role="radiogroup" aria-labelledby="mx-picker-font" className="mt-3 flex flex-col gap-0.5">
          <p id="mx-picker-font" className="mx-label-l px-3 pb-1 text-(--md-on-surface-variant)">
            Display face · headings and titles
          </p>
          <div className="grid grid-cols-2 gap-0.5">
            {M3_FONT_OPTIONS.map((option) => (
              <label key={option.id} className="mx-picker-option mx-picker-option--compact">
                <input
                  type="radio"
                  name="m3-font"
                  value={option.id}
                  checked={option.id === font}
                  onChange={() => {
                    setFont(option.id);
                    apply("font", option.id, M3_DEFAULT_FONT);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

"use client";

import { useId, useRef, type CSSProperties } from "react";
import { PyramidIcon, RouteIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStonePreferences } from "@/lib/hooks/useStonePreferences";
import { RADIUS_MAX, RADIUS_MIN, isDefaultStonePreferences } from "@/lib/stones/preferences";
import { STONES, type StoneEntry, type StoneSide } from "@/lib/stones/stones-registry.generated";
import { cn } from "@/lib/utils";

const swatch = (s: StoneEntry): CSSProperties => ({
  background: `url("/stones/${s.id}.svg") 0 0 / ${s.size}px ${s.size}px, ${s.base}`,
});

function StoneChoices({ side, value, onChange }: { side: StoneSide; value: string; onChange: (id: string) => void }) {
  const label = side === "light" ? "Light stone" : "Dark stone";
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      {STONES.filter((s) => s.side === side).map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border bg-background pl-1.5 pr-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === s.id && "border-foreground text-foreground",
          )}
        >
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]" style={swatch(s)} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

/**
 * One theme's roles, forced on a subtree by `.stone-scope-light|dark`. The
 * icon gradient is local to the pane: a gradient's stops resolve where the
 * gradient is defined, so the shared `#stone-icon` would show the current
 * theme's tone in both panes.
 */
function PreviewPane({ mode }: { mode: "light" | "dark" }) {
  const gradientId = `stone-icon-preview-${mode}-${useId().replace(/:/g, "")}`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border p-3",
        mode === "light"
          ? "stone-scope-light border-zinc-200 bg-white text-zinc-950"
          : "stone-scope-dark border-zinc-800 bg-zinc-900 text-zinc-50",
      )}
      style={{ "--stone-icon-paint": `url(#${gradientId})` } as CSSProperties}
    >
      <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="8" y2="24">
          <stop offset="0" style={{ stopColor: "var(--stone-icon-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stone-icon-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--stone-icon-3)" }} />
        </linearGradient>
      </svg>
      <span className="w-full font-mono text-[10px] uppercase tracking-wider opacity-60">{mode}</span>
      <Button type="button" size="sm" variant="stone">
        <SparklesIcon />
        Primary
      </Button>
      <Button type="button" size="sm" variant="stone-secondary">
        <RouteIcon />
        Secondary
      </Button>
      <div
        data-sidebar="menu-button"
        data-active="true"
        className="flex h-8 items-center gap-2 rounded-[min(var(--stone-radius),15px)] px-2 text-sm font-medium [&>svg]:size-4"
      >
        <PyramidIcon />
        <span>Pyramid</span>
      </div>
    </div>
  );
}

/**
 * The reader's stones: which light and dark stone Arkaik wears, and how round
 * its stone buttons and sidebar rows are. Applies to every project in this
 * browser, which is why it says so — everything else on this page is per project.
 */
export function StonePicker() {
  const { preferences, update, reset } = useStonePreferences();
  const radiusLabel = preferences.radius >= RADIUS_MAX ? "pill" : `${preferences.radius}px`;
  const isDefault = isDefaultStonePreferences(preferences);
  const root = useRef<HTMLDivElement>(null);

  // The Reset link hides itself once the choice is back to the default, and a
  // hidden element cannot hold focus — so hand focus to the light stone that is
  // now selected instead of letting it fall back to <body>.
  const resetAndRefocus = () => {
    reset();
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLButtonElement>('[aria-label="Light stone"] [aria-pressed="true"]')?.focus();
    });
  };

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Stones</p>
          <p className="text-sm text-muted-foreground">
            The material on special actions, the active sidebar row and ticked boxes. The dark stone leads in
            light mode and the light stone in dark mode. Applies to every project in this browser.
          </p>
        </div>
        {/* Hidden, not unmounted, at the default, so the header row keeps its layout. */}
        <button
          type="button"
          onClick={resetAndRefocus}
          aria-hidden={isDefault}
          tabIndex={isDefault ? -1 : undefined}
          className={cn(
            "shrink-0 cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
            isDefault && "invisible",
          )}
        >
          Reset to default
        </button>
      </div>
      <StoneChoices side="light" value={preferences.light} onChange={(light) => update({ light })} />
      <StoneChoices side="dark" value={preferences.dark} onChange={(dark) => update({ dark })} />
      <label className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 text-xs text-muted-foreground">Radius</span>
        <input
          type="range"
          aria-label="Radius"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={1}
          value={preferences.radius}
          aria-valuetext={radiusLabel}
          onChange={(event) => update({ radius: Number(event.target.value) })}
          className="w-40 cursor-pointer accent-foreground"
        />
        <output aria-hidden="true" className="ml-2 font-mono text-xs tabular-nums">{radiusLabel}</output>
      </label>
      <div aria-hidden="true" inert className="grid gap-2 sm:grid-cols-2">
        <PreviewPane mode="light" />
        <PreviewPane mode="dark" />
      </div>
    </div>
  );
}

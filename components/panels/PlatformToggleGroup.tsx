"use client";

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import { cn } from "@/lib/utils";

/**
 * The platform multi-select, built three different ways in three forms before
 * this existed (audit `factorization-6`, `shadcn-9`): `NewNodeForm` drew
 * `rounded-full` pills with a colored dot and a `bg-muted` selected state,
 * `ProductFormDialog` drew `rounded-md border-primary bg-primary/10` boxes,
 * `PromptBuilderForm` drew `rounded-full bg-primary` pills — and each rewrote
 * the add/remove handler.
 *
 * **The chosen treatment is the rounded-full pill with a `bg-primary
 * text-primary-foreground` selected state**, because `SegmentedControl` — the
 * repo's already-sanctioned toggle, for the exclusive-choice case — marks its
 * active option exactly that way. A multi-select toggle sitting next to an
 * exclusive one should not invent a second meaning for "on".
 *
 * Two corrections come with it. The border is now present in **both** states
 * (only the color changes), so a chip no longer shrinks by two pixels and nudges
 * its neighbours when selected. And it has the `focus-visible` ring every other
 * interactive primitive here carries and all three hand-rolled versions lacked —
 * this is a keyboard-reachable control that gave no sign of being focused.
 *
 * **Since the M3 Expressive pass it is a connected button group**, the same
 * one `SegmentedControl` draws (app/m3/controls.css,
 * `data-slot="segmented-control"`): tonal pieces 3px apart with 5px joints,
 * and every chosen platform lifting out into a full, wider pill on the solid
 * fill. Multi-select is the same picture with several pieces lifted. No border
 * in either state any more, so nothing shifts when one is chosen.
 *
 * The colored `PLATFORM_DOT_STYLES` dot from `NewNodeForm` is deliberately not
 * carried over: platform colors are the language of per-node *facts* (the chips
 * in `PlatformList`, a node card's border), and this is a choice editor, where
 * the on/off state is the only thing to read.
 */

interface PlatformToggleGroupProps {
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  /**
   * The menu to offer. Defaults to every configured platform; pass a product's
   * platform list to constrain it. Order follows `PLATFORMS` either way, so the
   * strip never reorders itself.
   */
  options?: readonly PlatformId[];
  /**
   * Floor on the selection — deselecting below it is ignored. `1` is the
   * prompt builder's non-empty rule; the default `0` allows an empty set, which
   * is meaningful for a product ("availability is not tracked").
   */
  minLength?: number;
  /** Accessible name for the group. */
  ariaLabel?: string;
  className?: string;
}

export function PlatformToggleGroup({
  value,
  onChange,
  options,
  minLength = 0,
  ariaLabel = "Platforms",
  className,
}: PlatformToggleGroupProps) {
  const menu = options ? PLATFORMS.filter((platform) => options.includes(platform.id)) : PLATFORMS;

  function toggle(platformId: PlatformId) {
    const selected = value.includes(platformId);
    const next = selected
      ? value.filter((entry) => entry !== platformId)
      : [...value, platformId];
    if (next.length < minLength) return;
    onChange(next);
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn("flex flex-wrap items-center", className)}
    >
      {menu.map((platform) => {
        const selected = value.includes(platform.id);

        return (
          <button
            key={platform.id}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(platform.id)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium whitespace-nowrap outline-none"
          >
            {platform.label}
          </button>
        );
      })}
    </div>
  );
}

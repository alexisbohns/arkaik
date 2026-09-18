"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformStatusMap } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { PLATFORM_ICONS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";

interface PlatformStatusIconsProps {
  /**
   * The chips to draw — the node's **effective** platforms, i.e.
   * `scopedPlatforms(node, scope)`, resolved by the caller, exactly as
   * {@link PlatformList} takes them.
   */
  platforms: PlatformId[];
  platformStatuses?: PlatformStatusMap;
  className?: string;
}

/**
 * Per-platform status in one line: the platform's own glyph, painted the status
 * colour.
 *
 * The same fact `PlatformList` spells out over one labelled row per platform,
 * folded onto a single row. It fuses two marks into one because in a list of
 * acceptances the platform and its status are always read together — "is iOS
 * done?" — and a row that answers it in 16px can sit inside a list item instead
 * of forcing every item into a card.
 *
 * Colour is the *only* channel carrying status here, so every glyph also names
 * its status in `title` and in its accessible label. An unset platform draws at
 * a muted opacity rather than being dropped: the platform is still claimed, and
 * a missing glyph would read as "not on iOS" rather than "nobody has said yet".
 *
 * `PLATFORMS` order, never the node's array order, so two acceptances' rows line
 * up glyph for glyph down the list.
 */
export function PlatformStatusIcons({
  platforms,
  platformStatuses = {},
  className,
}: PlatformStatusIconsProps) {
  if (platforms.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {PLATFORMS.map((platform) => {
        if (!platforms.includes(platform.id)) return null;
        const Icon = PLATFORM_ICONS[platform.id];
        const status = platformStatuses[platform.id];
        const label = status ? STATUS_LABELS[status] : "Unset";
        return (
          // The `title` rides on a wrapping span rather than on the icon: a
          // lucide icon renders its children into an unkeyed array, so a
          // `<title>` element inside one costs a React key warning per glyph.
          <span key={platform.id} title={`${platform.label} — ${label}`} className="inline-flex">
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                status ? STATUS_STYLES[status].badge : "text-muted-foreground/40",
              )}
              aria-label={`${platform.label}: ${label}`}
            />
          </span>
        );
      })}
    </div>
  );
}

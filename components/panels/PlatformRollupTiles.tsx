"use client";

import type { CSSProperties } from "react";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { getPlatformRollupSegments, type PlatformStatusRollup } from "@/lib/utils/platform-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusTone } from "@/components/panels/species-shape";

/**
 * A flow's platform statuses, rolled up from the steps it plays: one tile per
 * platform with a stacked gauge, and the counts said in words beneath it.
 *
 * Read-only by nature — a flow has no status of its own, so there is nothing
 * here to set. Each gauge segment names itself in a tooltip ("Live · 3 of 6 on
 * Web"); the bar itself is hidden from assistive tech because the summary line
 * under it already says the same thing in order.
 *
 * `platforms` is the caller's clamp (`scopedRollupPlatforms`), drawn in
 * `PLATFORMS` order so two flows' tiles line up.
 */
export function PlatformRollupTiles({
  rollup,
  platforms,
}: {
  rollup: PlatformStatusRollup;
  platforms: readonly PlatformId[];
}) {
  const rows = PLATFORMS.filter((platform) => platforms.includes(platform.id)).map(({ id }) => ({
    platform: id,
    segments: getPlatformRollupSegments(rollup, id).filter((segment) => segment.count > 0),
    total: rollup.totals[id] ?? 0,
  }));
  if (rows.length === 0) return null;

  return (
    <ul className="np-rollup-tiles" aria-label="Status by platform, rolled up from the steps">
      {rows.map(({ platform, segments, total }) => {
        const Icon = PLATFORM_ICONS[platform];
        const summary = segments.length
          ? segments.map((segment) => `${segment.count} ${STATUS_LABELS[segment.status].toLowerCase()}`).join(" · ")
          : "No counted statuses yet";
        return (
          <li key={platform}>
            <span className="np-rollup-head">
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="np-rollup-name">{PLATFORM_LABELS[platform]}</span>
              <span className="np-rollup-total">{total > 0 ? `${total} counted` : ""}</span>
            </span>
            <span className="np-rollup-bar" aria-hidden="true">
              {segments.length ? (
                segments.map((segment) => (
                  <Tooltip key={segment.status}>
                    <TooltipTrigger asChild>
                      <span
                        style={
                          { flexGrow: segment.count, "--np-status-tone": statusTone(segment.status) } as CSSProperties
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {STATUS_LABELS[segment.status]} · {segment.count} of {total} on {PLATFORM_LABELS[platform]}
                    </TooltipContent>
                  </Tooltip>
                ))
              ) : (
                <span data-empty />
              )}
            </span>
            <span className="np-rollup-summary">{summary}</span>
          </li>
        );
      })}
    </ul>
  );
}

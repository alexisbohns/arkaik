"use client";

import { useMemo } from "react";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformScreenshotMetaMap } from "@arkaik/schema";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { isScreenshotStale } from "@/lib/utils/screenshot-staleness";

/** A stable array, so the query key does not change identity on every render. */
const STALENESS_EVENT_TYPES = ["node.status_changed", "ref.status_changed", "deliverable.shipped"] as const;

/**
 * The staleness flags `PlatformVariants` captions with, one per platform in
 * the scope's menu, derived from the journal on every read and never stored.
 * Shared by the view's Platforms section and the acceptance's: both carry
 * shots, and the rule (`isScreenshotStale`) is the journal's, not either
 * section's.
 *
 * The journal read is PROJECTED to the three event types the rule consults, so
 * every open panel shares one cached fetch with any other reader of the same
 * projection.
 */
export function useScreenshotStaleness(
  nodeId: string,
  platforms: readonly PlatformId[],
  screenshotMeta: PlatformScreenshotMetaMap,
): Partial<Record<PlatformId, boolean>> {
  const projectId = useProjectId();
  const { journal } = useJournal(projectId, { types: STALENESS_EVENT_TYPES });
  return useMemo(() => {
    const out: Partial<Record<PlatformId, boolean>> = {};
    for (const platform of platforms) {
      out[platform] = isScreenshotStale(screenshotMeta[platform], journal, nodeId, platform);
    }
    return out;
  }, [journal, nodeId, platforms, screenshotMeta]);
}

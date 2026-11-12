"use client";

import { useMemo } from "react";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformScreenshotMetaMap } from "@arkaik/schema";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { isScreenshotStale, STALENESS_EVENT_TYPES } from "@/lib/utils/screenshot-staleness";

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
 *
 * `relatedIds` names, per platform, the other nodes whose moves stale this
 * node's shot — for a view, the covering acceptances that speak to that
 * platform (`stalenessRelatedIds`), which is how a deploy or a merge recorded
 * on an acceptance reaches the view it covers. Omitted, the rule reads the
 * node's own events only, as the acceptance's Platforms section wants. It must
 * be referentially stable (memoised by the caller): it is a memo dependency.
 */
export function useScreenshotStaleness(
  nodeId: string,
  platforms: readonly PlatformId[],
  screenshotMeta: PlatformScreenshotMetaMap,
  relatedIds?: Partial<Record<PlatformId, readonly string[]>>,
): Partial<Record<PlatformId, boolean>> {
  const projectId = useProjectId();
  const { journal } = useJournal(projectId, { types: STALENESS_EVENT_TYPES });
  return useMemo(() => {
    const out: Partial<Record<PlatformId, boolean>> = {};
    for (const platform of platforms) {
      out[platform] = isScreenshotStale(
        screenshotMeta[platform],
        journal,
        nodeId,
        platform,
        relatedIds?.[platform],
      );
    }
    return out;
  }, [journal, nodeId, platforms, relatedIds, screenshotMeta]);
}

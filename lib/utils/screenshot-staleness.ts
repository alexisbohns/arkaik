import {
  resolvePlatformStatus,
  type JournalEvent,
  type Node,
  type PlatformId,
  type PlatformScreenshotMeta,
} from "@arkaik/schema";

/**
 * The journal event types the rule below consults. One stable array, so every
 * reader that projects the journal to it (the panel's hook, the Screens map)
 * shares one query key and so one cached fetch.
 */
export const STALENESS_EVENT_TYPES = ["node.status_changed", "ref.status_changed", "deliverable.shipped"] as const;

/**
 * The events that make a slot's screenshot *possibly* stale (spec 2026-11-01
 * § 5), newest first: the node moved on that platform (or project-wide), or a
 * pull request on it merged, after the shot was taken, or a deliverable naming
 * it shipped. Derived from the journal on every read and never stored — a
 * derived flag costs nothing to be wrong about and nothing to repair.
 *
 * `relatedIds` widens "the node" to nodes whose events speak for it under the
 * same three rules: a view's covering acceptances, since the deploy door and
 * the GitHub App move the acceptance and never the view
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md F4). Omitted or
 * empty, the answer is exactly the node's own.
 *
 * Merge signals: in hosted mode the GitHub App mirrors a merge by patching
 * `metadata.refs` in place (no `ref.status_changed` is derived) and emits
 * `deliverable.shipped` on merge; `ref.status_changed` stays as the repo-mode
 * (`arkaik sync`) signal. A shot with no meta (a legacy slot) is never flagged.
 */
export function staleReasons(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
  relatedIds: readonly string[] = [],
): JournalEvent[] {
  const since = meta?.ts;
  if (!since) return [];
  const ids = new Set<string>([nodeId, ...relatedIds]);
  const reasons = events.filter((ev) => {
    // Lexicographic like `orderEvents`: safe because every writer emits
    // `toISOString()` (UTC, Z-suffixed); a caller-supplied `op.ts` must keep that form.
    if (typeof ev.ts !== "string" || ev.ts <= since) return false;
    if (ev.type === "deliverable.shipped") {
      return (
        Array.isArray(ev.node_ids) &&
        ev.node_ids.some((id) => typeof id === "string" && ids.has(id)) &&
        (ev.platform === undefined || ev.platform === platform)
      );
    }
    if (typeof ev.node_id !== "string" || !ids.has(ev.node_id)) return false;
    if (ev.type === "node.status_changed") return ev.platform === undefined || ev.platform === platform;
    if (ev.type === "ref.status_changed") return ev.to === "merged";
    return false;
  });
  return reasons.sort((a, b) => (a.ts === b.ts ? compareDesc(a.id, b.id) : compareDesc(a.ts, b.ts)));
}

/** Whether a slot's screenshot may be stale: {@link staleReasons} found any. */
export function isScreenshotStale(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
  relatedIds?: readonly string[],
): boolean {
  return staleReasons(meta, events, nodeId, platform, relatedIds).length > 0;
}

/**
 * The related ids for a view's shot on `platform`: the covering acceptances
 * that speak to the platform (`resolvePlatformStatus` is defined), in input
 * order. Callers get `covering` from `acceptancesCovering` (or an index built
 * the same way), so the wall and the panel pick the same acceptances.
 */
export function stalenessRelatedIds(
  covering: readonly Pick<Node, "id" | "status" | "platforms" | "metadata">[],
  platform: PlatformId,
): string[] {
  return covering.filter((ac) => resolvePlatformStatus(ac, platform) !== undefined).map((ac) => ac.id);
}

function compareDesc(left: string, right: string): number {
  return left < right ? 1 : left > right ? -1 : 0;
}

import type { JournalEvent, PlatformId, PlatformScreenshotMeta } from "@arkaik/schema";

/**
 * Whether a slot's screenshot *may* be stale (spec 2026-11-01 § 5): the node
 * moved on that platform (or project-wide), or a pull request on it merged,
 * after the shot was taken. Derived from the journal on every read and never
 * stored — a derived flag costs nothing to be wrong about and nothing to
 * repair. A shot with no meta (a legacy slot) is never flagged.
 */
export function isScreenshotStale(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
): boolean {
  const since = meta?.ts;
  if (!since) return false;
  return events.some((ev) => {
    if (ev.node_id !== nodeId || typeof ev.ts !== "string" || ev.ts <= since) return false;
    if (ev.type === "node.status_changed") return ev.platform === undefined || ev.platform === platform;
    if (ev.type === "ref.status_changed") return ev.to === "merged";
    return false;
  });
}

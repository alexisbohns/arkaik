import type { JournalEvent, PlatformId, PlatformScreenshotMeta } from "@arkaik/schema";

/**
 * Whether a slot's screenshot *may* be stale (spec 2026-11-01 § 5): the node
 * moved on that platform (or project-wide), or a pull request on it merged,
 * after the shot was taken, or a deliverable naming it shipped. Derived from the journal on every read and never
 * stored — a derived flag costs nothing to be wrong about and nothing to
 * repair.
 *
 * Merge signals: in hosted mode the GitHub App mirrors a merge by patching
 * `metadata.refs` in place (no `ref.status_changed` is derived) and emits
 * `deliverable.shipped` on merge; `ref.status_changed` stays as the repo-mode
 * (`arkaik sync`) signal. A shot with no meta (a legacy slot) is never flagged.
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
    // Lexicographic like `orderEvents`: safe because every writer emits
    // `toISOString()` (UTC, Z-suffixed); a caller-supplied `op.ts` must keep that form.
    if (typeof ev.ts !== "string" || ev.ts <= since) return false;
    if (ev.type === "deliverable.shipped") {
      return (
        Array.isArray(ev.node_ids) &&
        ev.node_ids.includes(nodeId) &&
        (ev.platform === undefined || ev.platform === platform)
      );
    }
    if (ev.node_id !== nodeId) return false;
    if (ev.type === "node.status_changed") return ev.platform === undefined || ev.platform === platform;
    if (ev.type === "ref.status_changed") return ev.to === "merged";
    return false;
  });
}

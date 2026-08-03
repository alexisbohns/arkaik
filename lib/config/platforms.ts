import type { PlatformId } from "@arkaik/schema";

export const PLATFORMS = [
  { id: "web",     label: "Web",     icon: "Monitor" },
  { id: "ios",     label: "iOS",     icon: "Apple" },
  { id: "android", label: "Android", icon: "Bot" },
] as const satisfies readonly { id: PlatformId; label: string; icon: string }[];

/**
 * The human label for a platform id, **taking `unknown`**.
 *
 * `PLATFORM_LABELS` (components/graph/nodes/node-styles.ts) already answers this
 * for a value the compiler knows is a `PlatformId`, and its four importers are
 * right to use it. This exists for the other case, which products introduced:
 * a platform id read out of `project.metadata.products[].platforms` or a node's
 * own array is `unknown` at runtime whatever the type says — bundles are
 * hand-edited and agent-edited, and `resolveProducts` is lenient by contract —
 * so a total `Record<PlatformId, string>` cannot be indexed by it without a cast
 * that asserts the very thing in doubt.
 *
 * An unrecognised id is echoed back rather than blanked or dropped: the same
 * reading `platformCountLabel` and `productLabels` take, because showing the
 * junk is what tells the author their bundle says something this build does not
 * understand. `undefined` in a label slot tells them nothing.
 */
export function platformLabel(platform: unknown): string {
  return PLATFORMS.find((entry) => entry.id === platform)?.label ?? String(platform);
}

export type { PlatformId };
/** @deprecated Use PlatformId */
export type Platform = PlatformId;

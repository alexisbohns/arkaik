/**
 * What a panel in the project stack can be.
 *
 * The stack was built for nodes, and nodes are still what the URL addresses.
 * Raw is the exception that proves the shape: a tool rather than a location, so
 * it rides in the same stack without an address and without being subject to
 * the node lifecycle — a node prune must not evict it, and it must never be
 * what `?node=` names.
 *
 * One invariant holds it together: a node entry's `key` *is* its node id. What
 * `topNodeKey` returns goes into the URL and comes back through
 * `reconcileArrival`, which matches on `key` — so a key that drifted from the
 * payload's `nodeId` would push an address the stack cannot find its way back
 * to.
 */

import type { PlatformId } from "@/lib/config/platforms";
import type { PanelEntry } from "@/lib/utils/panel-stack";

/**
 * The entry key of the raw-bundle panel. There is at most one, ever.
 *
 * Sharing the key namespace with node ids is safe because node ids always carry
 * a species prefix (`V-`, `AC-`, …), enforced at import, so a bare word can
 * never be one — otherwise a node keyed `raw` would let `openFrom` refresh a
 * node panel into the Raw panel, and `?node=raw` would make `reconcileArrival`
 * unwind to a tool as if it were a location.
 */
export const RAW_PANEL_KEY = "raw";

export interface NodePanelDescriptor {
  kind: "node";
  nodeId: string;
  /** Platform tab the variants section opens on — the Delivery board's column. */
  initialPlatform?: PlatformId;
}

export type PanelDescriptor = NodePanelDescriptor | { kind: "raw" };

export type ProjectPanelEntry = PanelEntry<PanelDescriptor>;

export function isNodeEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<NodePanelDescriptor> {
  return entry.payload.kind === "node";
}

/**
 * The node the URL addresses: the topmost *node* entry, scanning past anything
 * above it. A Raw panel opened over a node panel leaves the address alone.
 */
export function topNodeKey(entries: ProjectPanelEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (isNodeEntry(entry)) return entry.key;
  }

  return null;
}

/** A crumb before it knows how to navigate: what to show, and where it goes. */
export interface PanelCrumbSpec {
  label: string;
  /** Stable React key — the entry's `instanceId`, or `"root"` for the surface. */
  id: string;
  /** Depth to unwind to, or `null` for the last crumb: you are already there. */
  depth: number | null;
}

/**
 * The panel trail as labels and depths. Pure so the depth mapping — the part
 * that silently rots when panels change shape — is testable without React.
 */
export function buildPanelCrumbs(
  entries: ProjectPanelEntry[],
  rootLabel: string,
  titleOf: (nodeId: string) => string | undefined,
): PanelCrumbSpec[] {
  if (entries.length === 0) return [];

  return [
    { label: rootLabel, id: "root", depth: 0 },
    ...entries.map((entry, index) => ({
      label: entry.key === RAW_PANEL_KEY ? "Raw bundle" : titleOf(entry.key) ?? entry.key,
      id: entry.instanceId,
      depth: index === entries.length - 1 ? null : index + 1,
    })),
  ];
}

/**
 * The panels an unwind to `depth` destroys, top-down.
 *
 * `unwindTo` truncates a suffix, so it takes every panel from `depth` upward —
 * not just the one at `depth`. Ordered highest-first because a panel that
 * refuses to close raises a confirm, and that confirm should belong to
 * something the user can see rather than a column buried two deep.
 */
export function unwindDoomed(depth: number, total: number): number[] {
  const doomed: number[] = [];
  for (let index = total - 1; index >= depth; index -= 1) doomed.push(index);
  return doomed;
}

/**
 * Drop node panels whose node no longer exists — deleted out from under the
 * stack. Non-node panels are not subject to the node lifecycle and always
 * survive. Returns the same array when nothing changed, so callers can set
 * state unconditionally without looping.
 */
export function pruneNodeEntries(
  entries: ProjectPanelEntry[],
  existingNodeIds: Set<string>,
): ProjectPanelEntry[] {
  const next = entries.filter((entry) => !isNodeEntry(entry) || existingNodeIds.has(entry.key));
  return next.length === entries.length ? entries : next;
}

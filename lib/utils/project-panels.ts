/**
 * What a panel in the project stack can be.
 *
 * The stack was built for nodes, and nodes are still what the URL addresses.
 * Raw is the exception that proves the shape: a tool rather than a location, so
 * it rides in the same stack without an address and without being subject to
 * the node lifecycle — a node prune must not evict it, and it must never be
 * what `?node=` names. A criterion panel is the second such exception, for the
 * neighbouring reason: it shows library content, identical in every project
 * that pins the same pack, so it is not a location in *this* graph either. The
 * Quality page addresses it with `?criterion=`, which is a param that page owns
 * — the stack still has exactly one address, and it is still `?node=`.
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

/**
 * A criterion panel's key.
 *
 * Namespaced rather than bare, unlike `RAW_PANEL_KEY`, which can afford to be a
 * bare word only because node ids always carry a species prefix. Criterion ids
 * carry a *domain* prefix — `SEC-01`, `A11Y-03`, and a project's own `X-01` —
 * and nothing stops a future pack, or a project's overlay, from choosing a
 * domain code that collides with a species. The namespace removes the question
 * instead of relying on the answer staying true.
 *
 * The surface rides in the key so the same criterion opens as two panels on two
 * surfaces — the evidence and the findings differ per surface, so those are two
 * subjects — while re-opening it on the same surface refreshes in place.
 */
export function criterionPanelKey(criterionId: string, surface?: string): string {
  return `criterion:${criterionId}@${surface ?? ""}`;
}

export interface NodePanelDescriptor {
  kind: "node";
  nodeId: string;
  /** Platform tab the variants section opens on — the Delivery board's column. */
  initialPlatform?: PlatformId;
}

/**
 * A criterion's detail. Addressless in the stack for the reason stated at the
 * top of this file: it is library content, not a location in this graph.
 */
export interface CriterionPanelDescriptor {
  kind: "criterion";
  criterionId: string;
  /** The surface whose assessment and findings the panel shows, when opened from a cell. */
  surface?: string;
}

export type PanelDescriptor =
  | NodePanelDescriptor
  | CriterionPanelDescriptor
  | { kind: "raw" };

export type ProjectPanelEntry = PanelEntry<PanelDescriptor>;

export function isNodeEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<NodePanelDescriptor> {
  return entry.payload.kind === "node";
}

export function isCriterionEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<CriterionPanelDescriptor> {
  return entry.payload.kind === "criterion";
}

/**
 * The node the URL addresses: the topmost *node* entry, scanning past anything
 * above it. A Raw or criterion panel opened over a node panel leaves the
 * address alone — which is why neither needed a line here when it was added.
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
      // Only a node entry's key is a node id, so only a node entry can be put
      // to `titleOf`. A criterion falling through to it would read as its whole
      // namespaced key — `criterion:SEC-03@web` in a breadcrumb.
      label:
        entry.key === RAW_PANEL_KEY
          ? "Raw bundle"
          : entry.payload.kind === "criterion"
            ? entry.payload.criterionId
            : titleOf(entry.key) ?? entry.key,
      id: entry.instanceId,
      depth: index === entries.length - 1 ? null : index + 1,
    })),
  ];
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

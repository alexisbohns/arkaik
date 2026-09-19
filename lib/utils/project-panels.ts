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
 * Findings page addresses it with `?criterion=`, which is a param that page
 * owns. A cell panel is the third: a domain crossed with a surface is a
 * *reading* of this project's audit rather than a node in its graph, and the
 * Matrix page addresses it with `?cell=`. A finding panel is the fourth, for
 * the same reason the cell is — a finding is something the audit says about
 * this project, not a node in its graph — and the Findings page addresses it
 * with `?finding=`. The stack still has exactly one address, and it is still
 * `?node=`.
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

/**
 * A matrix cell panel's key — one domain crossed with one surface.
 *
 * Namespaced for exactly `criterionPanelKey`'s reason, and with more cause: a
 * domain code is a short uppercase word a pack chooses freely, so nothing at
 * all stops one from being `raw` or from colliding with a species prefix. The
 * namespace settles it rather than trusting no pack ever picks the wrong word.
 *
 * Both halves ride in the key, so clicking the next card down a gallery
 * refreshes the panel in place while a different domain on the same surface is
 * a different panel — which is what makes the matrix quick to sweep.
 */
export function cellPanelKey(domain: string, surface: string): string {
  return `cell:${domain}@${surface}`;
}

/**
 * A finding panel's key.
 *
 * Namespaced for `criterionPanelKey`'s reason and with the same force: a
 * finding id is project-authored. The pilot writes `F-2026-08-SEC-web-01`, but
 * nothing in the schema stops a project choosing a bare word, so the namespace
 * removes the collision question instead of trusting a convention to hold.
 *
 * The id alone, unlike a criterion's: a finding belongs to exactly one surface
 * already, so there is no second axis to key on.
 */
export function findingPanelKey(findingId: string): string {
  return `finding:${findingId}`;
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

/**
 * One matrix cell: its criteria and its findings. Addressless in the stack for
 * the reason stated at the top of this file — the Matrix page owns `?cell=`.
 */
export interface CellPanelDescriptor {
  kind: "cell";
  /** Domain code, e.g. `SEC`. */
  domain: string;
  /** Surface id, e.g. `web`. */
  surface: string;
}

/**
 * One finding's detail. Addressless in the stack for the reason stated at the
 * top of this file; the Findings page owns `?finding=`.
 */
export interface FindingPanelDescriptor {
  kind: "finding";
  findingId: string;
  /**
   * The finding's title, so the crumb and the close label read as prose rather
   * than as `F-2026-08-SEC-web-01`.
   *
   * The one piece of denormalized display data in this union, against the
   * stack's usual rule of resolving by id so an edit reaches every panel. It is
   * safe here on two counts: findings are read-only in this app — they are
   * written by the CLI and the MCP server — and `openFrom` refreshes an entry's
   * payload whenever the same key lands back in the same slot, so re-opening a
   * finding picks up a new title. The alternative was threading every page's
   * findings through `PageHeader` and `usePanelBreadcrumbs` for the three pages
   * that never open one.
   *
   * May be `""` — see `panelEntryLabel`, which falls back to the id rather than
   * rendering a blank crumb.
   */
  title: string;
}

export type PanelDescriptor =
  | NodePanelDescriptor
  | CriterionPanelDescriptor
  | CellPanelDescriptor
  | FindingPanelDescriptor
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

export function isCellEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<CellPanelDescriptor> {
  return entry.payload.kind === "cell";
}

export function isFindingEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<FindingPanelDescriptor> {
  return entry.payload.kind === "finding";
}

/**
 * The node the URL addresses: the topmost *node* entry, scanning past anything
 * above it. A Raw or criterion panel opened over a node panel leaves the
 * address alone. Neither exception needed a change here when it landed: looking
 * only for node entries excludes them by construction rather than by care.
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
 * What to call one entry: the label the breadcrumb shows, the close button
 * announces, and the collapsed rail prints.
 *
 * One function because those are one question, and they were answered in two
 * places that had already drifted — `buildPanelCrumbs` spotted a raw entry by
 * its key while `ProjectPanels` spotted it by its kind. Branching on `kind`
 * throughout is the honest test: the key/kind equivalence is an invariant the
 * union does not enforce, so a second test of it is a second thing that can rot.
 *
 * Only a node entry's key is a node id, which is why only a node entry is put
 * to `titleOf` — a criterion falling through to it would read as its whole
 * namespaced key, `criterion:SEC-03@web`, in a breadcrumb.
 */
export function panelEntryLabel(
  entry: ProjectPanelEntry,
  titleOf: (nodeId: string) => string | undefined,
): string {
  switch (entry.payload.kind) {
    case "raw":
      return "Raw bundle";
    case "criterion":
      return entry.payload.criterionId;
    case "cell":
      return `${entry.payload.domain} × ${entry.payload.surface}`;
    // A finding carries its own title, and falls back to its id when a caller
    // had none to give: a crumb is never blank.
    case "finding":
      return entry.payload.title === "" ? entry.payload.findingId : entry.payload.title;
    case "node":
      return titleOf(entry.key) ?? entry.key;
  }
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
      label: panelEntryLabel(entry, titleOf),
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

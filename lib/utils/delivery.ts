import type { PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import type { Node } from "@/lib/data/types";
import { getNodePlatformStatuses } from "@/lib/utils/platform-status";
import { nodeInScope, scopedPlatforms, type ProductGraph, type ProductScope } from "@/lib/utils/product-scope";

/**
 * One board item: a node on one platform, at that platform's status
 * (vision.md § Core Product, Delivery). Duplication across platforms is the
 * point — a view `live` on iOS and `prioritized` on Android is two items in
 * two columns.
 */
export interface DeliveryItem {
  node: Node;
  platform: PlatformId;
  status: StatusId;
}

/** Optional inputs. Omitting the object entirely is the unscoped projection. */
export interface DeliveryOptions {
  /**
   * The active product scope. Absent = no scoping at all, byte-for-byte
   * today's board — which is what every caller that has not resolved a
   * `ProjectBundle` yet should pass.
   */
  scope?: ProductScope;
  /**
   * Edges, nodes, and the usage index, so membership is resolved for **every**
   * species rather than the two that store it: an acceptance by its anchors, a
   * data model by its consumers. Without it the board falls back to stored keys,
   * which would put an acceptance in a different product here than on the
   * Acceptances surface. Callers gate on `edgesLoading` before passing it.
   */
  graph?: ProductGraph;
}

/**
 * Expand nodes into (node × platform) delivery items.
 *
 * - Every node yields one item per entry in `node.platforms`; the status comes
 *   from `getNodePlatformStatuses` — the per-platform override for views,
 *   falling back to `node.status` (which is all data models and API endpoints
 *   ever have).
 * - **Flows are excluded** regardless of the species filter: a flow's status
 *   is a computed rollup of its views (lib/utils/platform-status.ts), not a
 *   deliverable of its own — including it would double-count every view.
 *
 * With a `scope`, the board stops lying about its denominators (spec § Decision
 * 3): nodes {@link nodeInScope} rejects drop out, and each survivor expands over
 * {@link scopedPlatforms} instead of its raw `platforms`. That helper intersects
 * against the **node's own product's** menu, looked up in `scope.productsById`,
 * *not* against `scope.platforms` — under All products the latter is the union
 * of every product, so a web-only back-office view would keep contributing to
 * the Android column exactly as it does today. The distinction is the entire
 * fix; `scope.platforms` here is always wrong.
 */
export function computeDeliveryItems(
  nodes: readonly Node[],
  species: readonly SpeciesId[],
  options?: DeliveryOptions,
): DeliveryItem[] {
  const speciesSet = new Set(species);
  const scope = options?.scope;
  const items: DeliveryItem[] = [];

  for (const node of nodes) {
    if (node.species === "flow" || !speciesSet.has(node.species)) continue;
    if (scope !== undefined && !nodeInScope(node, scope, options?.graph)) continue;

    const statuses = getNodePlatformStatuses(node);
    const platforms = scope === undefined ? node.platforms : scopedPlatforms(node, scope);
    for (const platform of platforms) {
      const status = statuses[platform];
      if (status !== undefined) {
        items.push({ node, platform, status });
      }
    }
  }

  return items;
}

/**
 * Group items into status columns. `statuses` fixes the column set and order
 * (items whose status is not listed are dropped — the board's "counted preset
 * vs all statuses" toggle); `platform` narrows to one platform when set.
 * Column contents are sorted by title, then id, for a stable board.
 */
export function groupItemsByStatus(
  items: readonly DeliveryItem[],
  statuses: readonly StatusId[],
  platform?: PlatformId,
): Map<StatusId, DeliveryItem[]> {
  const groups = new Map<StatusId, DeliveryItem[]>(statuses.map((status) => [status, []]));

  for (const item of items) {
    if (platform !== undefined && item.platform !== platform) continue;
    groups.get(item.status)?.push(item);
  }

  for (const column of groups.values()) {
    column.sort(
      (a, b) =>
        a.node.title.localeCompare(b.node.title) ||
        a.node.id.localeCompare(b.node.id) ||
        a.platform.localeCompare(b.platform),
    );
  }

  return groups;
}

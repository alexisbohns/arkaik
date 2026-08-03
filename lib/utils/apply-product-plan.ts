/**
 * The one write in the app that spans both stores.
 *
 * Product definitions live on the project (`updateProject`) and memberships live
 * on nodes (`applyMutations`), so every product edit that touches members is two
 * writes that cannot be made one. Both callers — the delete dialog and the
 * Library's bulk bar — go through here so the ordering below is decided once.
 *
 * Takes its stores as arguments rather than calling hooks, which keeps it a
 * plain async function the test suite can drive with two spies.
 */

import type { Node, NodeMetadata, ProjectMetadata } from "@/lib/data/types";
import { planToOps, type ProductPlan } from "./product-editing";

type UpdateNodeOp = { op: "update_node"; node_id: string; patch: { metadata: NodeMetadata } };

export interface ProductPlanStores {
  /**
   * The same node shape {@link planToOps} reads — `metadata` is what a patch has
   * to carry through, and `species` is what the plan was filtered on, so the map
   * is typed as the rules module's own input rather than as something narrower
   * that would need a cast at the call below.
   */
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "metadata">>;
  projectMetadata: ProjectMetadata | undefined;
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
  applyMutations: (ops: UpdateNodeOp[]) => Promise<unknown>;
}

/**
 * Memberships first, definitions second — and if the second write fails the
 * result is a product that still exists whose members have already moved out of
 * it. That is a *visible* half-state the user can finish by hand.
 *
 * The other order fails worse: deleting the definition first and then losing the
 * membership write leaves nodes pointing at a product nobody declares. Every
 * read surface survives that (a stale key resolves to unassigned), which is
 * precisely the problem — nothing would tell the user it happened.
 *
 * `products: null` means the definitions are untouched, so the project write is
 * skipped entirely rather than saved unchanged.
 *
 * The project write sends `{ ...projectMetadata, products }` built from the
 * caller's **snapshot**, so another `metadata` field changed between that read
 * and this write is reverted to its snapshot value. That is a last-write-wins
 * seam this function cannot close on its own — but it is exactly the shape every
 * other `updateProject` caller has, and `useProject`'s `updateProject`
 * (lib/hooks/useProject.ts) narrows it deliberately: it re-reads the stored
 * bundle and patches project-level fields onto the freshest copy, so concurrent
 * *node and edge* edits survive. Only a concurrent edit to another
 * `project.metadata` key loses, and settings is the one place that writes them.
 */
export async function applyProductPlan(plan: ProductPlan, stores: ProductPlanStores): Promise<void> {
  const ops = planToOps(plan, stores.nodesById);

  if (ops.length > 0) await stores.applyMutations(ops);

  if (plan.products !== null) {
    await stores.updateProject({
      metadata: { ...(stores.projectMetadata ?? {}), products: plan.products },
    });
  }
}

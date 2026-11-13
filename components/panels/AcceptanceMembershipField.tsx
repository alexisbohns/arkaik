"use client";

import type { Node, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { describeProductMembership } from "@/lib/utils/product-membership";
import { ProductPicker } from "@/components/panels/ProductPicker";

interface AcceptanceMembershipFieldProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  /** The surface's product scope — the menu the Product picker offers. */
  scope: ProductScope;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

/**
 * Which product an acceptance belongs to — the intro block's Product field,
 * under Status.
 *
 * Its own component rather than `NodeDetailPanel`'s `ProductSection` because an
 * acceptance's membership is derived from the anchors it covers (§ D5), and the
 * picker has to say so: when it covers anything the trigger shows the
 * **derived** product(s) — the live answer every read surface agrees on — via
 * `displayOverride`, while the select still edits the stored fallback. The
 * rules (derived, stale, unassigned) are `describeProductMembership`'s; this
 * component only lays them out. It is passed to `NodeFields` as the
 * `membership` slot, so it lands in that component's own gutter and column — it
 * must not add either of its own.
 *
 * The control is **always** shown once the project declares products, even
 * when the graph decides the answer: hiding it the moment a `covers` edge
 * appears would make a field materialise and vanish as edges change.
 */
export function AcceptanceMembershipField({
  node,
  allNodes,
  allEdges,
  scope,
  onUpdate,
}: AcceptanceMembershipFieldProps) {
  const membership = describeProductMembership(node, scope, allNodes, allEdges);
  if (!membership) return null;

  return (
    <div>
      <ProductPicker
        products={membership.products}
        value={membership.value}
        onChange={(nextProduct) =>
          void onUpdate(node.id, { metadata: withProductMembership(node.metadata, nextProduct) })
        }
        label={membership.label}
        displayOverride={membership.derived ? { text: membership.displayText } : undefined}
        hint={membership.hint}
      />
    </div>
  );
}

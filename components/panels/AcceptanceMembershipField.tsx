"use client";

import type { Node, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import { productLabels, productsOfAcceptance } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { coveredAnchorsOf } from "@/lib/utils/where-used";
import { productOf } from "@arkaik/schema";
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
 * acceptance's membership is derived from the anchors it covers (§ D5) and that
 * control cannot say so; two pickers on one panel would be two answers to one
 * question. It is passed to `NodeFields` as the `membership` slot, so it lands in
 * that component's own gutter and column — it must not add either of its own.
 */
export function AcceptanceMembershipField({
  node,
  allNodes,
  allEdges,
  scope,
  onUpdate,
}: AcceptanceMembershipFieldProps) {
  if (scope.productsById.size === 0) return null;

  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  // The same derivation `CoversSection` lists, from the same shared helper. The
  // anchors are still needed here — `anchorCount` below is what the Product
  // hint's sentence counts — but the walk is not this file's to own: the section
  // moved out, and a private copy of it left behind would be a second answer to
  // one question, free to drift the day `covers` grows a rule.
  const coveredAnchors = coveredAnchorsOf(node, allNodes, allEdges);

  /* --- Product (§ D5) ------------------------------------------------------
   *
   * The control is **always** shown once the project declares products, but what
   * it displays depends on whether this acceptance covers anything.
   *
   * `productsOfAcceptance` is the authority and is asked rather than
   * re-implemented: anchors govern when there are any, and the stored key is the
   * answer only for an acceptance that covers nothing — the intake case, where a
   * PM files an idea knowing which app it is for long before they know which
   * screens it needs. Reading the stored value first would let a stale key
   * out-vote the graph it is attached to.
   *
   * So when anchors exist the trigger shows the **derived** product(s) — the live
   * answer every read surface already agrees on — via `displayOverride`, while
   * the select still edits and reports the stored fallback. The two rejected
   * alternatives are recorded in the spec: hiding the control the moment a
   * `covers` edge appears makes a field materialise and vanish as edges change,
   * and treating it as a plain editable field lets a user set a value the graph
   * silently ignores.
   *
   * `anchorCount` counts *resolvable* anchors, not `covers` edges, because that
   * is what the derivation counts: a dangling edge to a node this snapshot does
   * not hold is skipped by `productsOfAcceptance`, and a hint promising "the 2
   * nodes it covers" decide the answer when only one of them exists would be
   * telling the reader something false about their own graph.
   */
  const anchorCount = coveredAnchors.length;
  const derivedProducts = productsOfAcceptance(node, allEdges, nodesById);
  // `productLabels`, not an inline sort-and-title: the declaration ordering and
  // the title-falls-back-to-the-id rule are `product-scope`'s to hold, and a
  // second copy here is a copy that drifts. Not `productLabelsOfNode`, which
  // would re-enter `productsOfNode` and demand a `usageIndex` this field has no
  // reason to build for a species that never consults one.
  const derivedLabels = productLabels(derivedProducts, scope).join(", ");
  const anchorNoun = `${anchorCount} node${anchorCount === 1 ? "" : "s"}`;
  /**
   * A stored key naming a product the project no longer declares — the stranded
   * remnant of a rename or a deletion. Only meaningful when nothing is anchored,
   * because with anchors the stored key is inert anyway and the hint already
   * says so.
   */
  const storedProductId = productOf(node);
  const staleProductId =
    anchorCount === 0 && storedProductId !== null && !scope.productsById.has(storedProductId)
      ? storedProductId
      : null;

  return (
    // A `<div>`, not a `<section>`: it heads nothing and names nothing, so
    // as a section it was a grouping the outline could not see and the
    // accessibility tree flattened to a generic box anyway. The panel's
    // real sections all carry an `h3` — see `PanelSection`.
    <div>
      <ProductPicker
        products={[...scope.productsById.values()]}
        value={productOf(node)}
        // `onUpdate` directly rather than the `patchMetadata` spread its
        // sibling `AcceptanceAuthoredFields` uses: unassigning must
        // *remove* the key (`withProductMembership` owns that rule — a stored
        // `product: ""` names a product that cannot exist), and a spread
        // merge can only ever add or overwrite one. The rest of the metadata
        // — gherkin, values, platformStatuses — is carried through by
        // `withProductMembership` itself, which is what `patchMetadata`
        // would otherwise have been here for.
        onChange={(nextProduct) =>
          void onUpdate(node.id, { metadata: withProductMembership(node.metadata, nextProduct) })
        }
        label={anchorCount > 0 ? "Product (from what it covers)" : "Product"}
        // Only when anchored: unanchored, the stored value *is* the answer,
        // and overriding its display with itself would be a lie by ceremony.
        displayOverride={anchorCount > 0 ? { text: derivedLabels || "Unassigned" } : undefined}
        hint={
          anchorCount > 0
            ? derivedLabels
              ? `This acceptance belongs to ${derivedLabels}, taken from the ${anchorNoun} it covers. The value you set here applies only if it stops covering anything.`
              : `The ${anchorNoun} this covers have no product yet, so it appears under All products. The value you set here applies only if it stops covering anything.`
            : staleProductId
              // The stored key names a product the project no longer
              // declares, so the picker degrades its trigger to
              // "Unassigned" — and the id is about to be overwritten the
              // moment the control is touched. Echoing it is the only trace
              // left of the rename or deletion that stranded it, and it is
              // what lets a reader recognise their own product rather than
              // silently accept an unassignment they never asked for. Same
              // sentence `NodeDetailPanel`'s `ProductSection` uses, for the
              // same state.
              ? `Assigned to "${staleProductId}", which this project no longer declares — it appears under All products only.`
              : "This acceptance covers nothing, so its product is whatever you set here."
        }
      />
    </div>
  );
}

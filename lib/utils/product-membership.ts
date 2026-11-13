import type { ProductDefinition } from "@arkaik/schema";
import { productOf } from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import {
  productDisplayTitle,
  productLabels,
  productsOfAcceptance,
  type ProductScope,
} from "@/lib/utils/product-scope";
import { coveredAnchorsOf } from "@/lib/utils/where-used";

/**
 * Which product a node belongs to, as data: what to show, what to explain, and
 * whether it is worth showing at all.
 *
 * The node panel says this in more than one place and more than one shape (a
 * chip in a header, a line under a title, a picker in a form), and every one of
 * them has to agree on the same four subtleties. They were written out inside
 * two components (`ProductSection` for flows and views, `AcceptanceMembershipField`
 * for acceptances); a third rendering would have been a third copy, and the copy
 * most likely to get one of them wrong. So they live here once:
 *
 * 1. **No products, no membership.** A project that declares no products never
 *    hears the word: the answer is `null`, and the caller renders nothing.
 * 2. **Unassigned is a real value, not an absence.** `selected` is null and the
 *    hint says where the node appears instead.
 * 3. **A stale key is displayed, never healed.** A stored id naming a product
 *    the project no longer declares degrades to "Unassigned" in `displayText`,
 *    and the hint echoes the id so a reader can recognise a rename or a deletion.
 *    Writing state as a side effect of rendering would make a half-synced
 *    bundle permanently forget a real assignment.
 * 4. **An acceptance's product is derived from what it covers (§ D5).** When it
 *    covers anything, `displayText` is the derived product(s) and `derived` is
 *    true, while `value` stays the stored fallback, which applies only if it
 *    stops covering anything. `productsOfAcceptance` is asked, never restated.
 *
 * Only flows, views and acceptances carry a membership the panel edits. Data
 * models and API endpoints derive theirs from their consumers, and a stored key
 * on one is a value every read surface ignores (`product-membership-wrong-species`),
 * so they answer `null`. An acceptance needs the graph to derive its answer and
 * answers `null` without one.
 */
export interface ProductMembership {
  products: readonly ProductDefinition[];
  /** Exactly one product declared — the case where offering a choice is noise. */
  single: boolean;
  /** The stored key, which may be stale or null. */
  value: string | null;
  /** The product the stored key resolves to, or null (unassigned or stale). */
  selected: ProductDefinition | null;
  /** What the panel should SAY the product is. */
  displayText: string;
  /** True for an acceptance whose product comes from what it covers. */
  derived: boolean;
  /** The field label: "Product", or "Product (from what it covers)" when derived. */
  label: string;
  /** The explanation, when there is something to explain. */
  hint?: string;
}

export function describeProductMembership(
  node: Node,
  scope: ProductScope,
  allNodes?: readonly Node[],
  allEdges?: readonly Edge[],
): ProductMembership | null {
  if (scope.productsById.size === 0) return null;
  const products = [...scope.productsById.values()];
  const value = productOf(node);
  const selected = products.find((product) => product.id === value) ?? null;
  const base = { products, single: products.length === 1, value, selected };
  const staleHint = (id: string) =>
    `Assigned to "${id}", which this project no longer declares — it appears under All products only.`;

  if (node.species === "flow" || node.species === "view") {
    return {
      ...base,
      displayText: selected ? productDisplayTitle(selected) : "Unassigned",
      derived: false,
      label: "Product",
      // Keyed on whether the membership RESOLVES, not on whether one is stored:
      // a stale key reads "Unassigned" too, and it is the case that most needs
      // the sentence. The two unresolved cases get different sentences because
      // they have different fixes.
      hint: selected
        ? undefined
        : value === null
          ? "Unassigned nodes appear under All products only."
          : staleHint(value),
    };
  }

  if (node.species === "acceptance" && allNodes && allEdges) {
    const nodesById = new Map(allNodes.map((n) => [n.id, n]));
    // Resolvable anchors, not `covers` edges: a dangling edge to a node this
    // snapshot does not hold is skipped by the derivation, so counting it here
    // would promise the reader an anchor that decides nothing.
    const anchorCount = coveredAnchorsOf(node, [...allNodes], [...allEdges]).length;
    if (anchorCount > 0) {
      const derivedLabels = productLabels(productsOfAcceptance(node, [...allEdges], nodesById), scope).join(", ");
      const anchorNoun = `${anchorCount} node${anchorCount === 1 ? "" : "s"}`;
      return {
        ...base,
        displayText: derivedLabels || "Unassigned",
        derived: true,
        label: "Product (from what it covers)",
        hint: derivedLabels
          ? `This acceptance belongs to ${derivedLabels}, taken from the ${anchorNoun} it covers. The value you set here applies only if it stops covering anything.`
          : `The ${anchorNoun} this covers have no product yet, so it appears under All products. The value you set here applies only if it stops covering anything.`,
      };
    }
    return {
      ...base,
      displayText: selected ? productDisplayTitle(selected) : "Unassigned",
      derived: false,
      label: "Product",
      hint:
        value !== null && !selected
          ? staleHint(value)
          : "This acceptance covers nothing, so its product is whatever you set here.",
    };
  }

  return null;
}

/**
 * True when the membership says nothing a reader needs: one product, and the
 * node already in it. Unassigned and stale keys are never quiet — they are the
 * states a reader can act on.
 */
export function isMembershipSettled(membership: ProductMembership): boolean {
  if (!membership.single) return false;
  return membership.derived ? membership.displayText !== "Unassigned" : membership.selected !== null;
}

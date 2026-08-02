/**
 * The rules for *editing* products, as pure functions over plain data.
 *
 * The read side already works this way (lib/utils/product-scope.ts) and this is
 * its mirror: the schema package owns what a product *means*, this module owns
 * what an edit to one *does*, and no component here computes either.
 *
 * Every destructive operation returns a **plan** rather than performing itself.
 * That is not ceremony — a product deletion touches the project's metadata and
 * an arbitrary number of nodes across two different stores, and a plan is the
 * only form of that operation which can be asserted on a machine with no
 * database and no component test runner.
 *
 * Deliberately React-free and provider-free for the same reason.
 */

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { Node, NodeMetadata } from "@/lib/data/types";
import {
  PRODUCT_MEMBERSHIP_SPECIES,
  productOf,
  type ProductDefinition,
} from "@arkaik/schema";

/** The canonical platform order, which every list this module emits follows. */
const PLATFORM_ORDER: readonly PlatformId[] = PLATFORMS.map((platform) => platform.id);

/** The minimum shape this module needs of a node — never the whole thing. */
type NodeLike = Pick<Node, "id" | "species" | "metadata">;

/**
 * Kebab-case, ASCII, no leading or trailing dash. Accents are folded rather
 * than dropped so that "Créateur" becomes "createur" and not "cr-ateur".
 */
export function slugifyProductTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The durable key a product is known by, derived once at create time and never
 * changed afterwards (§ D2).
 *
 * **It can never be blank.** `resolveProducts` treats a blank id as *not a
 * declaration* and drops the entry, so a title of "!!!" slugging to "" would
 * produce a product that the app cannot see and the user cannot delete. The
 * `product` fallback is what keeps that unreachable.
 */
export function deriveProductId(title: string, existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  const base = slugifyProductTitle(title) || "product";
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** What the create/edit dialog collects. The id is derived, never typed. */
export interface ProductDraft {
  id: string;
  title: string;
  description?: string;
  platforms: PlatformId[];
}

/**
 * The draft written into the definitions array — appended when new, replaced in
 * place when it already exists, so declaration order (which is the order the
 * scope selector renders) never shuffles under an edit.
 *
 * The existing definition is **spread first**, which is what preserves
 * `root_node_id`. The manager does not expose the journey anchor (§ D7), so an
 * edit that dropped it would silently un-anchor a product's journey and the user
 * would have no way to tell, let alone put it back.
 */
export function upsertProduct(
  products: readonly ProductDefinition[],
  draft: ProductDraft,
): ProductDefinition[] {
  const existing = products.find((product) => product.id === draft.id);
  const description = draft.description?.trim();

  const next: ProductDefinition = {
    ...(existing ?? {}),
    id: draft.id,
    title: draft.title.trim(),
    platforms: PLATFORM_ORDER.filter((platform) => draft.platforms.includes(platform)),
  };

  if (description) next.description = description;
  else delete next.description;

  if (!existing) return [...products, next];
  return products.map((product) => (product.id === draft.id ? next : product));
}

/** The definitions without this one. Membership is {@link planProductDeletion}'s job. */
export function removeProduct(
  products: readonly ProductDefinition[],
  id: string,
): ProductDefinition[] {
  return products.filter((product) => product.id !== id);
}

/**
 * Nodes whose **stored** `metadata.product` names this product.
 *
 * Stored, never derived, and the distinction matters: an acceptance covering an
 * admin view *reads* as admin everywhere, but its membership is its anchors'
 * and deleting the product cannot orphan a key it never had. Only a stored key
 * can go stale, so only stored keys are what a deletion has to answer for.
 */
export function membersOfProduct<N extends NodeLike>(
  nodes: readonly N[],
  productId: string,
): N[] {
  return nodes.filter((node) => productOf(node) === productId);
}

/** One node's membership changing. `null` means "unassign". */
export interface ProductReassignment {
  nodeId: string;
  product: string | null;
}

/**
 * A complete product edit, computed before anything is written.
 *
 * `products: null` means "the definitions are unchanged" — a bulk move touches
 * memberships only, and passing the unchanged array would make the executor
 * write the project for no reason.
 */
export interface ProductPlan {
  products: ProductDefinition[] | null;
  reassignments: ProductReassignment[];
}

/** Delete a product and say what happens to its members (§ D3). */
export function planProductDeletion(
  products: readonly ProductDefinition[],
  nodes: readonly NodeLike[],
  id: string,
  reassignTo: string | null,
): ProductPlan {
  return {
    products: removeProduct(products, id),
    reassignments: membersOfProduct(nodes, id).map((node) => ({ nodeId: node.id, product: reassignTo })),
  };
}

/**
 * Move the selected nodes into a product, or out of every product (§ D6).
 *
 * Two filters, both load-bearing. Species that **derive** membership are
 * skipped, because writing `metadata.product` on a data model produces a key
 * every read surface ignores and the validator warns about
 * (`product-membership-wrong-species`) — the bulk bar tells the user how many of
 * their selection this drops. Nodes already in the target are skipped so a
 * re-application is a no-op rather than a pile of empty writes.
 */
export function planProductMove(
  nodes: readonly NodeLike[],
  nodeIds: readonly string[],
  productId: string | null,
): ProductPlan {
  const wanted = new Set(nodeIds);
  return {
    products: null,
    reassignments: nodes
      .filter((node) => wanted.has(node.id))
      .filter((node) => PRODUCT_MEMBERSHIP_SPECIES.includes(node.species))
      .filter((node) => productOf(node) !== productId)
      .map((node) => ({ nodeId: node.id, product: productId })),
  };
}

/**
 * This node's metadata with its membership set, or **removed**.
 *
 * Removed rather than blanked: `productOf` reads any string, so `product: ""`
 * would be a membership naming a product that cannot exist, and
 * `resolveProducts` would never match it. Unassigned has to mean *absent*.
 *
 * The rest of the metadata is carried through untouched — `platformStatuses`,
 * notes and screenshots all live in the same object, and a patch that replaced
 * it wholesale would take a view's per-platform statuses with it.
 */
export function withProductMembership(
  metadata: NodeMetadata | undefined,
  product: string | null,
): NodeMetadata {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  if (product === null) delete next.product;
  else next.product = product;
  return next as NodeMetadata;
}

/**
 * A plan's reassignments as mutation ops, so the whole membership half commits
 * as one atomic write (`applyMutations`) rather than as N racing patches.
 *
 * Pure, and here rather than in the executor deliberately: this is where the
 * "preserve the rest of the metadata" rule is actually applied, and it is worth
 * an assertion.
 */
export function planToOps(
  plan: ProductPlan,
  nodesById: ReadonlyMap<string, NodeLike>,
): { op: "update_node"; node_id: string; patch: { metadata: NodeMetadata } }[] {
  return plan.reassignments.map(({ nodeId, product }) => ({
    op: "update_node" as const,
    node_id: nodeId,
    patch: { metadata: withProductMembership(nodesById.get(nodeId)?.metadata, product) },
  }));
}

/**
 * The platforms a node in this product may claim — the containment rule as the
 * node form enforces it (§ D4).
 *
 * Three distinct answers, and the empty one is not an error. A product with
 * `platforms: []` says availability is not a tracked dimension here (a CLI, a
 * public API), so the form shows no platform toggles at all and a single
 * lifecycle status — RFC decision 2, arriving in the editor exactly as it
 * already arrives in the read surfaces. `null` — unassigned, or a project that
 * declares no products — means every platform, which is today's behaviour
 * unchanged.
 *
 * An unrecognised or malformed definition degrades to every platform rather than
 * to none: `resolveProducts` is lenient by contract, and a stored product with
 * no `platforms` array must never leave a user unable to tick anything.
 */
export function platformMenuFor(product: ProductDefinition | null | undefined): PlatformId[] {
  if (!product || !Array.isArray(product.platforms)) return [...PLATFORM_ORDER];
  const menu = new Set<string>(product.platforms as string[]);
  return PLATFORM_ORDER.filter((platform) => menu.has(platform));
}

/** `selected ∩ menu`, canonically ordered — what a product change prunes to. */
export function constrainPlatforms(
  selected: readonly PlatformId[],
  menu: readonly PlatformId[],
): PlatformId[] {
  return PLATFORM_ORDER.filter((platform) => selected.includes(platform) && menu.includes(platform));
}

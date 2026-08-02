/**
 * App-side helpers over the schema's product projections. The schema package
 * owns the semantics (packages/schema/src/products.ts); this module owns the
 * shapes the React surfaces want — chiefly the arity that decides whether a
 * surface renders per-platform or single-status.
 *
 * Every function here takes the product (or a scope carrying it) as an
 * *argument* and never reads scope state. That is what keeps the deferred
 * per-surface-override milestone cheap: an override becomes a different
 * argument, not a different code path.
 */

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { Edge, Node, Project } from "@/lib/data/types";
import {
  effectiveNodePlatforms,
  PRODUCT_MEMBERSHIP_SPECIES,
  productOf,
  productPlatforms,
  productsUsingNode,
  resolveProducts,
  type ProductDefinition,
  type ProductUsageIndex,
} from "@arkaik/schema";

/** Rings-and-aggregate, or one bar. There is no third shape. */
export type PlatformAvailabilityShape = "rings" | "bar";

/**
 * **The arity rule, and the only place its threshold is written**
 * (docs/superpowers/specs/2026-08-02-multi-product-projects-design.md § 3, § 4).
 *
 * Two or more effective platforms earn per-platform chrome: an aggregate plus
 * one ring (or column) per platform. One or zero earn a single bar — and they
 * earn the *same* bar deliberately. At arity 1 the aggregate and the lone
 * platform ring carry identical numbers, so four rings collapse to one, and a
 * lone ring standing beside three-ring cards from another scope reads as *data
 * missing* rather than *absent*. At arity 0 — availability is simply not a
 * tracked dimension for a CLI or a public API — there is nothing that could be
 * missing, so the same bar says so without inventing a third shape.
 *
 * It lives here rather than inside `PlatformAvailability` because no component
 * in this repo can be exercised by a test: as a pure function the product-scope
 * suite can pin the 2-platform boundary, which is the one an off-by-one would
 * break silently across every surface that composes the primitive.
 */
export function platformAvailabilityShape(platforms: readonly PlatformId[]): PlatformAvailabilityShape {
  return platforms.length >= 2 ? "rings" : "bar";
}

/** Everything a surface needs to pick its shape and filter its nodes. */
export interface ProductScope {
  /** `null` = All products. A real member of the domain, not an absence. */
  productId: string | null;
  product: ProductDefinition | null;
  /** The platform menu — the sole input to the arity rule. */
  platforms: PlatformId[];
  /** True when the surface renders per-platform columns/rings — {@link platformAvailabilityShape}. */
  isMultiPlatform: boolean;
  /** Every declared product by id, so per-node lookups cost nothing. */
  productsById: Map<string, ProductDefinition>;
}

/**
 * Products live on `bundle.project.metadata`, so this takes the **bundle** the
 * surfaces already hold (`useProject`) and drills in itself. `ProjectBundle`
 * has no `metadata` of its own; asking every caller to remember that would be
 * one more thing to get wrong at each of the five surfaces.
 */
export function resolveProductScope(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  productId: string | null,
): ProductScope {
  const project = bundle?.project;
  const products = resolveProducts(project);
  const productsById = new Map(products.map((candidate) => [candidate.id, candidate]));
  const product = productId === null ? null : productsById.get(productId) ?? null;
  const platforms = productPlatforms(project, productId);
  // Derived, never re-derived: a second `>= 2` here is a second arity rule
  // waiting to drift from the one the primitive renders.
  const isMultiPlatform = platformAvailabilityShape(platforms) === "rings";
  return { productId, product, platforms, isMultiPlatform, productsById };
}

/** One row of the sidebar's product selector — everything it needs to render. */
export interface ProductScopeOption {
  id: string;
  /** The product's `title`, or its id when the definition carries none. */
  label: string;
  /** Secondary text: `No platforms` | `Web only` | `3 platforms`. */
  platformLabel: string;
}

/**
 * The platform count as a phrase, from the product's **own** menu.
 *
 * Three distinct states, not two: `[]` is meaningful — availability is simply
 * not a tracked dimension for a CLI or a public API — so "No platforms" is a
 * real answer rather than an error or a blank. Arity 1 names the platform
 * instead of counting it, because "1 platform" tells a reader less than "Web
 * only" does at the same width.
 *
 * Takes `unknown` deliberately: `resolveProducts` is lenient by contract and a
 * stored definition may carry no `platforms` array at all, which reads the same
 * as an empty one. For the same reason the arity-1 case only names an entry it
 * recognises — a junk id must degrade to the neutral count ("1 platform"), not
 * be echoed back at the reader as "null only".
 */
export function platformCountLabel(platforms: unknown): string {
  const list = Array.isArray(platforms) ? platforms : [];
  if (list.length === 0) return "No platforms";
  if (list.length === 1) {
    const only = PLATFORMS.find((platform) => platform.id === list[0]);
    if (only) return `${only.label} only`;
  }
  return `${list.length} platform${list.length === 1 ? "" : "s"}`;
}

/**
 * The selector's options, in declaration order. **Products only** — the "All
 * products" entry is the selector's own affordance, not a product, so an empty
 * result here means "this project has no products" and the control does not
 * render at all. That emptiness is the design guarantee: a project that has
 * never heard of products shows no new concept.
 *
 * Takes the bundle and drills into `bundle.project` itself, like
 * `resolveProductScope` above and for the same reason: `ProjectBundle` has no
 * `metadata` of its own, and every caller that has to remember that is a caller
 * that can forget.
 *
 * `title` is not validated by `resolveProducts` — a definition missing one is a
 * shape fault owned by the parser and the JSON Schema, so at runtime it can be
 * absent whatever the type says. Falling back to the id keeps a real, clickable
 * row instead of a blank one.
 */
export function productScopeOptions(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
): ProductScopeOption[] {
  return resolveProducts(bundle?.project).map((product) => ({
    id: product.id,
    label: typeof product.title === "string" && product.title.trim() !== "" ? product.title : product.id,
    platformLabel: platformCountLabel(product.platforms),
  }));
}

/** Anchor ids an acceptance covers (outgoing `covers` edges). */
export function coveredAnchorIds(acceptanceId: string, edges: readonly Edge[]): string[] {
  return edges
    .filter((e) => e.edge_type === "covers" && e.source_id === acceptanceId)
    .map((e) => e.target_id);
}

/**
 * The products an acceptance belongs to — possibly none, possibly several.
 *
 * **Anchors govern when there are any** (RFC decision 3): an acceptance is a
 * statement about the views and flows it covers, so its membership is theirs.
 * Stored `metadata.product` is the answer only for an acceptance with nothing
 * to derive from — the intake case (§ Decision 5), where a PM files an idea
 * knowing which app it is for long before they know which screens it needs.
 * Reading the stored value first would let a stale key on an anchored
 * acceptance out-vote the graph it is attached to.
 *
 * Unresolvable anchors are skipped, exactly as `groupAcceptancesByAnchor`
 * skips them, so a dangling `covers` edge cannot make an acceptance both
 * anchored-for-membership and unanchored-for-grouping.
 *
 * An **empty** result is meaningful and is not the same as "everywhere": it is
 * triage. Either the acceptance is anchorless and unassigned, or every anchor it
 * covers is itself unassigned. Both show under All products only.
 */
export function productsOfAcceptance(
  acceptance: Pick<Node, "id" | "species" | "metadata">,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): Set<string> {
  const anchors = coveredAnchorIds(acceptance.id, edges)
    .map((anchorId) => nodesById.get(anchorId))
    .filter((anchor): anchor is Node => anchor !== undefined);

  if (anchors.length === 0) {
    const stored = productOf(acceptance);
    return stored === null ? new Set<string>() : new Set([stored]);
  }

  const products = new Set<string>();
  for (const anchor of anchors) {
    const product = productOf(anchor);
    if (product !== null) products.add(product);
  }
  return products;
}

/**
 * The graph a full membership answer needs. Assembled once per snapshot at the
 * page — `usageIndex` is `buildProductUsageIndex(nodes, edges)`, which is a
 * traversal and must never run per node.
 */
export interface ProductGraph {
  edges: readonly Edge[];
  nodesById: ReadonlyMap<string, Node>;
  usageIndex: ProductUsageIndex;
}

/**
 * **The one answer to "which products does this node belong to?"** — every
 * species, one function. Three surfaces asked the question three ways before
 * this existed, and two of them disagreed about the same acceptance.
 *
 * - `flow` / `view` — stored `metadata.product`. They are the only species a
 *   human assigns directly.
 * - `acceptance` — {@link productsOfAcceptance}: anchors first, stored key only
 *   when it covers nothing (§ Decision 5).
 * - `data-model` / `api-endpoint` — derived from consumers via the usage index.
 *
 * An **empty set means different things** for the two halves, which is why
 * {@link nodeInScope} and not this function decides what to do with it: for a
 * species that stores membership, empty means *nobody has said yet* — triage.
 * For the system layer it means *nothing in the graph reaches this* — an orphan.
 */
export function productsOfNode(
  node: Pick<Node, "id" | "species" | "metadata">,
  graph: ProductGraph,
): Set<string> {
  if (node.species === "acceptance") {
    return productsOfAcceptance(node, graph.edges, graph.nodesById);
  }
  if (PRODUCT_MEMBERSHIP_SPECIES.includes(node.species)) {
    const stored = productOf(node);
    return stored === null ? new Set<string>() : new Set([stored]);
  }
  return new Set(productsUsingNode(node.id, graph.usageIndex));
}

/**
 * Does this node belong in the scope? `null` scope matches everything.
 *
 * **With a `graph`** the answer comes from {@link productsOfNode}, so every
 * surface that passes one scopes identically — an acceptance covering an admin
 * view lands in `admin` on Delivery and on Acceptances, whatever its stored key
 * says. The two readings of an empty set are resolved here:
 *
 * - a flow, view, or acceptance with no products is **out** of every named
 *   scope. Nobody has assigned it; it belongs to triage, visible under All
 *   products where it can be found and fixed.
 * - a data model or endpoint with no products is **in** every named scope. It is
 *   an orphan — reached by nothing — and hiding it would bury exactly the node
 *   that needs attention. Task 14 gives Library the same rule.
 *
 * **Without a `graph`** it degrades to stored membership only, which is all a
 * caller holding no edges can honestly answer. That form predates the resolver
 * and stays for callers that have no graph to give.
 */
export function nodeInScope(
  node: Pick<Node, "id" | "species" | "metadata">,
  scope: ProductScope,
  graph?: ProductGraph,
): boolean {
  if (scope.productId === null) return true;
  if (graph === undefined) return productOf(node) === scope.productId;

  const products = productsOfNode(node, graph);
  if (products.size === 0) return !PRODUCT_MEMBERSHIP_SPECIES.includes(node.species);
  return products.has(scope.productId);
}

/**
 * The platforms this node actually has, given the scope.
 *
 * The **node's own product menu governs**, not the scope's platform list. That
 * distinction is the whole delivery fix: under "All products" the scope's list
 * is the union of every product, so intersecting against it would leave a
 * web-only admin view contributing to the Android column exactly as it does
 * today. Falling back to `scope.product` covers the node that stores no
 * membership while a single product is scoped.
 */
export function scopedPlatforms(
  node: Pick<Node, "species" | "platforms" | "metadata">,
  scope: ProductScope,
): PlatformId[] {
  const ownId = productOf(node);
  const own = ownId === null ? null : scope.productsById.get(ownId) ?? null;
  return effectiveNodePlatforms(node, own ?? scope.product);
}

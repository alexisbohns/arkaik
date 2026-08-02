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
  type MapDefinition,
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
 * The products this node belongs to, as **titles ready to render**, in the
 * project's declaration order.
 *
 * Display only — {@link productsOfNode} owns the membership answer and this adds
 * nothing to it but ordering and a label. Both are worth doing once rather than
 * per surface: a `Set`'s iteration order is insertion order, which for a data
 * model reached by three products is whatever the traversal happened to hit
 * first, and "Used by: Admin, End-user" flipping between renders of the same
 * graph reads as a change when nothing changed.
 *
 * Ids the project no longer declares sort last and render as themselves. They
 * are the stale-key case `ProductScopeSelector` also has to survive, and the
 * honest thing to show is the id — dropping it would silently under-report who
 * touches a data model.
 *
 * `title` is not validated by `resolveProducts` — a definition missing one is a
 * shape fault owned by the parser, so at runtime it can be absent whatever the
 * type says. Falling back to the id keeps a real badge instead of a blank one,
 * exactly as `productScopeOptions` does.
 *
 * An **empty result keeps both its meanings** and the caller resolves them, as
 * with {@link productsOfNode}: for a flow, view, or acceptance it is *nobody has
 * assigned this yet*; for a data model or endpoint it is *nothing reaches this*
 * — the orphan the Library marks "Unattached" (§ Decision 8).
 */
export function productLabelsOfNode(
  node: Pick<Node, "id" | "species" | "metadata">,
  scope: ProductScope,
  graph: ProductGraph,
): string[] {
  const products = productsOfNode(node, graph);
  const declared = [...scope.productsById.keys()].filter((id) => products.has(id));
  const undeclared = [...products].filter((id) => !scope.productsById.has(id));
  return [...declared, ...undeclared].map((id) => {
    const title = scope.productsById.get(id)?.title;
    return typeof title === "string" && title.trim() !== "" ? title : id;
  });
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
  return nodeInProduct(node, scope.productId, graph);
}

/**
 * {@link nodeInScope} against a bare product id rather than a resolved scope,
 * and the one copy of the membership rule the two share.
 *
 * Surfaces still call `nodeInScope` — they hold a scope, and the degraded
 * no-graph form is theirs. This exists for the caller that holds a product id
 * that is *not* the shell's: a stored map's own `product`
 * ({@link mapProductId}), which wins over the global scope and so cannot be
 * asked through a `ProductScope` without inventing one whose `platforms` and
 * `product` would describe a different product than its `productId`.
 */
export function nodeInProduct(
  node: Pick<Node, "id" | "species" | "metadata">,
  productId: string | null,
  graph: ProductGraph,
): boolean {
  if (productId === null) return true;
  const products = productsOfNode(node, graph);
  if (products.size === 0) return !PRODUCT_MEMBERSHIP_SPECIES.includes(node.species);
  return products.has(productId);
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

/* --- Maps ------------------------------------------------------------------
 *
 * A map is a *saved projection* (docs/spec/maps.md). Two product answers can
 * therefore be in play at once — the definition's own `product` and the shell's
 * global scope — and the three functions below are the only place the repo
 * decides between them.
 */

/** A stored value that is only a declaration when it is a non-blank string. */
function declared(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * **The product a map reads through — the map's own `product` wins.**
 *
 * A definition's `product` is an explicit, named, stored property of a saved
 * view; the shell's scope is an ambient default. So the global scope acts as
 * the *default* product for a map that declares none, and never overrides one
 * that does. A map titled "Admin systems" shows admin whatever the sidebar
 * says, which is the only rule under which its title cannot lie.
 *
 * The two rejected alternatives both break something visible: *global wins*
 * makes a saved map render another product's graph under its own name, and
 * *intersection* renders a saved map as a blank canvas — with no explanation —
 * for every scope but one.
 *
 * The built-in Journey and System maps declare no `product`, so they follow the
 * shell exactly as every other surface does; and a project declaring no
 * products resolves `scope.productId` to `null` here, which filters nothing.
 */
export function mapProductId(
  definition: Pick<MapDefinition, "product"> | undefined | null,
  scope: ProductScope,
): string | null {
  // Precedence, written once: the definition's own `product`, then the shell's
  // global scope. Never the other way round.
  return declared(definition?.product) ?? scope.productId;
}

/**
 * The journey's anchor node id, or `undefined` when nothing anchors it.
 *
 * The fallback chain is a single expression on purpose: three levels that read
 * top-down in precedence order cannot be reordered by an edit that looks local.
 * Each level is `declared`-guarded so a blank stored value falls through rather
 * than swallowing the levels beneath it — `resolveProducts` is lenient by
 * contract and a stored product may carry any `root_node_id` at all.
 *
 * The middle level is what makes a product an app rather than a tag: Admin
 * opens on Admin's own front door instead of the end-user app's.
 */
export function resolveJourneyAnchorId(
  definition: Pick<MapDefinition, "root_node_id" | "product"> | undefined | null,
  project: Pick<Project, "root_node_id"> | undefined | null,
  scope: ProductScope,
): string | undefined {
  const productId = mapProductId(definition, scope);
  const product = productId === null ? undefined : scope.productsById.get(productId);

  // Anchor precedence — the map's own root, then the product's, then the
  // project's. Do not reorder.
  return (
    declared(definition?.root_node_id) ?? declared(product?.root_node_id) ?? declared(project?.root_node_id)
  );
}

/**
 * The nodes a map may select from, restricted to {@link mapProductId} — applied
 * **before** `computeMapSubgraph`, so the species and edge-type filters compose
 * on top of it unchanged (docs/spec/maps.md § Subgraph Algorithm).
 *
 * Filtering nodes is enough to filter edges: step 2 of the algorithm already
 * drops any edge an endpoint of which did not survive step 1.
 *
 * Callers pass the **whole** snapshot and use the result only as the selection
 * input; status derivation (`getEffectivePlatformStatuses` and friends) must
 * keep seeing every node, because an acceptance covering a view is still
 * evidence about that view whichever product the reader is scoped to.
 *
 * This lives in the app rather than in `computeMapSubgraph` because membership
 * resolution does — see {@link productsOfNode} and {@link nodeInProduct}. The
 * consequence is a known gap, recorded in docs/spec/maps.md § Product Scope:
 * the MCP server and the CLI call `computeMapSubgraph` directly and so do not
 * apply `product`.
 */
export function mapScopedNodes<N extends Pick<Node, "id" | "species" | "metadata">>(
  definition: Pick<MapDefinition, "product"> | undefined | null,
  nodes: readonly N[],
  scope: ProductScope,
  graph: ProductGraph,
): readonly N[] {
  const productId = mapProductId(definition, scope);
  if (productId === null) return nodes;
  return nodes.filter((node) => nodeInProduct(node, productId, graph));
}

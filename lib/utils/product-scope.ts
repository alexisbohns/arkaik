/**
 * App-side helpers over the schema's product projections. The schema package
 * owns the semantics (packages/schema/src/products.ts); this module owns the
 * shapes the React surfaces want — chiefly the arity that decides whether a
 * surface renders per-platform or single-status.
 *
 * Every function here takes the product (or a scope carrying it) as an
 * *argument* and never reads scope state. That is what kept the per-surface
 * override (#315) cheap — it landed as a different argument to the same
 * functions, not a second code path — and it is why it must stay true.
 */

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { Node, Project } from "@/lib/data/types";
import {
  effectiveNodePlatforms,
  mapProductId,
  nodeInProduct,
  productOf,
  productPlatforms,
  productsOfNode,
  resolveProducts,
  type MapDefinition,
  type ProductDefinition,
  type ProductGraph,
} from "@arkaik/schema";

/**
 * **Membership resolution lives in `@arkaik/schema`** and is re-exported here
 * unchanged (issue #319). It used to live in this file, which meant
 * `computeMapSubgraph` could not apply a map's `product` and the MCP server
 * served the unscoped subgraph under a scoped map's name — audience symmetry
 * broken by nothing more than where a function sat.
 *
 * The surfaces still import from this module, because this module owns the
 * shapes they hold (`ProductScope`, the arity rule). What moved is the
 * semantics, and it moved so that there stays exactly one copy of it.
 */
export {
  buildProductGraph,
  coveredAnchorIds,
  mapProductId,
  mapScopedNodes,
  nodeInProduct,
  productsOfAcceptance,
  productsOfNode,
  type ProductGraph,
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
 * **What to call ONE product on screen, written once.**
 *
 * `title` is not validated by `resolveProducts` — a definition needs only an id
 * to resolve, and bundles are hand-edited and agent-edited, so at runtime the
 * title can be absent, blank, or not a string whatever the type says. Falling
 * back to the id keeps a real, clickable row instead of a blank one.
 *
 * It lives here rather than in each surface because the fallback has to be
 * **identical everywhere**: the settings manager's row, the dialog that deletes
 * that row, the scope selector and the node picker all name the same malformed
 * product, and a user who reads `admin-dashboard` in one place and an empty pill
 * in another cannot tell they are the same thing. Four copies of a one-line rule
 * stay in sync exactly until one of them does not.
 *
 * It lives *next to* {@link productLabels} because that is the plural, ordered
 * form of the same fallback — over ids and a scope rather than over a definition
 * — and the two answers must never disagree. It is deliberately NOT in
 * lib/utils/product-editing.ts, which would be the other natural home: that
 * module is not part of this one's module graph, and importing it here would
 * make every test loader that builds product-scope.ts (pyramid, delivery,
 * coverage, acceptance-matrix, journey-graph) build product-editing.ts too, for
 * a display rule none of them exercise.
 *
 * Tolerates `null` so a dialog rendering on its way out, with its subject
 * already cleared, gets an empty string rather than a throw.
 */
export function productDisplayTitle(
  product: Pick<ProductDefinition, "id" | "title"> | null | undefined,
): string {
  if (!product) return "";
  return typeof product.title === "string" && product.title.trim() !== "" ? product.title : product.id;
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
 * The title fallback is {@link productDisplayTitle}'s, not a copy of it — a
 * definition missing a title is a shape fault the parser owns, so at runtime it
 * can be absent whatever the type says, and the row the selector shows for it
 * has to read identically to the row the settings manager shows.
 */
export function productScopeOptions(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
): ProductScopeOption[] {
  return resolveProducts(bundle?.project).map((product) => ({
    id: product.id,
    label: productDisplayTitle(product),
    platformLabel: platformCountLabel(product.platforms),
  }));
}

/**
 * The scope's name for the header's meta line — the second row `PageHeader`
 * shows in place of the breadcrumb trail when no panel is open (Overview,
 * Delivery, Pyramid and Changelog otherwise pass no `meta` at all and sat
 * permanently blank).
 *
 * **`undefined` when the project declares no products**, matching
 * `ProductScopeSelector`'s own guard (`productScopeOptions(project).length
 * === 0`): a project that has never heard of products must keep looking
 * exactly as it did before the feature existed, so the header grows no new
 * word either. `scope.productsById` is built from the same
 * `resolveProducts(project)` call the selector's options are, so the two
 * checks can never disagree.
 *
 * It takes the **resolved scope**, so on a surface carrying a `?product=`
 * override (#315) it names the narrowed product rather than the shell's. That
 * is the wanted reading rather than a coincidence: the header is then the one
 * line on screen explaining why the surface beneath it shows less than the
 * sidebar says.
 */
export function productScopeMetaLabel(scope: ProductScope): string | undefined {
  if (scope.productsById.size === 0) return undefined;
  return scope.productId === null ? "All products" : productDisplayTitle(scope.product);
}

/* --- Per-surface override ----------------------------------------------------
 *
 * A surface may narrow the shell's scope and may never widen or sidestep it
 * (docs/superpowers/specs/2026-08-03-per-surface-product-override-design.md
 * § Decision 2). Both rules are pure functions here rather than logic inside the
 * control, because no component in this repo can be exercised by a test.
 */

/** The query param a surface stores its override in. Written once. */
export const PRODUCT_OVERRIDE_PARAM = "product";

/**
 * **The product a surface actually reads through** — the shell's scope, then
 * the surface's own override.
 *
 * This resolves to `global ?? override`, which is the opposite order to the one
 * issue #315 predicted (`override ?? global`), and deliberately. Narrow-only
 * means an override is only ever legitimate while `globalId` is `null`, so the
 * two formulas agree wherever one exists — and this order additionally makes a
 * leftover param **inert** rather than load-bearing. That is what lets the
 * control disappear under a named scope without rewriting the URL: a design
 * where the control was hidden but the param still applied would show a
 * narrowed surface with nothing on screen to explain it.
 *
 * An override naming a product the project does not declare is **ignored**, not
 * applied. Two routes reach that without anyone doing anything strange — a link
 * shared into a different project, and Library's own params, which
 * `app/project/[id]/layout.tsx` carries across a project switch. Applying a
 * stale id would filter to nothing, and an empty surface arrived at by someone
 * else's link cannot explain itself.
 *
 * Note this differs from a stale *localStorage* global scope, which
 * `resolveProductScope` still keeps and still filters by. That asymmetry is
 * pre-existing and out of scope for #315; it is recorded in the spec's
 * § Decision 4 so the difference stays a decision rather than an accident.
 */
export function resolveEffectiveProductId(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  globalId: string | null,
  rawOverride: string | null | undefined,
): string | null {
  if (globalId !== null) return globalId;
  const candidate = declared(rawOverride);
  if (candidate === undefined) return null;
  return resolveProducts(bundle?.project).some((product) => product.id === candidate) ? candidate : null;
}

/**
 * May this surface offer an override at all?
 *
 * Two conditions, one predicate: the shell must be showing All products (there
 * is nothing a named scope could narrow *to* that is not itself), and the
 * project must declare products. The second half is the degenerate-case
 * guarantee — a project that has never declared a product shows no new control
 * and no new concept — and it is `productScopeOptions` rather than a second
 * count of the same thing, so the control cannot render for a project the
 * sidebar selector considers empty.
 */
export function canOverrideProduct(
  bundle: { project?: Pick<Project, "metadata"> } | undefined | null,
  globalId: string | null,
): boolean {
  return globalId === null && productScopeOptions(bundle).length > 0;
}

/**
 * The products this node belongs to, as **titles ready to render**, in the
 * project's declaration order.
 *
 * Display only, and a composition of two functions that each own one half:
 * {@link productsOfNode} answers the membership, {@link productLabels} owns the
 * ordering and the title fallback. Neither rule is written here.
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
  return productLabels(productsOfNode(node, graph), scope);
}

/**
 * **The ordering and the title fallback, written once** — a set of product ids
 * as titles ready to render. {@link productLabelsOfNode} is this function plus a
 * membership answer, and holds no copy of either rule.
 *
 * It is separate from `productLabelsOfNode` for the caller that already *has*
 * the ids: the acceptance editor derives its own membership through
 * {@link productsOfAcceptance} (anchors, no traversal), and routing that through
 * `productLabelsOfNode` would re-enter {@link productsOfNode} and demand a
 * `usageIndex` — a full `buildProductUsageIndex` traversal — to answer a question
 * about a species that never consults it. The editor duplicated both rules inline
 * instead, which is exactly the drift this module exists to prevent.
 *
 * **Declaration order first, undeclared ids last.** A `Set` iterates in insertion
 * order, which for a data model reached by three products is whatever the
 * traversal happened to hit first; "Used by: Admin, End-user" flipping between
 * renders of the same graph reads as a change when nothing changed. Ids the
 * project no longer declares sort last and render as themselves — they are the
 * stale-key case `ProductScopeSelector` also has to survive, and the honest thing
 * to show is the id, since dropping it would silently under-report who touches a
 * node.
 *
 * `title` is not validated by `resolveProducts` — a definition missing one is a
 * shape fault owned by the parser, so at runtime it can be absent whatever the
 * type says. Falling back to the id keeps a real badge instead of a blank one,
 * exactly as `productScopeOptions` does.
 *
 * Takes an `Iterable` rather than a `Set` so a caller holding an array of ids
 * need not build one; membership is tested against the *scope*, never against
 * the argument, so order of iteration is the only thing read from it.
 */
export function productLabels(ids: Iterable<string>, scope: ProductScope): string[] {
  const products = ids instanceof Set ? ids : new Set(ids);
  const declared = [...scope.productsById.keys()].filter((id) => products.has(id));
  const undeclared = [...products].filter((id) => !scope.productsById.has(id));
  return [...declared, ...undeclared].map((id) => {
    // The singular fallback, not a copy of it — an id the project no longer
    // declares has no definition to read a title from, and reads as itself.
    return productDisplayTitle(scope.productsById.get(id) ?? { id, title: "" });
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
 * A map is a *saved projection* (docs/spec/maps.md). Two product answers can be
 * in play at once — the definition's own `product` and the shell's global scope
 * — and `mapProductId` in `@arkaik/schema` is the one place the repo decides
 * between them. It takes the shell's `scope.productId` as its ambient default;
 * what stays here is the anchor chain, which needs the *resolved definitions*
 * a `ProductScope` carries and no other audience has.
 */

/** A stored value that is only a declaration when it is a non-blank string. */
function declared(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The journey's anchor node id, or `undefined` when nothing anchors it.
 *
 * The chain is a single expression on purpose: levels that read top-down in
 * precedence order cannot be reordered by an edit that looks local. Each level
 * is `declared`-guarded so a blank stored value falls through rather than
 * swallowing the levels beneath it — `resolveProducts` is lenient by contract
 * and a stored product may carry any `root_node_id` at all.
 *
 * 1. the map's own `root_node_id`;
 * 2. the resolved product's `root_node_id`;
 * 3. `project.root_node_id` — **only when no product is resolved**.
 *
 * Level 2 is what makes a product an app rather than a tag: Admin opens on
 * Admin's own front door instead of the end-user app's. Level 3 is the
 * *project's* front door, and that is exactly why it stops at the product
 * boundary: falling through to it under a named scope hands Admin the end-user
 * app's landing view, and the journey then walks the end-user app's compose
 * chain under Admin's name and Admin's platform menu — foreign content wearing
 * another product's rules. A named product that declares no anchor has no
 * journey yet, and the honest render for that is an empty state saying so, not
 * somebody else's map.
 *
 * "No product is resolved" is `mapProductId(...) === null`, which covers both
 * cases where level 3 is still right: All products, and a project that declares
 * no products at all. Those two are byte-identical to the pre-products chain.
 */
export function resolveJourneyAnchorId(
  definition: Pick<MapDefinition, "root_node_id" | "product"> | undefined | null,
  project: Pick<Project, "root_node_id"> | undefined | null,
  scope: ProductScope,
): string | undefined {
  const productId = mapProductId(definition, scope.productId);
  const product = productId === null ? undefined : scope.productsById.get(productId);

  // Anchor precedence — the map's own root, then the product's, then (only
  // when nothing named a product) the project's. Do not reorder.
  return (
    declared(definition?.root_node_id) ??
    declared(product?.root_node_id) ??
    (productId === null ? declared(project?.root_node_id) : undefined)
  );
}

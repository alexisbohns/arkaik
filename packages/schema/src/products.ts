/**
 * Products — a project describes a *family* of apps that share one graph
 * (docs/spec/bundle-format.md § Products). A product names an app and the
 * platforms it can ship on; flows, views, and acceptances store membership,
 * while data models and API endpoints derive it from who consumes them.
 *
 * Same doctrine as {@link ./maps}: pure functions, minimal `Pick<>` inputs,
 * immutable, deliberately **zod-free** (`./ids` carries no runtime dependencies
 * of its own) so the module stays browser-safe and adds nothing to the
 * standalone validator bundle.
 *
 * Everything here is lenient. A stale or malformed product definition must
 * never fail an import or a CI gate — `validateBundle()` reports those as
 * warnings, exactly as it does for stored maps.
 */

import type { Edge, Node, Project } from "./bundle";
import { PLATFORM_IDS, type PlatformId, type SpeciesId } from "./ids";

/**
 * A product: one app in the family. `platforms` is a *menu*, not a claim — a
 * node's own `platforms` is the authoritative list and must be a subset of it.
 * An empty menu means "availability is not a tracked dimension here" (a CLI, a
 * public API), and every surface collapses to a single lifecycle status.
 */
export interface ProductDefinition extends Record<string, unknown> {
  /** Kebab-case, unique within the project. */
  id: string;
  title: string;
  description?: string;
  platforms: PlatformId[];
  /** This product's journey anchor; generalizes `project.root_node_id`. */
  root_node_id?: string;
}

/** The species that *store* membership. Every other species derives it. */
export const PRODUCT_MEMBERSHIP_SPECIES: readonly SpeciesId[] = ["flow", "view", "acceptance"];

/**
 * Stored definitions in order, with non-objects, blank ids, and duplicate ids
 * dropped. Duplicates resolve **first-wins** so that `productOf` is
 * deterministic even for a bundle `validateBundle()` has already warned about.
 *
 * A blank or whitespace-only id is **not a declaration**, matching the `.trim()`
 * test `validate.ts` uses to decide whether the gated product rules switch on.
 * The two modules must agree on the word "declared": if they did not, a project
 * whose only definition has a blank id would be product-less to the validator
 * and platform-less to `productPlatforms`, and the arity rule would collapse to
 * a single status for a project that has simply never heard of products.
 * Such an id still earns a `product-invalid-id` warning — dropped here, not
 * hidden.
 */
export function resolveProducts(project: Pick<Project, "metadata"> | undefined | null): ProductDefinition[] {
  const stored = project?.metadata?.products;
  if (!Array.isArray(stored)) return [];

  const seen = new Set<string>();
  const products: ProductDefinition[] = [];

  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || candidate.id.trim() === "" || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    products.push(candidate as unknown as ProductDefinition);
  }

  return products;
}

/** Stored membership, or `null` — including for the species that never store it. */
export function productOf(node: Pick<Node, "species" | "metadata">): string | null {
  if (!PRODUCT_MEMBERSHIP_SPECIES.includes(node.species)) return null;
  const product = node.metadata?.product;
  return typeof product === "string" ? product : null;
}

/**
 * The scope's platform **menu** — the sole input to the arity rule that every
 * surface reads.
 *
 * - a known `productId` → that product's own list;
 * - `null` (All products) → the union of every declared product's list;
 * - an unknown id → same as `null`, because a stale scope must degrade, not throw;
 * - a project declaring no products → `PLATFORM_IDS`, the degenerate case that
 *   makes today's behavior fall out unchanged.
 *
 * The result is always ordered by `PLATFORM_IDS` so that columns, tabs, and
 * rings never reorder themselves when the scope changes.
 */
export function productPlatforms(
  project: Pick<Project, "metadata"> | undefined | null,
  productId: string | null,
): PlatformId[] {
  const products = resolveProducts(project);
  if (products.length === 0) return [...PLATFORM_IDS];

  const named = productId === null ? undefined : products.find((product) => product.id === productId);
  const contributing = named ? [named] : products;

  const union = new Set<string>();
  for (const product of contributing) {
    if (!Array.isArray(product.platforms)) continue;
    for (const platform of product.platforms) union.add(platform as string);
  }

  return PLATFORM_IDS.filter((platform) => union.has(platform));
}

/**
 * `node.platforms ∩ product.platforms`, ordered by `PLATFORM_IDS`.
 *
 * This intersection is why the containment rule can be a *warning*: a platform
 * outside the product's menu simply drops out of the display rather than
 * corrupting it. A `null` product means "no menu to intersect against" and
 * returns the node's own list unchanged.
 */
export function effectiveNodePlatforms(
  node: Pick<Node, "platforms">,
  product: ProductDefinition | null | undefined,
): PlatformId[] {
  const own = Array.isArray(node.platforms) ? node.platforms : [];
  if (!product || !Array.isArray(product.platforms)) {
    return PLATFORM_IDS.filter((platform) => own.includes(platform));
  }

  const menu = new Set<string>(product.platforms as string[]);
  return PLATFORM_IDS.filter((platform) => own.includes(platform) && menu.has(platform));
}

/** Species whose membership is derived from consumers rather than stored. */
const SYSTEM_LAYER_SPECIES: readonly SpeciesId[] = ["api-endpoint", "data-model"];

/** Edge types along which a consumer reaches the system layer. */
const USAGE_EDGE_TYPES = new Set<string>(["calls", "displays", "queries"]);

/**
 * `nodeId → sorted product ids`, covering the system layer only. Built once per
 * snapshot; {@link productsUsingNode} is a lookup, never a traversal.
 */
export type ProductUsageIndex = ReadonlyMap<string, string[]>;

/**
 * Walk outward from every membership-bearing flow/view along `calls` /
 * `displays` / `queries`, following each edge **in its stored direction** and
 * only into `api-endpoint` / `data-model` targets.
 *
 * The species restriction is load-bearing twice over. `calls` also runs
 * API → View — the inbound/read affordance, admitted by `VALID_EDGE_SEMANTICS`
 * (docs/graph-model.md § Edge Types) — so an unrestricted walk climbs back into
 * another product's views. And any *undirected* formulation is all-pairs within
 * a connected component, which would make a data model that only Admin touches
 * report "used by End-user" purely because the two products share some other
 * model.
 */
export function buildProductUsageIndex(
  nodes: readonly Pick<Node, "id" | "species" | "metadata">[],
  edges: readonly Pick<Edge, "edge_type" | "source_id" | "target_id">[],
): ProductUsageIndex {
  const speciesById = new Map<string, SpeciesId>();
  for (const node of nodes) speciesById.set(node.id, node.species);

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!USAGE_EDGE_TYPES.has(edge.edge_type)) continue;
    const targetSpecies = speciesById.get(edge.target_id);
    if (targetSpecies === undefined || !SYSTEM_LAYER_SPECIES.includes(targetSpecies)) continue;
    const list = outgoing.get(edge.source_id) ?? [];
    list.push(edge.target_id);
    outgoing.set(edge.source_id, list);
  }

  // One seed set per distinct product, not per membership-bearing node — a
  // product spread across many views walks the downstream graph once.
  const seedsByProduct = new Map<string, Set<string>>();
  for (const node of nodes) {
    const product = productOf(node);
    if (product === null) continue;
    const seeds = seedsByProduct.get(product) ?? new Set<string>();
    for (const next of outgoing.get(node.id) ?? []) seeds.add(next);
    seedsByProduct.set(product, seeds);
  }

  const byNode = new Map<string, Set<string>>();

  for (const [product, seeds] of seedsByProduct) {
    const visited = new Set<string>(seeds);
    let frontier = [...seeds];

    while (frontier.length > 0) {
      const next: string[] = [];
      for (const current of frontier) {
        const products = byNode.get(current) ?? new Set<string>();
        products.add(product);
        byNode.set(current, products);

        for (const neighbor of outgoing.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  }

  const index = new Map<string, string[]>();
  for (const [nodeId, products] of byNode) index.set(nodeId, [...products].sort());
  return index;
}

/** Products that reach this node, or `[]`. A lookup into {@link buildProductUsageIndex}. */
export function productsUsingNode(nodeId: string, index: ProductUsageIndex): string[] {
  return index.get(nodeId) ?? [];
}

/* --- Membership resolution ---------------------------------------------------
 *
 * The functions below answer "which products does this node belong to?" for
 * every species, and they live **here** rather than in the app (issue #319).
 *
 * They began in `lib/utils/product-scope.ts`, which meant `computeMapSubgraph`
 * could not apply a map's `product` and every non-app audience — the MCP
 * server's `get_map` and `list_maps` — silently served the unscoped subgraph
 * under a scoped map's name. That broke audience symmetry
 * (docs/spec/mcp.md): a map titled "Admin systems" answered one question on the
 * canvas and a different, larger one over MCP. The fix had to be this move and
 * not a second implementation in the MCP layer, because two implementations of
 * one membership rule is exactly how two surfaces come to disagree about the
 * same node.
 *
 * Same doctrine as the rest of this module: pure, zod-free, minimal `Pick<>`
 * inputs. The app's `lib/utils/product-scope.ts` re-exports them unchanged, so
 * the surfaces still import from the module that owns their shapes.
 */

/** The node fields membership is resolved from. */
type MembershipNode = Pick<Node, "id" | "species" | "metadata">;

/** The edge fields membership traversals read. */
type MembershipEdge = Pick<Edge, "edge_type" | "source_id" | "target_id">;

/**
 * The graph a full membership answer needs. Assembled **once per snapshot** —
 * `usageIndex` is a traversal and must never run per node — by
 * {@link buildProductGraph}, or by hand where a caller already holds the parts
 * (every app surface holds `nodesById` for other reasons).
 */
export interface ProductGraph {
  edges: readonly MembershipEdge[];
  nodesById: ReadonlyMap<string, MembershipNode>;
  usageIndex: ProductUsageIndex;
}

/** The whole snapshot as a {@link ProductGraph}. One traversal, one map build. */
export function buildProductGraph(
  nodes: readonly MembershipNode[],
  edges: readonly MembershipEdge[],
): ProductGraph {
  return {
    edges,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    usageIndex: buildProductUsageIndex(nodes, edges),
  };
}

/** Anchor ids an acceptance covers (outgoing `covers` edges). */
export function coveredAnchorIds(acceptanceId: string, edges: readonly MembershipEdge[]): string[] {
  return edges
    .filter((edge) => edge.edge_type === "covers" && edge.source_id === acceptanceId)
    .map((edge) => edge.target_id);
}

/**
 * The products an acceptance belongs to — possibly none, possibly several.
 *
 * **Anchors govern when there are any** (products RFC decision 3): an acceptance
 * is a statement about the views and flows it covers, so its membership is
 * theirs. Stored `metadata.product` is the answer only for an acceptance with
 * nothing to derive from — the intake case, where a PM files an idea knowing
 * which app it is for long before they know which screens it needs. Reading the
 * stored value first would let a stale key on an anchored acceptance out-vote
 * the graph it is attached to.
 *
 * Unresolvable anchors are skipped, exactly as the app's
 * `groupAcceptancesByAnchor` skips them, so a dangling `covers` edge cannot make
 * an acceptance both anchored-for-membership and unanchored-for-grouping.
 *
 * An **empty** result is meaningful and is not the same as "everywhere": it is
 * triage. Either the acceptance is anchorless and unassigned, or every anchor it
 * covers is itself unassigned. Both show under All products only.
 */
export function productsOfAcceptance(
  acceptance: MembershipNode,
  edges: readonly MembershipEdge[],
  nodesById: ReadonlyMap<string, MembershipNode>,
): Set<string> {
  const anchors = coveredAnchorIds(acceptance.id, edges)
    .map((anchorId) => nodesById.get(anchorId))
    .filter((anchor): anchor is MembershipNode => anchor !== undefined);

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
 * **The one answer to "which products does this node belong to?"** — every
 * species, one function. Three surfaces asked the question three ways before
 * this existed, and two of them disagreed about the same acceptance.
 *
 * - `flow` / `view` — stored `metadata.product`. They are the only species a
 *   human assigns directly.
 * - `acceptance` — {@link productsOfAcceptance}: anchors first, stored key only
 *   when it covers nothing.
 * - `data-model` / `api-endpoint` — derived from consumers via the usage index.
 *
 * An **empty set means different things** for the two halves, which is why
 * {@link nodeInProduct} and not this function decides what to do with it: for a
 * species that stores membership, empty means *nobody has said yet* — triage.
 * For the system layer it means *nothing in the graph reaches this* — an orphan.
 */
export function productsOfNode(node: MembershipNode, graph: ProductGraph): Set<string> {
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
 * Does this node belong to this product? **The single copy of the membership
 * rule** every surface and every audience tests against — the app's
 * `nodeInScope`, `mapScopedNodes`, and `computeMapSubgraph`'s product option
 * all reduce to this call.
 *
 * `null` matches everything: All products, and a project that declares none.
 *
 * The two readings of an empty set from {@link productsOfNode} are resolved
 * here, and the asymmetry is deliberate:
 *
 * - a flow, view, or acceptance with no products is **out** of every named
 *   product. Nobody has assigned it; it belongs to triage, visible under All
 *   products where it can be found and fixed.
 * - a data model or endpoint with no products is **in** every named product. It
 *   is an orphan — reached by nothing — and hiding it would bury exactly the
 *   node that needs attention (docs/spec/maps.md § Orphans).
 */
export function nodeInProduct(
  node: MembershipNode,
  productId: string | null,
  graph: ProductGraph,
): boolean {
  if (productId === null) return true;
  const products = productsOfNode(node, graph);
  if (products.size === 0) return !PRODUCT_MEMBERSHIP_SPECIES.includes(node.species);
  return products.has(productId);
}

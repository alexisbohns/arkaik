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
import type { Node, Project } from "@/lib/data/types";
import {
  effectiveNodePlatforms,
  productOf,
  productPlatforms,
  resolveProducts,
  type ProductDefinition,
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

/**
 * Does this node belong in the scope? Flows, views, and acceptances match by
 * stored membership; `null` scope matches everything. A node with no membership
 * is in triage and shows only under "All products".
 */
export function nodeInScope(node: Pick<Node, "species" | "metadata">, scope: ProductScope): boolean {
  if (scope.productId === null) return true;
  return productOf(node) === scope.productId;
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

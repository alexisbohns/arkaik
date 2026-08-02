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

import type { Node, Project } from "./bundle";
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
 * Stored definitions in order, with non-objects and duplicate ids dropped.
 * Duplicates resolve **first-wins** so that `productOf` is deterministic even
 * for a bundle `validateBundle()` has already warned about.
 */
export function resolveProducts(project: Pick<Project, "metadata"> | undefined | null): ProductDefinition[] {
  const stored = project?.metadata?.products;
  if (!Array.isArray(stored)) return [];

  const seen = new Set<string>();
  const products: ProductDefinition[] = [];

  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || seen.has(candidate.id)) continue;
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

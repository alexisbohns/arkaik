/**
 * Maps — named, parameterized projections over the snapshot
 * (docs/spec/maps.md). A map selects a subgraph (species + edge types,
 * optionally scoped to a root anchor's neighborhood) and names the renderer
 * (`kind`) that draws it. Definitions are *data*: built-ins below, custom maps
 * stored at `project.metadata.maps` — humans author them in a dialog, agents by
 * writing JSON.
 *
 * Same doctrine as {@link ./projections}: pure functions, minimal `Pick<>`
 * inputs, immutable, deliberately **zod-free** (type-only imports) so the
 * module stays browser-safe and adds nothing to the standalone validator
 * bundle. The app renders these projections, the CLI prints them, the MCP
 * server serves them (docs/spec/mcp.md) — one implementation for every
 * audience.
 *
 * Membership checks treat species/edge-type values as opaque strings: unknown
 * values select nothing rather than throwing. `validateBundle()` reports them
 * as warnings (docs/spec/maps.md § Validation) — a stale map must never fail
 * an import or a CI gate.
 */

import type { Edge, Node, Project } from "./bundle";
import type { EdgeTypeId, SpeciesId } from "./ids";
import { buildProductGraph, nodeInProduct, type ProductGraph } from "./products";

/** Known renderer kinds (docs/spec/maps.md § MapDefinition). */
export type MapKind = "journey" | "system";

export const MAP_KINDS: readonly MapKind[] = ["journey", "system"];

/** Layout hints for canvas renderers. Unknown keys round-trip like all format objects. */
export interface MapLayoutHints extends Record<string, unknown> {
  direction?: "DOWN" | "RIGHT" | (string & {});
  /**
   * Canvas layout algorithm: `"organic"` (force-directed with overlap
   * removal) or `"layered"` (hierarchical tiers). Renderers fall back to the
   * kind's default for unknown values (docs/spec/maps.md § MapDefinition).
   */
  algorithm?: "layered" | "organic" | (string & {});
}

/**
 * How a canvas renderer draws its cards (docs/spec/maps.md § Display Options).
 * Every key is optional and every value is an open enum: an unrecognized value
 * falls back to the default rather than blanking the card, the same posture as
 * {@link MapLayoutHints.algorithm}.
 */
export interface MapDisplayOptions extends Record<string, unknown> {
  /** Screenshot (or cover) art on view cards. */
  images?: boolean;
  /** A flow card's platform delivery: the Pyramid's rings, or stacked bars. */
  flow_platforms?: MapFlowPlatformsMode | (string & {});
  /** A view card's platform availability: circular chips, or labelled rows. */
  view_platforms?: MapViewPlatformsMode | (string & {});
  /** What a minimap node's fill encodes: its status, or its species. */
  minimap_color?: MapMinimapColorMode | (string & {});
}

// Default first in each union and list — the order the pickers read in.
export type MapFlowPlatformsMode = "rings" | "bars";
export type MapViewPlatformsMode = "chips" | "rows";
export type MapMinimapColorMode = "status" | "species";

/** {@link MapDisplayOptions} with every key present and every value known. */
export interface ResolvedMapDisplay {
  images: boolean;
  flow_platforms: MapFlowPlatformsMode;
  view_platforms: MapViewPlatformsMode;
  minimap_color: MapMinimapColorMode;
}

export const MAP_FLOW_PLATFORMS_MODES: readonly MapFlowPlatformsMode[] = ["rings", "bars"];
export const MAP_VIEW_PLATFORMS_MODES: readonly MapViewPlatformsMode[] = ["chips", "rows"];
export const MAP_MINIMAP_COLOR_MODES: readonly MapMinimapColorMode[] = ["status", "species"];

/**
 * What a map draws when nothing says otherwise: the compact reading, with the
 * Pyramid's rings summing a flow's delivery. Lines stay one click away for the
 * readings that want the per-platform detail spelled out.
 *
 * The minimap colors by status: a bird's-eye view is most often asked "where
 * does this product stand", and the fills match the badges the cards already
 * wear. Species — what kind of thing is over there — is one click away.
 */
export const DEFAULT_MAP_DISPLAY: ResolvedMapDisplay = {
  images: true,
  flow_platforms: "rings",
  view_platforms: "chips",
  minimap_color: "status",
};

/**
 * A stored or built-in map definition (docs/spec/maps.md § MapDefinition).
 * Unrecognized `kind` values are preserved and listed as unrenderable, never
 * dropped — the same open-enum posture as {@link Ref.type}.
 */
export interface MapDefinition extends Record<string, unknown> {
  /** Kebab-case, unique within the project; built-in ids are reserved. */
  id: string;
  title: string;
  description?: string;
  /** Selects the renderer and the selection defaults below. */
  kind: MapKind | (string & {});
  /** Node filter; defaults by kind (docs/spec/maps.md § MapDefinition). */
  species?: (SpeciesId | (string & {}))[];
  /** Edge filter; defaults by kind. */
  edge_types?: (EdgeTypeId | (string & {}))[];
  /** Scope anchor; the journey renderer falls back to `project.root_node_id`. */
  root_node_id?: string;
  /** Product scope; absent = every product (docs/spec/bundle-format.md § Products). */
  product?: string;
  /** Traversal bound from the root; absent = unbounded. */
  depth?: number;
  layout?: MapLayoutHints;
  /** Card rendering; the human twin is `project.metadata.map_display[id]`. */
  display?: MapDisplayOptions;
}

/** Per-kind selection defaults (docs/spec/maps.md § MapDefinition). */
const KIND_DEFAULTS: Record<MapKind, { species: SpeciesId[]; edge_types: EdgeTypeId[] }> = {
  journey: { species: ["flow", "view"], edge_types: ["composes"] },
  system: { species: ["view", "api-endpoint", "data-model"], edge_types: ["calls", "displays", "queries"] },
};

/** Reserved ids of the maps every project has implicitly. */
export const BUILT_IN_MAP_IDS = ["journey", "system"] as const;

export function isBuiltInMapId(id: string): boolean {
  return (BUILT_IN_MAP_IDS as readonly string[]).includes(id);
}

/** The built-in maps every project has implicitly (docs/spec/maps.md § Built-in Maps). */
export const BUILT_IN_MAPS: readonly MapDefinition[] = [
  {
    id: "journey",
    title: "Journey",
    description: "How a user moves through the product — the compose and playlist drill-down.",
    kind: "journey",
  },
  {
    id: "system",
    title: "System",
    description: "The model layer — views, API endpoints, and data models joined by cross-layer edges.",
    kind: "system",
    layout: { algorithm: "organic" },
  },
];

/** A definition with its selection filters resolved against the per-kind defaults. */
export interface ResolvedMapDefinition extends MapDefinition {
  species: (SpeciesId | (string & {}))[];
  edge_types: (EdgeTypeId | (string & {}))[];
}

/**
 * Fill `species` / `edge_types` from the kind's defaults when absent. Explicit
 * values always win. An unrecognized `kind` resolves to empty filters — the
 * empty subgraph, not an error — unless the definition provides its own.
 */
export function resolveMapDefaults(definition: MapDefinition): ResolvedMapDefinition {
  const defaults = (KIND_DEFAULTS as Partial<Record<string, { species: SpeciesId[]; edge_types: EdgeTypeId[] }>>)[
    definition.kind
  ];

  return {
    ...definition,
    species: definition.species ?? defaults?.species ?? [],
    edge_types: definition.edge_types ?? defaults?.edge_types ?? [],
  };
}

function pickMode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function applyDisplayOptions(base: ResolvedMapDisplay, options: unknown): ResolvedMapDisplay {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return base;
  const candidate = options as MapDisplayOptions;

  return {
    images: typeof candidate.images === "boolean" ? candidate.images : base.images,
    flow_platforms: candidate.flow_platforms === undefined
      ? base.flow_platforms
      : pickMode(candidate.flow_platforms, MAP_FLOW_PLATFORMS_MODES, base.flow_platforms),
    view_platforms: candidate.view_platforms === undefined
      ? base.view_platforms
      : pickMode(candidate.view_platforms, MAP_VIEW_PLATFORMS_MODES, base.view_platforms),
    minimap_color: candidate.minimap_color === undefined
      ? base.minimap_color
      : pickMode(candidate.minimap_color, MAP_MINIMAP_COLOR_MODES, base.minimap_color),
  };
}

/**
 * What this map draws, resolved least- to most-specific (docs/spec/maps.md §
 * Display Options):
 *
 * 1. {@link DEFAULT_MAP_DISPLAY};
 * 2. the definition's own `display` — the agent-authored half;
 * 3. `project.metadata.map_display[definition.id]` — the human half, and the
 *    only path open to the built-in maps, which have no stored definition to
 *    carry a `display` of their own.
 *
 * The superseded project-wide `metadata.view_card_variant` is deliberately not
 * a layer here: display is per map now, and a project-wide preset that quietly
 * outranked the defaults would mean an old project could never *see* them.
 * The field still parses and round-trips; nothing reads it.
 *
 * Unknown values at any layer fall through to the layer beneath rather than
 * blanking the card. Pure and total: no project, no definition, no problem.
 */
export function resolveMapDisplay(
  definition?: Pick<MapDefinition, "id" | "display">,
  project?: Pick<Project, "metadata">,
): ResolvedMapDisplay {
  let resolved = applyDisplayOptions({ ...DEFAULT_MAP_DISPLAY }, definition?.display);

  const overrides = project?.metadata?.map_display;
  if (definition?.id !== undefined && typeof overrides === "object" && overrides !== null) {
    resolved = applyDisplayOptions(resolved, (overrides as Record<string, unknown>)[definition.id]);
  }

  return resolved;
}

/* --- Product scope (docs/spec/maps.md § Product Scope) -----------------------
 *
 * A map is a *saved projection*, so two product answers can be in play at once:
 * the definition's own `product`, and whatever ambient scope the caller carries
 * (the app's shell scope; nothing at all for the MCP server). The two functions
 * below are the only place the repo decides between them.
 */

/** A stored value that is only a declaration when it is a non-blank string. */
function declared(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * **The product a map reads through — the map's own `product` wins.**
 *
 * A definition's `product` is an explicit, named, stored property of a saved
 * view; `defaultProductId` is an ambient default (the app passes its shell
 * scope; a caller with no ambient scope passes `null`). So the default applies
 * to a map that declares none, and never overrides one that does. A map titled
 * "Admin systems" shows admin whatever the sidebar says, which is the only rule
 * under which its title cannot lie.
 *
 * The two rejected alternatives both break something visible: *default wins*
 * makes a saved map render another product's graph under its own name, and
 * *intersection* renders a saved map as a blank canvas — with no explanation —
 * for every scope but one.
 *
 * The built-in Journey and System maps declare no `product`, so they follow the
 * caller's scope exactly as every other surface does; and a project declaring
 * no products passes `null` here, which filters nothing.
 */
export function mapProductId(
  definition: Pick<MapDefinition, "product"> | undefined | null,
  defaultProductId: string | null = null,
): string | null {
  // Precedence, written once: the definition's own `product`, then the
  // caller's ambient default. Never the other way round.
  return declared(definition?.product) ?? defaultProductId;
}

/**
 * The nodes a map may select from, restricted to {@link mapProductId}.
 *
 * Callers pass the **whole** snapshot: membership for the system layer is
 * derived from consumers, so a pre-filtered node list would resolve a data
 * model against a graph that no longer contains the views reaching it. Status
 * derivation must keep seeing every node too, because an acceptance covering a
 * view is still evidence about that view whichever product the reader is
 * scoped to.
 *
 * {@link computeMapSubgraph} applies this itself, so a map renderer needs it
 * only when it is *not* `computeMapSubgraph` — the app's journey renderer walks
 * its own compose closure and calls this directly.
 */
export function mapScopedNodes<N extends Pick<Node, "id" | "species" | "metadata">>(
  definition: Pick<MapDefinition, "product"> | undefined | null,
  nodes: readonly N[],
  defaultProductId: string | null,
  graph: ProductGraph,
): readonly N[] {
  const productId = mapProductId(definition, defaultProductId);
  if (productId === null) return nodes;
  return nodes.filter((node) => nodeInProduct(node, productId, graph));
}

/** The subgraph a map selects: fresh arrays of the caller's own elements. */
export interface MapSubgraph<N, E> {
  nodes: N[];
  edges: E[];
}

/** How {@link computeMapSubgraph} resolves the product restriction. */
export interface MapSubgraphOptions {
  /**
   * The product to restrict to, **already resolved**: `mapProductId(definition,
   * ambientScope)`. Omit it and the definition's own `product` is used, which is
   * the right answer for every caller that carries no ambient scope. Pass `null`
   * to widen to All products explicitly.
   *
   * This function does not re-resolve what it is given: the precedence rule is
   * `mapProductId`'s, and a caller that has already applied it must not have it
   * applied twice with a different default underneath.
   */
  product?: string | null;
  /**
   * A {@link ProductGraph} over the whole snapshot. Built from `nodes`/`edges`
   * when absent — correct, but a traversal per call, so a caller resolving many
   * maps against one snapshot (`list_maps`) should build one and pass it.
   */
  graph?: ProductGraph;
}

/**
 * The normative selection semantics (docs/spec/maps.md § Subgraph Algorithm),
 * in order:
 *
 * 0. Restrict the candidate nodes to the resolved product (§ Product Scope).
 * 1. Keep nodes whose `species` is in the (defaulted) `species` list.
 * 2. Keep edges whose `edge_type` is in the (defaulted) `edge_types` list and
 *    whose two endpoints both survived step 1.
 * 3. When `root_node_id` resolves to a surviving node: undirected BFS from it
 *    through the surviving edges, bounded by `depth` when present; keep the
 *    visited nodes and the surviving edges among them.
 * 4. An unresolvable root yields the empty subgraph, never an error — the same
 *    posture as `computeChangelog` with an unknown version.
 *
 * **Step 0 is inside this function, and that is the point** (issue #319). The
 * restriction used to be applied by the app before the call, which left every
 * other audience — the MCP server's `get_map` and `list_maps` — serving the
 * unscoped subgraph under a scoped map's name. Defaulting to the definition's
 * own `product` means a new caller gains nothing to get wrong: it has to opt
 * *out* (`{ product: null }`) to see the whole graph, and opting out is a
 * visible decision in the source rather than an omission.
 *
 * Filtering nodes is enough to filter edges — step 2 already drops any edge an
 * endpoint of which did not survive — and the species and edge-type filters
 * compose on top of the restriction unchanged.
 *
 * `nodes` and `edges` are the **whole snapshot**, not a pre-filtered slice:
 * system-layer membership is derived from consumers, so a slice would resolve a
 * data model against a graph missing the views that reach it.
 *
 * Generic over the element types: the app passes full nodes and gets full
 * nodes back; the MCP server passes raw parsed JSON.
 */
export function computeMapSubgraph<
  N extends Pick<Node, "id" | "species" | "metadata">,
  E extends Pick<Edge, "id" | "source_id" | "target_id" | "edge_type">,
>(
  definition: MapDefinition,
  nodes: readonly N[],
  edges: readonly E[],
  options?: MapSubgraphOptions,
): MapSubgraph<N, E> {
  const resolved = resolveMapDefaults(definition);
  const speciesSet = new Set<string>(resolved.species);
  const edgeTypeSet = new Set<string>(resolved.edge_types);

  // Step 0. An omitted `product` falls back to the definition's own declaration;
  // an explicit `null` is All products. The graph is built only when a product
  // is actually in play, so the unscoped path costs nothing it did not before.
  const productId = options?.product !== undefined ? options.product : mapProductId(definition);
  const productGraph =
    productId === null ? undefined : options?.graph ?? buildProductGraph(nodes, edges);
  const selectable =
    productGraph === undefined ? nodes : nodes.filter((node) => nodeInProduct(node, productId, productGraph));

  const keptNodes = selectable.filter((node) => speciesSet.has(node.species));
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = edges.filter(
    (edge) =>
      edgeTypeSet.has(edge.edge_type) && keptNodeIds.has(edge.source_id) && keptNodeIds.has(edge.target_id),
  );

  const rootId = definition.root_node_id;
  if (rootId === undefined) {
    return { nodes: [...keptNodes], edges: [...keptEdges] };
  }
  if (!keptNodeIds.has(rootId)) {
    return { nodes: [], edges: [] };
  }

  // Undirected BFS from the root through the surviving edges, bounded by depth.
  const neighborsByNodeId = new Map<string, string[]>();
  const addNeighbor = (from: string, to: string) => {
    const list = neighborsByNodeId.get(from);
    if (list) list.push(to);
    else neighborsByNodeId.set(from, [to]);
  };
  for (const edge of keptEdges) {
    addNeighbor(edge.source_id, edge.target_id);
    addNeighbor(edge.target_id, edge.source_id);
  }

  const depthLimit = typeof definition.depth === "number" && definition.depth >= 0 ? definition.depth : Infinity;
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  let distance = 0;

  while (frontier.length > 0 && distance < depthLimit) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighborId of neighborsByNodeId.get(nodeId) ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        next.push(neighborId);
      }
    }
    frontier = next;
    distance += 1;
  }

  return {
    nodes: keptNodes.filter((node) => visited.has(node.id)),
    edges: keptEdges.filter((edge) => visited.has(edge.source_id) && visited.has(edge.target_id)),
  };
}

/**
 * Every map the project offers: the built-ins, then the stored definitions from
 * `project.metadata.maps` in stored order. Stored entries that are not objects,
 * lack a string `id`/`title`, or shadow a reserved built-in id are skipped here
 * (the validator reports them as warnings — this function just answers "what
 * can I open?"). Stored definitions with an unrecognized `kind` are included:
 * consumers list them as unrenderable rather than hiding them.
 */
export function listMaps(project: Pick<Project, "metadata">): MapDefinition[] {
  const stored = project.metadata?.maps;
  const storedDefinitions = Array.isArray(stored) ? stored : [];

  const custom = storedDefinitions.filter((definition): definition is MapDefinition => {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) return false;
    const candidate = definition as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return false;
    return !isBuiltInMapId(candidate.id);
  });

  return [...BUILT_IN_MAPS, ...custom];
}

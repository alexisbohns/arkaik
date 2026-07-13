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

/** Known renderer kinds (docs/spec/maps.md § MapDefinition). */
export type MapKind = "journey" | "system";

export const MAP_KINDS: readonly MapKind[] = ["journey", "system"];

/** Layout hints for canvas renderers. Unknown keys round-trip like all format objects. */
export interface MapLayoutHints extends Record<string, unknown> {
  direction?: "DOWN" | "RIGHT" | (string & {});
}

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
  /** Traversal bound from the root; absent = unbounded. */
  depth?: number;
  layout?: MapLayoutHints;
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

/** The subgraph a map selects: fresh arrays of the caller's own elements. */
export interface MapSubgraph<N, E> {
  nodes: N[];
  edges: E[];
}

/**
 * The normative selection semantics (docs/spec/maps.md § Subgraph Algorithm),
 * in order:
 *
 * 1. Keep nodes whose `species` is in the (defaulted) `species` list.
 * 2. Keep edges whose `edge_type` is in the (defaulted) `edge_types` list and
 *    whose two endpoints both survived step 1.
 * 3. When `root_node_id` resolves to a surviving node: undirected BFS from it
 *    through the surviving edges, bounded by `depth` when present; keep the
 *    visited nodes and the surviving edges among them.
 * 4. An unresolvable root yields the empty subgraph, never an error — the same
 *    posture as `computeChangelog` with an unknown version.
 *
 * Generic over the element types: the app passes full nodes and gets full
 * nodes back; the CLI and MCP server pass raw parsed JSON.
 */
export function computeMapSubgraph<
  N extends Pick<Node, "id" | "species">,
  E extends Pick<Edge, "id" | "source_id" | "target_id" | "edge_type">,
>(definition: MapDefinition, nodes: readonly N[], edges: readonly E[]): MapSubgraph<N, E> {
  const resolved = resolveMapDefaults(definition);
  const speciesSet = new Set<string>(resolved.species);
  const edgeTypeSet = new Set<string>(resolved.edge_types);

  const keptNodes = nodes.filter((node) => speciesSet.has(node.species));
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

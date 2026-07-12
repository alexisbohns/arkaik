import type { Node, Edge, ProjectBundle, PlaylistEntry } from "./types";
import { deriveNodeId, edgeId, SPECIES_PREFIXES, type SpeciesId } from "@arkaik/schema";

/**
 * Explicit, ordered Bundle Format migration chain (docs/spec/bundle-format.md
 * § Schema Versioning). Every persisted or imported bundle is run through
 * {@link migrateBundle}, which upgrades it from whatever `schema_version` it
 * declares to {@link CURRENT_SCHEMA_VERSION} by applying each ordered step.
 *
 * Design rules, straight from the spec:
 * - A bundle with no `schema_version` predates versioning ("v0" from the
 *   migration's point of view): it may still carry the legacy
 *   `parent_id`/`sort_order`/`position_*` node fields, so it must pass through
 *   the v0→1 step below. The *format* treats an absent `schema_version` as `1`
 *   (bundle-format.md:33) — which is exactly the state that step produces.
 * - Reading a version newer than we support: import what we understand and
 *   preserve unknown fields on re-export, never strip (bundle-format.md:34).
 *   A version at or above {@link CURRENT_SCHEMA_VERSION} matches no step and is
 *   returned untouched, unknown top-level keys intact.
 * - Each step is a pure data-in / data-out function, independently unit-testable
 *   (tests/data/migrate.test.js).
 */

/** Highest `schema_version` this build knows how to read natively. */
export const CURRENT_SCHEMA_VERSION = 2;

/** A node as it appeared before playlists — the pre-v1 legacy shape. */
type LegacyNode = Node & {
  parent_id?: string | null;
  sort_order?: number;
  position_x?: number;
  position_y?: number;
};

interface Migration {
  /** The `schema_version` this step upgrades from. */
  from: number;
  /** The `schema_version` this step produces. */
  to: number;
  migrate: (bundle: ProjectBundle) => ProjectBundle;
}

/**
 * The migration source version of a bundle: its declared `schema_version`, or
 * `0` when absent (pre-versioning). This is deliberately *not* the format-level
 * interpretation ("absent means 1") — it is the point where the chain starts so
 * that legacy bundles still pass through the v0→1 step.
 */
function migrationSourceVersion(bundle: ProjectBundle): number {
  const declared = (bundle as { schema_version?: unknown }).schema_version;
  return typeof declared === "number" && Number.isFinite(declared) ? declared : 0;
}

/**
 * Step one of the chain (implicit/v0 → 1): the former implicit `normalizeBundle`
 * transform. Legacy bundles encoded flow/view composition with `parent_id` +
 * `sort_order` on the child nodes; v1 encodes it as `metadata.playlist` on the
 * parent flow plus `composes` edges. This strips the legacy node fields, builds
 * the parent playlists in `(sort_order, original index)` order, and backfills
 * any missing `composes` edges. Pure and idempotent: a bundle with no
 * `parent_id` fields passes through structurally unchanged.
 *
 * Unknown top-level keys (and `schema_version` itself) survive via the spread.
 */
function migrateLegacyToV1(bundle: ProjectBundle): ProjectBundle {
  const nodes = bundle.nodes as LegacyNode[];
  const childrenByParent = new Map<string, Array<{ id: string; sort: number; index: number }>>();

  nodes.forEach((node, index) => {
    const parentId = typeof node.parent_id === "string" ? node.parent_id : null;
    if (!parentId) return;
    const children = childrenByParent.get(parentId) ?? [];
    children.push({ id: node.id, sort: node.sort_order ?? Number.MAX_SAFE_INTEGER, index });
    childrenByParent.set(parentId, children);
  });

  const normalizedNodes: Node[] = nodes.map((node) => {
    const rest: LegacyNode = { ...node };
    delete rest.parent_id;
    delete rest.sort_order;
    delete rest.position_x;
    delete rest.position_y;
    return rest;
  });

  const nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
  for (const [parentId, children] of childrenByParent) {
    const parent = nodeMap.get(parentId);
    if (!parent) continue;
    const entries = children
      .sort((a, b) => (a.sort - b.sort) || (a.index - b.index))
      .map((child) => {
        const childNode = nodeMap.get(child.id);
        if (!childNode) return null;
        if (childNode.species === "flow") return { type: "flow", flow_id: child.id } as const;
        if (childNode.species === "view") return { type: "view", view_id: child.id } as const;
        return null;
      })
      .filter((entry): entry is { type: "flow"; flow_id: string } | { type: "view"; view_id: string } => Boolean(entry));
    parent.metadata = {
      ...parent.metadata,
      playlist: {
        entries,
      },
    };
  }

  const composePairs = new Set(
    bundle.edges
      .filter((edge) => edge.edge_type === "composes")
      .map((edge) => `${edge.source_id}:${edge.target_id}`),
  );
  const extraComposeEdges: Edge[] = [];

  for (const legacyNode of nodes) {
    const parentId = typeof legacyNode.parent_id === "string" ? legacyNode.parent_id : null;
    if (!parentId) continue;
    if (!nodeMap.has(parentId)) continue;

    const pair = `${parentId}:${legacyNode.id}`;
    if (composePairs.has(pair)) continue;
    composePairs.add(pair);

    extraComposeEdges.push({
      id: `legacy-compose-${parentId}-${legacyNode.id}`,
      project_id: bundle.project.id,
      source_id: parentId,
      target_id: legacyNode.id,
      edge_type: "composes",
    });
  }

  return {
    ...bundle,
    nodes: normalizedNodes,
    edges: [...bundle.edges, ...extraComposeEdges],
  };
}

/**
 * The exact shape the app's *old* random node-id generator produced:
 * `${SPECIES_PREFIX}${crypto.randomUUID().slice(0, 8)}` — the species prefix
 * followed by exactly 8 lowercase hex digits (issue #215). Only ids matching
 * this are retrofitted; anything else (already-conventional, hand-authored, or
 * semantically-suffixed) is left untouched, which is what keeps this step a
 * byte-for-byte no-op on the already-conformant seeds.
 */
function isRandomLegacyNodeId(id: unknown, species: unknown): boolean {
  if (typeof id !== "string" || typeof species !== "string") return false;
  const prefix = (SPECIES_PREFIXES as Record<string, string | undefined>)[species];
  if (!prefix || !id.startsWith(prefix)) return false;
  return /^[0-9a-f]{8}$/.test(id.slice(prefix.length));
}

/**
 * Rewrite the node-id references inside a playlist (view/flow entries, and
 * recursively into condition branches and junction cases) using `remap`.
 * Returns the *same* array reference when nothing changed so callers can detect
 * a no-op and preserve object identity. Unknown entry fields are preserved via
 * the spread; entries whose ids are not in `remap` pass through untouched.
 */
function remapPlaylistEntries(entries: PlaylistEntry[], remap: Map<string, string>): PlaylistEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.type === "view") {
      const mapped = remap.get(entry.view_id);
      if (mapped) {
        changed = true;
        return { ...entry, view_id: mapped };
      }
      return entry;
    }
    if (entry.type === "flow") {
      const mapped = remap.get(entry.flow_id);
      if (mapped) {
        changed = true;
        return { ...entry, flow_id: mapped };
      }
      return entry;
    }
    if (entry.type === "condition") {
      const ifTrue = Array.isArray(entry.if_true) ? remapPlaylistEntries(entry.if_true, remap) : entry.if_true;
      const ifFalse = Array.isArray(entry.if_false) ? remapPlaylistEntries(entry.if_false, remap) : entry.if_false;
      if (ifTrue !== entry.if_true || ifFalse !== entry.if_false) {
        changed = true;
        return { ...entry, if_true: ifTrue, if_false: ifFalse };
      }
      return entry;
    }
    if (entry.type === "junction") {
      let casesChanged = false;
      const cases = Array.isArray(entry.cases)
        ? entry.cases.map((playlistCase) => {
            const caseEntries = Array.isArray(playlistCase.entries)
              ? remapPlaylistEntries(playlistCase.entries, remap)
              : playlistCase.entries;
            if (caseEntries !== playlistCase.entries) {
              casesChanged = true;
              return { ...playlistCase, entries: caseEntries };
            }
            return playlistCase;
          })
        : entry.cases;
      if (casesChanged) {
        changed = true;
        return { ...entry, cases };
      }
      return entry;
    }
    return entry;
  });
  return changed ? next : entries;
}

/**
 * Step two of the chain (1 → 2): retrofit the app's identifier defects (issue
 * #215, docs/spec/bundle-format.md § Identifier Conventions). Any node id the
 * old app minted as `${prefix}${8 hex}` is rewritten to the deterministic
 * title-derived form; every edge id is normalized to `e-{source}-{target}`
 * (fixing raw-UUID and `legacy-compose-*` ids from the v0→1 step alike). Node
 * renames are propagated *in the same pass* to edge endpoints, edge ids,
 * playlist references, and `project.root_node_id`.
 *
 * Pure, idempotent, and non-destructive: unknown fields survive via spreads;
 * an already-conformant bundle (the seeds) is returned structurally unchanged;
 * a node with no usable title falls back to a stable hash id so it can never
 * collide or dangle. Deliberately does not touch the `journal` (app-side event
 * emission is issue #218) — it is preserved verbatim.
 */
function migrateV1ToV2(bundle: ProjectBundle): ProjectBundle {
  const nodes: Node[] = Array.isArray(bundle.nodes) ? bundle.nodes : [];

  // Reserve the ids we are keeping first, so rewritten ids disambiguate around
  // them; then assign deterministic ids to the random ones in array order.
  const remap = new Map<string, string>();
  const taken = new Set<string>();
  for (const node of nodes) {
    if (!isRandomLegacyNodeId(node.id, node.species)) taken.add(node.id);
  }
  for (const node of nodes) {
    if (!isRandomLegacyNodeId(node.id, node.species)) continue;
    const newId = deriveNodeId(node.species as SpeciesId, node.title ?? "", taken, node.id);
    remap.set(node.id, newId);
    taken.add(newId);
  }

  const nextNodes = nodes.map((node) => {
    const newId = remap.get(node.id) ?? node.id;
    let metadata = node.metadata;
    const playlist = node.metadata?.playlist;
    if (playlist && Array.isArray(playlist.entries)) {
      const nextEntries = remapPlaylistEntries(playlist.entries, remap);
      if (nextEntries !== playlist.entries) {
        metadata = { ...node.metadata, playlist: { ...playlist, entries: nextEntries } };
      }
    }
    if (newId === node.id && metadata === node.metadata) return node;
    return { ...node, id: newId, metadata };
  });

  const edges: Edge[] = Array.isArray(bundle.edges) ? bundle.edges : [];
  const nextEdges = edges.map((edge) => {
    const sourceId = remap.get(edge.source_id) ?? edge.source_id;
    const targetId = remap.get(edge.target_id) ?? edge.target_id;
    const id = edgeId(sourceId, targetId);
    if (sourceId === edge.source_id && targetId === edge.target_id && id === edge.id) return edge;
    return { ...edge, id, source_id: sourceId, target_id: targetId };
  });

  const rootNodeId = bundle.project.root_node_id;
  const nextRootNodeId = rootNodeId && remap.has(rootNodeId) ? remap.get(rootNodeId)! : rootNodeId;
  const nextProject =
    nextRootNodeId === rootNodeId ? bundle.project : { ...bundle.project, root_node_id: nextRootNodeId };

  return { ...bundle, project: nextProject, nodes: nextNodes, edges: nextEdges };
}

/**
 * The ordered chain. Steps are contiguous (each `to` is the next step's `from`)
 * and applied in order from the bundle's source version up to
 * {@link CURRENT_SCHEMA_VERSION}. Append future steps ({ from: 2, to: 3, ... })
 * here — the dispatcher picks up the rest automatically.
 */
const MIGRATIONS: readonly Migration[] = [
  { from: 0, to: 1, migrate: migrateLegacyToV1 },
  { from: 1, to: 2, migrate: migrateV1ToV2 },
];

/**
 * Upgrade a bundle to the current schema version by running each applicable
 * migration step in order. A bundle already at or above the current version is
 * returned untouched (with all unknown fields preserved). Runs on every load,
 * save, and import (`lib/data/local-provider.ts`).
 */
export function migrateBundle(bundle: ProjectBundle): ProjectBundle {
  let current = bundle;
  let version = migrationSourceVersion(bundle);

  for (const step of MIGRATIONS) {
    if (version === step.from) {
      current = step.migrate(current);
      version = step.to;
    }
  }

  return current;
}

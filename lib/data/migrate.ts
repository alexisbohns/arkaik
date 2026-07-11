import type { Node, Edge, ProjectBundle } from "./types";

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
export const CURRENT_SCHEMA_VERSION = 1;

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
 * The ordered chain. Steps are contiguous (each `to` is the next step's `from`)
 * and applied in order from the bundle's source version up to
 * {@link CURRENT_SCHEMA_VERSION}. Append future steps ({ from: 1, to: 2, ... })
 * here — the dispatcher picks up the rest automatically.
 */
const MIGRATIONS: readonly Migration[] = [{ from: 0, to: 1, migrate: migrateLegacyToV1 }];

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

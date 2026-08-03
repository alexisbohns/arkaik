/**
 * The legacy status vocabulary (pre schema_version 3) and its migration.
 *
 * Two ids died in v3: `prioritized` (renamed `backlog`) and `blocked` (now the
 * orthogonal `metadata.blocked_by` flag). Those aliases are unambiguous forever.
 * `backlog` exists in BOTH vocabularies with different meanings (old: someday
 * pile; new: ready to start), so its remap to `idea` is only decidable by the
 * bundle's vintage — that is why {@link migrateStatusVocabulary} is gated on
 * `schema_version` and why the remap order below is load-bearing: old `backlog`
 * moves to `idea` BEFORE `prioritized` becomes the new `backlog`.
 *
 * The journal is deliberately untouched: history is never rewritten
 * (docs/spec/journal.md); validators accept legacy ids in historical events.
 */
import { STATUS_IDS, type StatusId, type PlatformId } from "./ids";
import type { NodeMetadata, Node, PlatformStatusMap, ProjectBundle, Ref } from "./bundle";

export const LEGACY_STATUS_IDS = ["prioritized", "blocked"] as const;
export type LegacyStatusId = (typeof LEGACY_STATUS_IDS)[number];

export const LEGACY_STATUS_ALIASES: Record<LegacyStatusId, StatusId> = {
  prioritized: "backlog",
  blocked: "development",
};

/** The schema_version that introduced the 7-status vocabulary. */
export const STATUS_VOCABULARY_VERSION = 3;

export const BLOCKED_BY_MIGRATION_NOTE = "migrated from legacy blocked status";

/** Current-or-legacy id -> current id; undefined for anything else. */
export function normalizeStatus(value: string): StatusId | undefined {
  if ((STATUS_IDS as readonly string[]).includes(value)) return value as StatusId;
  return LEGACY_STATUS_ALIASES[value as LegacyStatusId];
}

/**
 * The pre-v3 -> v3 remap, applied as ONE lookup per value (never chained, or
 * `prioritized` would ride `backlog`'s rule all the way to `idea`). Listed in
 * the load-bearing order the doc comment above explains: old `backlog` is the
 * someday pile and becomes `idea`; only then does `prioritized` take over the
 * `backlog` id.
 */
const LEGACY_VOCABULARY_REMAP: Readonly<Record<string, StatusId>> = {
  backlog: "idea",
  prioritized: "backlog",
  blocked: "development",
};

function remap(value: string): StatusId | undefined {
  return LEGACY_VOCABULARY_REMAP[value];
}

function migrateNode(node: Node): Node {
  let changed = false;
  let wasBlocked = (node.status as string) === "blocked";

  const mappedStatus = remap(node.status);
  const status = mappedStatus ?? node.status;
  if (mappedStatus !== undefined) changed = true;

  let metadata: NodeMetadata | undefined = node.metadata;

  const platformStatuses = node.metadata?.platformStatuses;
  if (platformStatuses !== undefined) {
    let anyMapped = false;
    const next: PlatformStatusMap = {};
    for (const [platform, value] of Object.entries(platformStatuses) as [PlatformId, StatusId][]) {
      if ((value as string) === "blocked") wasBlocked = true;
      const mapped = remap(value);
      next[platform] = mapped ?? value;
      if (mapped !== undefined) anyMapped = true;
    }
    if (anyMapped) {
      metadata = { ...metadata, platformStatuses: next };
      changed = true;
    }
  }

  const refs = node.metadata?.refs;
  if (Array.isArray(refs)) {
    let anyMapped = false;
    const nextRefs = refs.map((ref: Ref): Ref => {
      if (ref.status_mapped === undefined) return ref;
      const mapped = remap(ref.status_mapped);
      if (mapped === undefined) return ref;
      anyMapped = true;
      return { ...ref, status_mapped: mapped };
    });
    if (anyMapped) {
      metadata = { ...metadata, refs: nextRefs };
      changed = true;
    }
  }

  if (wasBlocked && !metadata?.blocked_by) {
    metadata = { ...metadata, blocked_by: BLOCKED_BY_MIGRATION_NOTE };
    changed = true;
  }

  if (!changed) return node;
  return { ...node, status, ...(metadata !== undefined ? { metadata } : {}) };
}

/**
 * Pure v3 vocabulary migration, gated on the bundle's vintage.
 *
 * A bundle already at `schema_version` >= 3 is returned untouched (same
 * reference) — its `backlog` nodes mean "ready to start" and must not move.
 * Anything older (including an absent `schema_version`, which the format says
 * means 1) gets every node's `status`, `metadata.platformStatuses`, and
 * `metadata.refs[].status_mapped` remapped through the ordered table above,
 * `metadata.blocked_by` stamped where a `blocked` scope was erased (unless the
 * node already carries one), and comes back stamped `schema_version: 3`. The
 * input is never mutated; nodes with nothing to change keep their identity.
 * `journal` is never touched — history keeps its legacy ids.
 */
export function migrateStatusVocabulary(bundle: ProjectBundle): ProjectBundle {
  if (typeof bundle.schema_version === "number" && bundle.schema_version >= STATUS_VOCABULARY_VERSION) {
    return bundle;
  }
  return {
    ...bundle,
    schema_version: STATUS_VOCABULARY_VERSION,
    nodes: bundle.nodes.map(migrateNode),
  };
}

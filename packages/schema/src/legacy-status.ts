/**
 * The legacy status vocabulary (pre schema_version 3) and its migration.
 *
 * Two ids died in v3: `prioritized` (renamed `backlog`) and `blocked` (now the
 * orthogonal `metadata.blocked_by` flag). Those aliases are unambiguous forever,
 * so {@link migrateStatusVocabulary} applies them UNCONDITIONALLY — even a
 * hand-edited v3 file that says `prioritized` means the new `backlog`. `backlog`
 * itself exists in BOTH vocabularies with different meanings (old: someday pile;
 * new: ready to start), so its remap to `idea` is only decidable by the bundle's
 * vintage — that remap alone (and the `schema_version: 3` stamp) is gated on
 * `schema_version` < 3.
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

type StatusRemap = Readonly<Record<string, StatusId | undefined>>;

/**
 * The permanent dead-id aliases, applied whatever the bundle's vintage. Key
 * order is irrelevant — the real invariant is ONE lookup per value, never
 * chained (a chained remap would ride `prioritized` through `backlog`'s pre-v3
 * rule all the way to `idea`).
 */
const LEGACY_ALIAS_REMAP: StatusRemap = { ...LEGACY_STATUS_ALIASES };

/**
 * The full pre-v3 remap: the aliases plus old `backlog` (someday pile) ->
 * `idea` — the one entry only a pre-v3 vintage can justify. Derived from
 * {@link LEGACY_STATUS_ALIASES} so the two tables cannot drift apart.
 */
const LEGACY_VOCABULARY_REMAP: StatusRemap = {
  backlog: "idea",
  ...LEGACY_STATUS_ALIASES,
};

function migrateNode(node: Node, remap: StatusRemap): Node {
  let changed = false;
  let wasBlocked = (node.status as string) === "blocked";

  const mappedStatus = remap[node.status];
  const status = mappedStatus ?? node.status;
  if (mappedStatus !== undefined) changed = true;

  let metadata: NodeMetadata | undefined = node.metadata;

  const platformStatuses = node.metadata?.platformStatuses;
  if (platformStatuses !== undefined) {
    let anyMapped = false;
    const next: PlatformStatusMap = {};
    for (const [platform, value] of Object.entries(platformStatuses) as [PlatformId, StatusId][]) {
      if ((value as string) === "blocked") wasBlocked = true;
      const mapped = remap[value];
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
      const mapped = remap[ref.status_mapped];
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
 * Pure v3 vocabulary migration.
 *
 * The dead-id aliases (`prioritized`, `blocked`) apply UNCONDITIONALLY — they
 * are unambiguous whatever the vintage, so a hand-edited v3 file carrying them
 * is repaired too (with `metadata.blocked_by` stamped where a `blocked` scope
 * was erased, unless the node already carries one). Only the ambiguous half is
 * gated on `schema_version` < 3: old `backlog` (someday pile) -> `idea`, plus
 * the `schema_version: 3` stamp — a v3 bundle's `backlog` means "ready to
 * start" and must not move, and its version is left alone. A v3 bundle with no
 * legacy ids in status positions comes back as the SAME reference. The input
 * is never mutated; nodes with nothing to change keep their identity.
 * `journal` is never touched — history keeps its legacy ids. Every remap is
 * one table lookup, never chained.
 */
export function migrateStatusVocabulary(bundle: ProjectBundle): ProjectBundle {
  const current =
    typeof bundle.schema_version === "number" && bundle.schema_version >= STATUS_VOCABULARY_VERSION;
  const remap = current ? LEGACY_ALIAS_REMAP : LEGACY_VOCABULARY_REMAP;
  const nodes = bundle.nodes.map((node) => migrateNode(node, remap));
  if (current) {
    const untouched = nodes.every((node, i) => node === bundle.nodes[i]);
    return untouched ? bundle : { ...bundle, nodes };
  }
  return { ...bundle, schema_version: STATUS_VOCABULARY_VERSION, nodes };
}

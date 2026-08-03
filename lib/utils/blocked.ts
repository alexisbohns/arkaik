/**
 * The `blocked_by` flag, as pure functions over plain data.
 *
 * `blocked` is not a status: a node is blocked exactly when its
 * `metadata.blocked_by` is non-empty — a node id (rendered as a link where the
 * surface can resolve it) or free text naming the dependency. Absence is the
 * unblocked state, so writers must **remove** the key rather than persist an
 * empty string — the same "absent, never blank" rule `withProductMembership`
 * enforces for product membership (lib/utils/product-editing.ts).
 *
 * Deliberately React-free so the rules stay assertable without a component
 * test runner.
 */

import type { Node, NodeMetadata } from "@/lib/data/types";

/** The blocking reason as it should be read: a trimmed non-empty string, or `undefined`. */
export function blockedByOf(metadata: NodeMetadata | undefined): string | undefined {
  const raw = metadata?.blocked_by;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/** Whether this node is blocked at its current status. */
export function isBlocked(node: Pick<Node, "metadata">): boolean {
  return blockedByOf(node.metadata) !== undefined;
}

/**
 * This node's metadata with its blocking reason set, or **removed**.
 *
 * Removed rather than blanked: absence is the unblocked state, and a stored
 * `blocked_by: ""` would be a slower, invisible spelling of it. A blank or
 * whitespace-only argument is treated exactly as `null`. The rest of the
 * metadata is carried through untouched — a patch replaces `metadata`
 * wholesale, so dropping keys here would take platform statuses, notes and
 * screenshots with it.
 */
export function withBlockedBy(
  metadata: NodeMetadata | undefined,
  blockedBy: string | null,
): NodeMetadata {
  const value = typeof blockedBy === "string" && blockedBy.trim() !== "" ? blockedBy.trim() : null;
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  if (value === null) delete next.blocked_by;
  else next.blocked_by = value;
  return next as NodeMetadata;
}

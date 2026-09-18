"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Node, NodeMetadata } from "@/lib/data/types";
import { normalizeBlockedBy, withBlockedBy } from "@/lib/utils/blocked";

const AUTOSAVE_DELAY_MS = 350;

interface BlockedByFieldProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** For resolving the value to a node title/link; the panel's own node-link affordance. */
  allNodes?: Node[];
  onNavigate?: (node: Node) => void;
  /**
   * The shared latest-metadata base, when the enclosing editor keeps one.
   *
   * `DecisionEditor` does, and must: `onUpdate` is not optimistic, so with a
   * sibling field's save in flight `node.metadata` is stale and a spread from it
   * would silently drop that edit. Passing the ref makes this field the fourth
   * participant in that editor's single write base instead of a fifth writer
   * racing it. Omitted everywhere else, where this is the only metadata writer
   * on screen and `node.metadata` is the whole truth.
   */
  metadataRef?: React.MutableRefObject<NodeMetadata | undefined>;
}

/**
 * What blocks this node, as a debounced free-text field.
 *
 * Extracted out of `NodeFields` because a decision's panel wants it in a
 * different place from every other species': under "Context — why", where the
 * reason a decision is stuck reads as part of its story rather than as chrome
 * above it. `NodeFields` therefore omits it for decisions and `DecisionEditor`
 * renders this instead — one field, two positions, one save path.
 */
export function BlockedByField({ node, onUpdate, allNodes, onNavigate, metadataRef }: BlockedByFieldProps) {
  // Per-mount, because the panel stack keeps hidden panels mounted: two nodes
  // open at once means two "Blocked by" fields in one document, and a
  // hand-written id would point both labels at the first one's input.
  const fieldId = useId();
  const [blockedBy, setBlockedBy] = useState(node.metadata?.blocked_by ?? "");
  const lastSavedRef = useRef(normalizeBlockedBy(node.metadata?.blocked_by) ?? "");

  // Debounced autosave, compared on the NORMALIZED value so whitespace-only
  // edits never fire a no-op wholesale metadata write. `withBlockedBy` owns the
  // "empty means *absent*, never `blocked_by: \"\"`" rule and carries the rest of
  // the metadata through untouched — a patch replaces `metadata` wholesale.
  useEffect(() => {
    const normalized = normalizeBlockedBy(blockedBy) ?? "";
    if (normalized === lastSavedRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      lastSavedRef.current = normalized;
      const base = metadataRef ? metadataRef.current : node.metadata;
      const next = withBlockedBy(base, normalized || null);
      if (metadataRef) metadataRef.current = next;
      void onUpdate?.(node.id, { metadata: next });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [blockedBy, node.id, node.metadata, metadataRef, onUpdate]);

  // When the value names a node this panel can see, surface its title — and
  // navigate through the same affordance every other node link here uses.
  const blockedNode = allNodes?.find((n) => n.id === normalizeBlockedBy(blockedBy));

  return (
    <Field label="Blocked by" htmlFor={`${fieldId}-blocked-by`}>
      <Input
        id={`${fieldId}-blocked-by`}
        value={blockedBy}
        onChange={(event) => setBlockedBy(event.target.value)}
        placeholder="Node id or free text — empty means not blocked"
      />
      {blockedNode &&
        (onNavigate ? (
          <button
            type="button"
            onClick={() => onNavigate(blockedNode)}
            className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline text-left"
          >
            {blockedNode.title}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{blockedNode.title}</span>
        ))}
    </Field>
  );
}

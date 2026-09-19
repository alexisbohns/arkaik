"use client";

import { useMemo } from "react";
import { XIcon } from "lucide-react";

import { RelationLine, RelationRowItem } from "@/components/panels/RelationLine";
import { Button } from "@/components/ui/button";
import type { Node, NodeMetadata } from "@/lib/data/types";
import { blockedByOf, withBlockedBy } from "@/lib/utils/blocked";
import { SPECIES_IDS } from "@arkaik/schema";

/**
 * Every species, because `blocked_by` may name any node.
 *
 * The grammar's own list rather than six strings written out here: a
 * hand-written one stops being true the day a species is added. Read off the
 * frozen module-level constant, which also keeps the combobox's candidate memo
 * — keyed on this array's identity — alive across renders.
 */
const ANY_SPECIES = SPECIES_IDS;

/** No project nodes to search. A module constant, for `ANY_SPECIES`' reason. */
const NO_NODES: Node[] = [];

interface BlockedByFieldProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /**
   * The panel's shared latest-metadata write base, owned by `NodeDetailPanel`.
   *
   * `onUpdate` is not optimistic, so `node.metadata` stays at its pre-write
   * value for the length of a sibling's round trip, and a patch spread from it
   * silently drops that sibling's edit. The sibling is not hypothetical: this
   * line renders on a decision panel, next to `DecisionEditor`, whose Context
   * field saves 350ms after the last keystroke — a pick or an `×` here inside
   * that window reproduces the lost edit. So this reads the ref as its base and
   * writes its result back into it before calling `onUpdate`, the protocol
   * every writer sharing the ref follows.
   *
   * Required, not optional. It was optional once, on the grounds that "this is
   * the only metadata writer on screen" — which the decision panel now
   * falsifies outright, and which was already generous elsewhere, where
   * `ProductSection` and the platform sections patch `metadata` too. Those do
   * not share this base yet; see `NodeDetailPanel` for what does.
   */
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>;
  /** For resolving the value to a node row; the panel's own node-link affordance. */
  allNodes?: Node[];
  onNavigate?: (node: Node) => void;
}

/**
 * What blocks this node — a relation line like any other, and the group's first.
 *
 * It is the relation that changes how the rest of the record reads: a status
 * means something different when something blocks it. It used to sit in
 * `NodeFields`' intro column among the fields that say what the record *is*,
 * and on a decision somewhere else again — `DecisionEditor` rendered its own
 * copy under "Context — why". Both are gone; there is one renderer and one
 * position.
 *
 * **Single-valued, so the `+` is there only while it is empty.** And it is the
 * only line whose combobox offers something that is not a node: `blocked_by` is
 * a free string, so anything typed can be committed as itself ("waiting on
 * legal") — offered alongside the matches rather than instead of them, because
 * the words may be meant as words even where a node answers to them. Nothing a
 * bundle holds today stops being authorable.
 *
 * A combobox pick is a discrete commit, not typing, so there is nothing to
 * debounce and no last-saved value to compare against — the debounced `<Input>`
 * this replaces needed both. What it still needs is the panel's shared write
 * base: a patch replaces `metadata` wholesale, and a discrete commit can land
 * inside a sibling's round trip too. A narrower window than a keystroke stream
 * — a few milliseconds after a sibling's debounce fires, rather than any moment
 * during typing — and one that reproduces. See `metadataRef`.
 *
 * `withBlockedBy` owns the "empty means *absent*, never `blocked_by: \"\"`" rule
 * and carries the rest of the metadata through untouched.
 */
export function BlockedByField({ node, onUpdate, metadataRef, allNodes, onNavigate }: BlockedByFieldProps) {
  const value = blockedByOf(node.metadata);
  const blockedNode = value ? allNodes?.find((candidate) => candidate.id === value) : undefined;
  // Memoised because it is a dependency of the combobox's candidate memo, and
  // that memo fuzzy-scores every node in the project.
  const excludeIds = useMemo(() => [node.id], [node.id]);

  function commit(next: string | null) {
    const metadata = withBlockedBy(metadataRef.current, next);
    metadataRef.current = metadata;
    void onUpdate?.(node.id, { metadata });
  }

  return (
    <RelationLine
      label="Blocked by"
      add={
        onUpdate && !value
          ? {
              counterpartSpecies: ANY_SPECIES,
              allNodes: allNodes ?? NO_NODES,
              // The node itself: nothing blocks on itself, and offering it is
              // the one pick that could never mean anything.
              excludeIds,
              placeholder: "Search nodes, or type a reason...",
              onSelect: (nodeId) => commit(nodeId),
              freeText: {
                render: (query) => <>Blocked by &quot;{query}&quot;</>,
                onCommit: (text) => commit(text),
              },
            }
          : undefined
      }
    >
      {value && (
        <ul className="flex flex-col gap-0.5">
          {blockedNode ? (
            <RelationRowItem
              node={blockedNode}
              onNavigate={onNavigate}
              onRemove={onUpdate && (() => commit(null))}
              removeLabel={`No longer blocked by ${blockedNode.title}`}
            />
          ) : (
            // Free text, or an id this snapshot cannot resolve. Both are the
            // value as written; neither is a node, so neither gets a chip.
            <li className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">{value}</span>
              {onUpdate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Clear what blocks this"
                  onClick={() => commit(null)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </li>
          )}
        </ul>
      )}
    </RelationLine>
  );
}

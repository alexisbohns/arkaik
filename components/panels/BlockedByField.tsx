"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  RelationLine,
  RelationRowItem,
  RemoveButton,
  removeWithUndo,
  RELATION_ROW_GROUP,
} from "@/components/panels/RelationLine";
import { cn } from "@/lib/utils";
import type { Node, NodeMetadata } from "@/lib/data/types";
import { blockedByOf, withBlockedBy } from "@/lib/utils/blocked";
import { SPECIES_IDS } from "@arkaik/schema";

/**
 * Every species, because `blocked_by` may name any node.
 *
 * The grammar's own list rather than six strings written out here: a
 * hand-written one stops being true the day a species is added. Aliased at
 * module level rather than spread at the call site, so the combobox's
 * candidate memo — keyed on this array's identity — stays alive across
 * renders.
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
  // A boolean, not the value being written: every comparison either side of
  // this asks only "is anything in flight". The same shape `CoversSection` and
  // `EdgeRelationLine` use, for the reasons their copies give.
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  /**
   * Write the new value, reporting a failure instead of swallowing it, and
   * answering whether it landed.
   *
   * The answer is what the relation line closes on: `false` keeps it open over
   * the query that produced it, because a toast over a line that already shut
   * and dropped the typed text is a worse account of what happened than no
   * toast at all. The same contract every other line on this panel follows —
   * this one used to discard its promise, which left a rejected write silent,
   * the field live through the round trip, and the combobox's own `busy` guard
   * inert because nothing it awaited ever resolved to `false`.
   *
   * **The gate is the ref, not the state.** `disabled` only reaches the DOM on
   * the next render, and two clicks can land in the same task before React has
   * re-rendered. A suppressed duplicate answers `false` and says nothing: it is
   * the same gesture, not a failed one, so a toast would be the second lie.
   *
   * **The shared base is written optimistically and never rolled back.** A
   * failed write leaves `metadataRef` holding a value nothing persisted, which
   * the next sibling write would carry. That is the protocol every sharer
   * already follows — none of them roll back — and it is the safe half of the
   * trade: writing back only on success would leave a sibling firing inside
   * this round trip spreading a base without this edit, which is the lost edit
   * the ref exists to prevent. Rolling back cannot distinguish its own value
   * from a sibling's that landed meanwhile.
   *
   * **No `useLatest` here, unlike the two edge lines.** Their undo reaches
   * through a ref because the object it calls is a `useMemo` over the edge
   * list, and the render-old one plans against edges from before the write.
   * This one closes over `metadataRef`, which is already a ref and is read at
   * call time, so an undo clicked from a toast writes against the base as it
   * stands then — which is the whole point of that ref.
   */
  async function commit(
    next: string | null,
    failure: string | null = "Couldn't save what blocks this.",
  ): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      const metadata = withBlockedBy(metadataRef.current, next);
      metadataRef.current = metadata;
      await onUpdate?.(node.id, { metadata });
      return true;
    } catch (err) {
      // `null` means the caller speaks for this one — `removeWithUndo`
      // reports a failed undo itself, and two toasts describing one failure is
      // the other way to get that wrong.
      if (failure) toast.error(failure);
      console.error(err);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
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
              disabled: busy,
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
              onRemove={
                onUpdate &&
                (() =>
                  void removeWithUndo({
                    label: blockedNode.title,
                    remove: () => commit(null),
                    // The value as it was, captured before the clear — this
                    // line holds one value rather than a list, so its inverse
                    // is a write-back and not a re-link.
                    restore: () => commit(value, null),
                  }))
              }
              removeDisabled={busy}
              removeLabel={`No longer blocked by ${blockedNode.title}`}
              removeQuestion={`No longer blocked by "${blockedNode.title}"?`}
            />
          ) : (
            // Free text, or an id this snapshot cannot resolve. Both are the
            // value as written; neither is a node, so neither gets a chip.
            // The same hover group and the same `RemoveButton` as
            // `RelationRowItem`: this row is not an entity and so cannot be
            // one, but a `×` that revealed itself differently — or asked on
            // one row and not the other — depending on whether the blocker
            // happens to resolve to a node would be the graph leaking into
            // the interaction.
            <li className={cn(RELATION_ROW_GROUP, "flex items-center gap-1")}>
              <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">{value}</span>
              {onUpdate && (
                <RemoveButton
                  label="Clear what blocks this"
                  question={`No longer blocked by "${value}"?`}
                  disabled={busy}
                  onConfirm={() =>
                    void removeWithUndo({
                      label: value,
                      remove: () => commit(null),
                      restore: () => commit(value, null),
                    })
                  }
                />
              )}
            </li>
          )}
        </ul>
      )}
    </RelationLine>
  );
}

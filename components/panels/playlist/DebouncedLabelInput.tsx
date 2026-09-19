"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

const LABEL_AUTOSAVE_DELAY_MS = 350;

/**
 * One editing session on a playlist label. All four fields have to move
 * together, and they have to be *state* rather than refs, because the
 * adopt-from-outside rule below runs during render — where refs are off limits.
 */
interface LabelDraft {
  /** What the input shows. */
  text: string;
  /** The last label seen coming in from above, so an external *change* is distinguishable from a mere difference against local text. */
  anchor: string;
  /** The last text sent upstream, so its own round-trip is not mistaken for someone else's edit. */
  committed: string;
  /** Whether `text` still owes the store a write. */
  pending: boolean;
}

/**
 * A playlist label field — condition, junction, or junction case — that types
 * locally and persists on a debounce.
 *
 * Every label write here is a **whole-node metadata write**: `onCommit` walks
 * back up to `PlaylistEditor.persistEntries`, which rebuilds
 * `metadata.playlist` and hands the node to `provider.updateNode` — an
 * IndexedDB write locally, an HTTP request on a hosted project. Bound straight
 * to `entry.label`, these Inputs fired one of those per keystroke, and because
 * the controlled value only came back once the async write resolved and
 * `useNodes` re-set state, typed characters visibly reverted and two in-flight
 * remote writes could land out of order. So the text lives here and the write
 * is debounced at 350ms — the same treatment `NodeFields`
 * (NodeDetailPanel.tsx:95-140) and `AcceptanceAuthoredFields`
 * (AcceptanceAuthoredFields.tsx, the gherkin debounce) give the same kind of edit.
 */
export function DebouncedLabelInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (label: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<LabelDraft>({
    text: value,
    anchor: value,
    committed: value,
    pending: false,
  });

  /**
   * The latest draft and the latest `onCommit`, read at fire time — the
   * `nodeRef` pattern from `AcceptanceAuthoredFields`. It matters more here
   * than it does there: `onCommit` rebuilds the whole entries array out of the
   * props of the render that made it, so firing a closure from an older render
   * would write a stale playlist back over a newer one, in the worst case
   * resurrecting an entry deleted in between.
   */
  const draftRef = useRef(draft);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    draftRef.current = draft;
    commitRef.current = onCommit;
  });

  const flush = useCallback(() => {
    const current = draftRef.current;
    if (!current.pending) return;
    draftRef.current = { ...current, committed: current.text, pending: false };
    setDraft(draftRef.current);
    commitRef.current(current.text);
  }, []);

  // Keyed on the text and the pending flag, not on the draft object: an
  // `anchor` bump (below) is bookkeeping about a value that already exists in
  // the store and must not push the write another 350ms out.
  useEffect(() => {
    if (!draft.pending) return;
    const timeout = setTimeout(flush, LABEL_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [draft.text, draft.pending, flush]);

  /**
   * Adopt a label that changed from OUTSIDE — a different entry landing in this
   * row (entries are keyed by index, so the move-up/move-down buttons and a
   * sibling deletion both hand an existing row someone else's data) or another
   * writer touching the same node.
   *
   * The guard that makes this safe is `committed`: the *only* external change
   * that occurs during ordinary typing is this input's own write coming back
   * through the store, and ignoring that echo is precisely what stops the
   * characters-revert bug from returning. Anything else is genuinely a
   * different label, and then the pending edit belongs to whatever used to be
   * in this row — dropping it is the point, not a casualty.
   *
   * Adjusted during render rather than from an effect: this is state derived
   * from a prop change, so an effect would paint the stale text once and then
   * cascade a second render over it — React re-runs this component with the new
   * draft before committing anything to the DOM.
   */
  if (value !== draft.anchor) {
    setDraft(
      value === draft.committed
        ? { ...draft, anchor: value }
        : { text: value, anchor: value, committed: value, pending: false },
    );
  }

  /**
   * Commit on unmount rather than discarding up to 350ms of typing the way
   * `NodeFields` does — a playlist row unmounts on far more than a panel close.
   * Deliberately not `flush`: there is no state left worth updating here, and
   * the write is the only part that still matters. `[]` deps, so it runs once.
   */
  useEffect(() => {
    return () => {
      const current = draftRef.current;
      if (!current.pending) return;
      commitRef.current(current.text);
    };
  }, []);

  return (
    <Input
      value={draft.text}
      onChange={(event) => {
        const next = event.target.value;
        setDraft((current) => ({ ...current, text: next, pending: true }));
      }}
      // Blur commits immediately, which is what keeps the debounce window from
      // outliving the structure it was typed into: clicking Add case, the case
      // delete button, or a move arrow blurs the input first, so the write lands
      // against the entries array the user was actually looking at.
      onBlur={flush}
      aria-label={ariaLabel}
    />
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const LABEL_AUTOSAVE_DELAY_MS = 350;

/**
 * One editing session on a playlist label. All four fields have to move
 * together, and they have to be *state* rather than refs, because the
 * adopt-from-outside rule below runs during render — where refs are off limits.
 */
interface LabelDraft {
  /** What the editable region shows. */
  text: string;
  /** The last label seen coming in from above, so an external *change* is distinguishable from a mere difference against local text. */
  anchor: string;
  /** The last text sent upstream, so its own round-trip is not mistaken for someone else's edit. */
  committed: string;
  /** Whether `text` still owes the store a write. */
  pending: boolean;
}

/**
 * A playlist label — a condition's, a junction's, or a junction case's — edited
 * in place and persisted on a debounce.
 *
 * **A `contentEditable` span, not an `Input`.** These labels sit on the rail
 * beside steps whose own titles are plain text, and a bordered 36px field made
 * every branch row a head taller than the rows above and below it, with its
 * text starting a border and a padding to the right of theirs. The rail's whole
 * job is that a playlist reads as one column of steps; a control that announces
 * "form field" on three of them broke the column into kinds. So the label is
 * the same `text-sm font-medium` as a step's title, lit on hover and on focus
 * rather than boxed all the time — the editable-in-place pattern the node
 * panel's own title and description already use (`NodeFields`), down to the
 * `execCommand` paste and the `empty:before` placeholder.
 *
 * **Uncontrolled, and that is the point.** React must not own the text node: a
 * controlled `contentEditable` re-writes its child on every keystroke and drops
 * the caret to the start. So the DOM holds the text, `draft` mirrors it, and the
 * only writes back into the DOM are the ones `value` forces from outside.
 *
 * Every label write is a **whole-node metadata write**: `onCommit` walks back up
 * to `PlaylistEditor.persistEntries`, which rebuilds `metadata.playlist` and
 * hands the node to `provider.updateNode` — an IndexedDB write locally, an HTTP
 * request on a hosted project. Bound straight to `entry.label`, these fields
 * fired one of those per keystroke, and because the value only came back once
 * the async write resolved and `useNodes` re-set state, typed characters
 * visibly reverted and two in-flight remote writes could land out of order. So
 * the text lives here and the write is debounced at 350ms — the same treatment
 * `NodeFields` and `AcceptanceAuthoredFields` give the same kind of edit.
 */
export function EditableLabel({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (label: string) => void;
  ariaLabel: string;
  /** Shown while the label is empty — the default name for this kind of row. */
  placeholder: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<LabelDraft>({
    text: value,
    anchor: value,
    committed: value,
    pending: false,
  });

  const elRef = useRef<HTMLSpanElement | null>(null);

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
   * that occurs during ordinary typing is this field's own write coming back
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
   * The one place React writes into the DOM node, and it writes only when the
   * two have actually diverged — which, during typing, they never do, because
   * `onInput` copies the DOM's own text into `draft`. So this fires for adopted
   * text and nothing else, and the caret survives every keystroke.
   */
  useEffect(() => {
    const el = elRef.current;
    if (el && el.textContent !== draft.text) el.textContent = draft.text;
  }, [draft.text]);

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

  /**
   * Seeds the text on mount. A ref callback rather than an effect because it
   * runs before paint: an effect would show an empty label — and its
   * placeholder — for one frame every time a panel opens.
   */
  const attach = useCallback((el: HTMLSpanElement | null) => {
    elRef.current = el;
    if (el && el.textContent !== draftRef.current.text) el.textContent = draftRef.current.text;
  }, []);

  return (
    <span
      ref={attach}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      // Driven by the mirror, not by `:empty`. Chrome leaves a `<br>` behind in
      // an emptied `contentEditable`, so the element is never `:empty` and a
      // `empty:before:` placeholder simply never shows. (`NodeFields`'s title
      // and description carry the same rule and the same silence.)
      data-empty={draft.text.trim().length === 0}
      onInput={(event) => {
        const next = event.currentTarget.textContent ?? "";
        setDraft((current) => ({ ...current, text: next, pending: true }));
      }}
      // Blur commits immediately, which is what keeps the debounce window from
      // outliving the structure it was typed into: clicking Add case, a case's
      // delete button, or a move arrow blurs the label first, so the write lands
      // against the entries array the user was actually looking at.
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          // A label is one line. Without this the region takes the newline and
          // the row grows a second line that no schema field can hold.
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          // Back to the last value the store has heard about, not to the anchor:
          // the anchor may be a label this row adopted mid-edit.
          const reverted = { ...draftRef.current, text: draftRef.current.committed, pending: false };
          // The ref FIRST, and synchronously. `blur()` two lines down fires
          // `onBlur` in the same tick, and `flush` reads the ref — which the
          // effect that mirrors `draft` into it would not have updated yet. Set
          // through `setDraft` alone, Escape reverted the text on screen and
          // then committed the abandoned edit anyway.
          draftRef.current = reverted;
          setDraft(reverted);
          event.currentTarget.textContent = reverted.text;
          event.currentTarget.blur();
        }
      }}
      // `contentEditable` pastes markup by default, and a label pasted out of a
      // document would arrive carrying its font. Plain text only — the same
      // `execCommand` the node panel's title uses, deprecated and still the only
      // thing that leaves the undo stack intact.
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
      className={cn(
        "min-w-0 flex-1 cursor-text rounded-sm px-1 py-0.5 -mx-1 text-sm font-medium outline-none",
        "transition-colors hover:bg-muted/60 focus:bg-muted",
        "data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]",
        // Truncated at rest so a long label keeps the row one line like every
        // other, and wrapping once focused so the end of what you are typing is
        // never off the edge.
        "truncate focus:overflow-visible focus:whitespace-pre-wrap focus:break-words",
        className,
      )}
    />
  );
}

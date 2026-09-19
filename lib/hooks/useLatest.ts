"use client";

import { useEffect, useRef } from "react";

/**
 * A ref that always holds the most recent value — for a callback that outlives
 * the render it was created in.
 *
 * **The case that needs it is Undo.** A relation row's `×` builds its undo
 * closure during render and hands it to a toast, which the reader clicks
 * seconds later. By then the write it is undoing has landed and the component
 * has re-rendered, but the closure still holds the render-old `intake` /
 * `relations` object — and those are `useMemo`s over the edge list, so the
 * old one plans against edges that still contain the edge just deleted. Their
 * plan functions are idempotent by design (`planAcceptanceAttach` returns no
 * ops when the anchor is already covered), so the stale object does not write
 * the wrong thing: it writes *nothing*, and Undo silently fails. That is the
 * one outcome worse than no Undo at all, and it is invisible in review — it
 * only shows up by clicking Undo and watching the row not come back, which is
 * how it was found.
 *
 * Assigned in an effect rather than during render: a render-phase ref write is
 * a side effect in render, which React flags and which double-invokes under
 * StrictMode. An effect is late enough for every reader here, all of which run
 * from a user gesture well after commit — and if a reader ever needs the value
 * *during* the same render, it should take it as an argument instead of
 * reaching through a ref.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

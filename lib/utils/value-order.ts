/**
 * The order of an acceptance's `metadata.values` is a claim, not decoration:
 * the first value is the one the author thought of first. The weighing panel
 * lists claimed values in that order, and the order is part of the promise's
 * fingerprint, so a scored cell goes stale when it changes (docs/rfcs/weighing.md).
 * (It no longer sizes the seed: on the reach ruler every claim is guessed at +1.)
 * The value picker used to rebuild the list in the model's canonical order on
 * every change, which made the order the model's and not the author's.
 */

/**
 * The list after a change: what was already chosen keeps its place, a value
 * dropped from `next` leaves, and a value newly in `next` goes last — several at
 * once in the model's canonical order, which is the only order they have.
 */
export function keepClaimOrder<T extends string>(
  selected: readonly T[],
  next: ReadonlySet<T>,
  canonical: readonly T[],
): T[] {
  const already = new Set(selected);
  const kept = selected.filter((id) => next.has(id));
  const added = canonical.filter((id) => next.has(id) && !already.has(id));
  return [...kept, ...added];
}

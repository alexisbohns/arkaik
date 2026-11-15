/**
 * The order of an acceptance's `metadata.values` is a claim, not decoration:
 * the first value is the one the promise is most about, and the weighing layer
 * seeds it at +3, the second at +2 and every other at +1 until somebody scores
 * them (docs/rfcs/weighing.md). The value picker used to rebuild the list in the
 * model's canonical order on every change, which made the order the model's and
 * not the author's — for any acceptance edited in the app, the seed would have
 * read the tier a value sits in instead of what the author meant.
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

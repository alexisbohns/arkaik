import type { Node } from "@/lib/data/types";

/** Case-insensitive match against a node's title and description — the shared
 * text-search predicate of the library and delivery surfaces. */
export function matchesSearch(node: Pick<Node, "title" | "description">, searchQuery: string): boolean {
  if (!searchQuery) return true;
  const haystack = `${node.title} ${node.description ?? ""}`.toLowerCase();
  return haystack.includes(searchQuery.toLowerCase());
}

/**
 * A subsequence score for a typed query against one candidate string: `-1` when
 * the query's characters do not appear in order, otherwise higher is better.
 *
 * Shared because two pickers rank the same graph the same way — the relations
 * and insert-between `NodeSearchCombobox`, and the playlist's Add step list —
 * and a second copy would drift into a second idea of what "best match" means.
 * Pure, so `tests/app/search-score.test.js` loads it without a bundler.
 *
 * The weights: an exact match wins outright; otherwise a run of consecutive
 * characters counts most, matching at the very start is worth a large bonus
 * that tapers off over the first 25 characters, and a long candidate is
 * penalised so that a short exact-ish title beats a long one that merely
 * contains the letters.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const c = candidate.toLowerCase();
  if (c === q) return 10_000;

  let qIndex = 0;
  let consecutive = 0;
  let bestConsecutive = 0;
  let firstMatchIndex = -1;

  for (let i = 0; i < c.length && qIndex < q.length; i += 1) {
    if (c[i] === q[qIndex]) {
      if (firstMatchIndex < 0) firstMatchIndex = i;
      qIndex += 1;
      consecutive += 1;
      bestConsecutive = Math.max(bestConsecutive, consecutive);
      continue;
    }

    consecutive = 0;
  }

  if (qIndex !== q.length) return -1;

  const startBonus = firstMatchIndex === 0 ? 100 : Math.max(0, 25 - firstMatchIndex);
  const lengthPenalty = Math.max(0, c.length - q.length);
  return 300 + bestConsecutive * 20 + startBonus - lengthPenalty;
}

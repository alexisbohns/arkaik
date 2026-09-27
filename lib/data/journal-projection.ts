import type { JournalEvent } from "./types";

/**
 * The `?types=` projection, applied in memory — what the local and seed
 * providers do instead of a `where` clause (`lib/services/graph/etag.ts`
 * parses the same thing for the hosted API).
 *
 * Filtering rather than declining to implement it keeps every backend
 * answering the same question, so a page that asks for four event types gets
 * four event types whether the project lives in Dexie, in the seed sandbox or
 * on the server — and the query cache can key on the projection without
 * asking which backend it will reach. There is no read to save here: the
 * events are already in memory. What it buys is one shape, one contract.
 *
 * Order is preserved: the array is the journal's own order, which the
 * hosted read reproduces with `order by seq asc`.
 */
export function projectJournal(
  events: readonly JournalEvent[],
  types: readonly string[] | null | undefined,
): JournalEvent[] {
  // `[]`, `null` and `undefined` all mean the whole journal — the same rule the
  // query cache's `normalizeJournalTypes` and the server's `parseJournalTypes`
  // apply, so no backend can disagree about what an empty projection means.
  if (types === null || types === undefined || types.length === 0) return [...events];
  const wanted = new Set(types);
  return events.filter((event) => wanted.has(event.type));
}

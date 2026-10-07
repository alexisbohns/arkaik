import { orderEvents, type JournalEvent } from "./journal";

/**
 * Paging a journal newest-first — the History page's read (#429).
 *
 * The order is `orderEvents`' order, reversed: `(ts, id)` descending. Not the
 * hosted `seq`, which is ARRIVAL order — an append minted with an earlier
 * timestamp (a merged PR's deliverable) arrives late but happened early, and
 * History has always shown it where it happened. Event ids are unique within a
 * project, so `(ts, id)` is a total order and a cursor needs nothing else.
 *
 * One implementation of the rules, two places it runs: the local and seed
 * providers page their in-memory journal with {@link pageJournal}, and the
 * hosted route reproduces it in SQL against an index built on the same keys.
 * The route's tests assert the SQL against this function, never against
 * hand-written orders.
 */

/**
 * The History filter's families, by event-type prefix. A type no family claims
 * — `quality.*`, `journal.baseline`, a forward-compatible type — appears only
 * in the unfiltered read, as it always has.
 */
export const JOURNAL_FAMILIES = {
  nodes: ["node."],
  edges: ["edge."],
  decisions: ["decision."],
  delivery: ["release.", "deliverable."],
  intake: ["idea.", "request."],
  refs: ["ref."],
} as const satisfies Record<string, readonly string[]>;

export type JournalFamilyId = keyof typeof JOURNAL_FAMILIES;

export function isJournalFamilyId(value: string): value is JournalFamilyId {
  return Object.prototype.hasOwnProperty.call(JOURNAL_FAMILIES, value);
}

/** The prefixes a set of families admits; `null` (no filter) for none. */
export function journalFamilyPrefixes(families: readonly JournalFamilyId[] | null | undefined): string[] | null {
  if (!families || families.length === 0) return null;
  return families.flatMap((family) => [...JOURNAL_FAMILIES[family]]);
}

export const JOURNAL_PAGE_DEFAULT_LIMIT = 100;
export const JOURNAL_PAGE_MAX_LIMIT = 500;

/** A position in the newest-first order: the last event a page returned. */
export interface JournalCursor {
  ts: string;
  id: string;
}

/**
 * The cursor keys of an event, exactly as `orderEvents` sorts them: a missing
 * or non-string `ts` (or `id`) sorts as the empty string.
 */
export function journalCursorOf(event: { ts?: unknown; id?: unknown }): JournalCursor {
  return {
    ts: typeof event.ts === "string" ? event.ts : "",
    id: typeof event.id === "string" ? event.id : "",
  };
}

/** Longest `ts` or `id` a cursor may carry — far past any real one. */
const MAX_CURSOR_PART = 256;

/** `[ts, id]` as JSON: opaque to a caller, and a URL query parameter encodes it. */
export function formatJournalCursor(cursor: JournalCursor): string {
  return JSON.stringify([cursor.ts, cursor.id]);
}

/** The cursor a page handed out, or `null` for anything that is not one. */
export function parseJournalCursor(value: string): JournalCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [ts, id] = parsed;
  if (typeof ts !== "string" || typeof id !== "string") return null;
  if (ts.length > MAX_CURSOR_PART || id.length > MAX_CURSOR_PART) return null;
  return { ts, id };
}

/** Strictly older than the cursor in `(ts, id)` order — what "the next page" means. */
function olderThan(key: JournalCursor, cursor: JournalCursor): boolean {
  return key.ts < cursor.ts || (key.ts === cursor.ts && key.id < cursor.id);
}

export interface JournalPage {
  /** Newest first. */
  events: JournalEvent[];
  /** The cursor for the page after this one, or `null` when this is the last. */
  next: string | null;
}

export interface JournalPageOptions {
  /** Start strictly after this position; `null`/absent for the newest event. */
  before?: JournalCursor | null;
  limit: number;
  /** Only events in these families; `null`/absent/`[]` for every event. */
  families?: readonly JournalFamilyId[] | null;
}

/** One page of a journal held in memory, newest first. */
export function pageJournal(events: readonly JournalEvent[], options: JournalPageOptions): JournalPage {
  const prefixes = journalFamilyPrefixes(options.families);
  const before = options.before ?? null;
  const candidates = orderEvents(events)
    .reverse()
    .filter((event) => prefixes === null || prefixes.some((prefix) => event.type.startsWith(prefix)))
    .filter((event) => before === null || olderThan(journalCursorOf(event), before));
  const page = candidates.slice(0, options.limit);
  const next = candidates.length > options.limit && page.length > 0
    ? formatJournalCursor(journalCursorOf(page[page.length - 1]))
    : null;
  return { events: page, next };
}

import {
  JOURNAL_PAGE_DEFAULT_LIMIT,
  JOURNAL_PAGE_MAX_LIMIT,
  isJournalFamilyId,
  parseJournalCursor,
  type JournalCursor,
  type JournalFamilyId,
} from "@arkaik/schema";

/** What `GET …/journal/page` was asked for, canonicalized. */
export interface JournalPageQuery {
  before: JournalCursor | null;
  /** The raw cursor string, kept for the page ETag. */
  beforeRaw: string | null;
  limit: number;
  /** Deduped and sorted, or `null` for every event. */
  families: JournalFamilyId[] | null;
}

export type ParsedJournalPageQuery = { ok: true; query: JournalPageQuery } | { ok: false; error: string };

/**
 * `?before=&limit=&families=` for the paged journal read.
 *
 * Everything fails CLOSED, unlike `?types=`: an unknown family is a typo in a
 * closed vocabulary of six, not a forward-compatible type, and answering it
 * with every event would look like a filter that worked. A cursor this server
 * never minted is refused rather than guessed at, and a limit outside
 * 1..JOURNAL_PAGE_MAX_LIMIT is refused rather than clamped — a clamp would
 * hand back a page shorter or longer than the caller sized its view for.
 *
 * `families` takes the same forgiving shape as `?types=` (repeatable,
 * comma-separated, trimmed) and is canonicalized the same way, so the page
 * ETag cannot tell two spellings of one filter apart.
 */
export function parseJournalPageQuery(searchParams: URLSearchParams): ParsedJournalPageQuery {
  const beforeRaw = searchParams.get("before");
  let before: JournalCursor | null = null;
  if (beforeRaw !== null) {
    before = parseJournalCursor(beforeRaw);
    if (before === null) return { ok: false, error: "invalid_cursor" };
  }

  const limitRaw = searchParams.get("limit");
  let limit = JOURNAL_PAGE_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d{1,4}$/.test(limitRaw)) return { ok: false, error: "invalid_limit" };
    limit = Number(limitRaw);
    if (limit < 1 || limit > JOURNAL_PAGE_MAX_LIMIT) return { ok: false, error: "invalid_limit" };
  }

  const seen = new Set<JournalFamilyId>();
  for (const value of searchParams.getAll("families")) {
    for (const token of value.split(",")) {
      const trimmed = token.trim();
      if (trimmed.length === 0) continue;
      if (!isJournalFamilyId(trimmed)) return { ok: false, error: "invalid_families" };
      seen.add(trimmed);
    }
  }
  const families = seen.size === 0 ? null : [...seen].sort();

  return { ok: true, query: { before, beforeRaw, limit, families } };
}

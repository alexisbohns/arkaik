import { journalPageEtag } from "@/lib/services/graph/etag";
import { parseJournalPageQuery, type JournalPageQuery } from "@/lib/services/graph/journal-page-query";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { getJournalPage } from "@/lib/services/graph/store";

/**
 * GET /api/graph/projects/{projectId}/journal/page?before=&limit=&families= —
 * `{ page: { events, next } }`, newest first in `(ts, id)` order.
 *
 * The History page's read (#429): one page at a time instead of the whole
 * journal. `next` is the cursor to send back as `before` for the page after
 * this one, `null` on the last. `families` filters by the History chips'
 * type prefixes (`JOURNAL_FAMILIES` in @arkaik/schema). Every parameter fails
 * closed — see `parseJournalPageQuery`.
 *
 * The validator is the journal's plus a tag for the page (`journalPageEtag`):
 * any append moves every page, because a new event shifts what every
 * newest-first page holds.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute(
  "journal page",
  "page",
  (projectId, ownerIds, query: JournalPageQuery) => getJournalPage(projectId, ownerIds, query),
  journalPageEtag,
  (req) => {
    const parsed = parseJournalPageQuery(new URL(req.url).searchParams);
    return parsed.ok ? { ok: true, options: parsed.query } : { ok: false, error: parsed.error };
  },
);

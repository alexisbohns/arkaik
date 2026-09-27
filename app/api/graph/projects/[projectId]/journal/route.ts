import { journalEtag, parseJournalTypes } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { getJournal } from "@/lib/services/graph/store";

/**
 * GET /api/graph/projects/{projectId}/journal — events in server order,
 * optionally projected to a set of types (`?types=a,b` or `?types=a&types=b`;
 * docs/spec/services.md § Hosted Graph Projects → Read contract).
 *
 * The ETag stays the WHOLE journal's validator, whatever the projection: one
 * aggregate per project rather than one per projection, at the cost of
 * invalidating a typed read when an event it does not carry is appended. A
 * superfluous 200 is cheap; a missed one would leave a page showing history
 * that no longer exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute(
  "journal",
  "journal",
  getJournal,
  journalEtag,
  (req) => {
    const parsed = parseJournalTypes(new URL(req.url).searchParams);
    return parsed.ok ? { ok: true, options: { types: parsed.types } } : { ok: false, error: parsed.error };
  },
);

import { journalEtag } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { getJournalStats } from "@/lib/services/graph/store";

/**
 * GET /api/graph/projects/{projectId}/journal/stats —
 * `{ stats: { total, releases: [{ version, eventCount }] } }`.
 *
 * The Overview's journal aggregate (#429): the event total and each release's
 * changelog size, so the project's landing page no longer downloads the whole
 * journal to count it. Counted by the same @arkaik/schema projection the
 * browser ran (see `getJournalStats`).
 *
 * The journal's validator, unchanged: the body moves exactly when the journal
 * does — an append changes the total, and a platform-scoped release's count
 * reads node platforms, which only a version bump can change.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("journal stats", "stats", getJournalStats, journalEtag);

import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { ifNoneMatchSatisfied, pollenEtag, readResponseHeaders } from "@/lib/services/graph/etag";
import { loadPollenHead, loadPollenSource, pollenEventExists } from "@/lib/services/graph/store";
import { journalToPollen, POLLEN_SOURCE_TYPES } from "@/lib/pollen/map";

/**
 * GET /api/graph/projects/{projectId}/pollen?after=<id>&limit=<n>
 *
 * The arkaik adapter's report verb (ariko docs/POLLEN.md § Report, HTTP
 * transport): this project's journal, projected to pollen envelopes, in the
 * journal's server order. Opt-in — a project without
 * `project.metadata.pollen.plant` serves the same 404 as a project that does
 * not exist, so the feed cannot be used to probe for ids either.
 *
 * Not `graphReadRoute` because the contract needs two things it doesn't have:
 * query-parameter paging and the 410-Gone cursor reset.
 *
 * What a poll costs (issue #490). Every answer, 200 or 304, carries the weak
 * validator `pollenEtag` — the journal's version + event count plus a tag for
 * this page's `after`/`limit`. A consumer that sends it back as
 * `If-None-Match` and finds nothing new gets a bodiless 304 from the auth
 * queries, ONE validator statement (which also reads the plant slug) and one
 * index lookup for its cursor: no bundle, no journal rows. A 200 loads only
 * what the projection reads — node `{ id, title }` pairs and the events of
 * the three projected types — never the whole bundle or the whole journal.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/** Pollen ids are `arkaik:<journal event id>` (lib/pollen/map.ts). */
const POLLEN_ID_PREFIX = "arkaik:";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:read")) {
    return Response.json({ error: "insufficient_scope", required: "graph:read" }, { status: 403 });
  }

  const { projectId } = await params;
  const url = new URL(req.url);
  const after = url.searchParams.get("after");
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    // Validators + plant in one owner-scoped statement. Taken FIRST, so the
    // ETag stamped on the body can only be older than the body — the safe
    // direction (one extra 200 later, never a 304 over an event the consumer
    // has not seen). `loadPollenHead` says why the plant rides along.
    const head = await loadPollenHead(projectId, caller.ownerIds);
    if (!head) return Response.json({ error: "not_found" }, { status: 404 });
    if (!head.plant) {
      // Feed not enabled — indistinguishable from no project.
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const etag = pollenEtag(head.validators, { after, limit });

    // Unknown cursor → 410: the consumer drops its cursor and rebuilds from
    // the start (docs/POLLEN.md § Report). Happens legitimately after a
    // bundle restore replaced the journal. Checked BEFORE the conditional
    // answer so that `If-None-Match: *` cannot turn a gone cursor into a
    // "nothing new" — a 410 is not a representation to be unmodified from.
    if (after !== null) {
      const eventId = after.startsWith(POLLEN_ID_PREFIX) ? after.slice(POLLEN_ID_PREFIX.length) : null;
      if (eventId === null || !(await pollenEventExists(projectId, eventId, POLLEN_SOURCE_TYPES))) {
        return Response.json({ error: "unknown_cursor" }, { status: 410 });
      }
    }

    if (ifNoneMatchSatisfied(req.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: readResponseHeaders(etag) });
    }

    const { titles, events } = await loadPollenSource(projectId, POLLEN_SOURCE_TYPES);
    const { pollen, skipped } = journalToPollen(events, titles, { plant: head.plant });
    for (const s of skipped) {
      console.warn(`[pollen] ${projectId}: skipped event ${s.id}: ${s.reason}`);
    }

    let start = 0;
    if (after !== null) {
      const index = pollen.findIndex((p) => p.id === after);
      // The row exists (checked above) but its envelope was skipped by the
      // validator: the feed never served this id, so it is unknown here too.
      if (index === -1) return Response.json({ error: "unknown_cursor" }, { status: 410 });
      start = index + 1;
    }
    return Response.json(
      { pollen: pollen.slice(start, start + limit) },
      { status: 200, headers: readResponseHeaders(etag) },
    );
  } catch (err) {
    console.error("[pollen] GET feed failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to load pollen feed." }, { status: 500 });
  }
}

import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { getJournal, getProject } from "@/lib/services/graph/store";
import { journalToPollen } from "@/lib/pollen/map";

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
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

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
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const plant = found.bundle.project.metadata?.pollen?.plant;
    if (typeof plant !== "string" || !plant) {
      // Feed not enabled — indistinguishable from no project.
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const events = (await getJournal(projectId, caller.ownerIds)) ?? [];
    const { pollen, skipped } = journalToPollen(events, found.bundle.nodes, { plant });
    for (const s of skipped) {
      console.warn(`[pollen] ${projectId}: skipped event ${s.id}: ${s.reason}`);
    }

    let start = 0;
    if (after !== null) {
      const index = pollen.findIndex((p) => p.id === after);
      // Unknown cursor → 410: the consumer drops its cursor and rebuilds from
      // the start (docs/POLLEN.md § Report). Happens legitimately after a
      // bundle restore replaced the journal.
      if (index === -1) return Response.json({ error: "unknown_cursor" }, { status: 410 });
      start = index + 1;
    }
    return Response.json({ pollen: pollen.slice(start, start + limit) }, { status: 200 });
  } catch (err) {
    console.error("[pollen] GET feed failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to load pollen feed." }, { status: 500 });
  }
}

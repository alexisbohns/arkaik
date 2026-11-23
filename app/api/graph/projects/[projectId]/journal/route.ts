import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { journalEtag, parseJournalTypes } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { appendJournalEvents, getJournal, getProject } from "@/lib/services/graph/store";
import { parseBacklogEventInputs, planBacklogEvents, type Node } from "@arkaik/schema";

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

/** A few signals, each a title and a quote: 256 KB is far more than a legal batch weighs. */
const MAX_BACKLOG_BODY_BYTES = 256 * 1024;

/**
 * `POST` — append backlog events: `idea.proposed` and `request.filed`, and
 * nothing else. They are the journal-only events (`file_request`,
 * `propose_idea`): no graph change stands behind them, so `/mutations`, which
 * derives its events from the ops it applies, cannot carry them.
 *
 * Here rather than a `backlog/events` sibling of `quality/events` and
 * `weighing/events`: those are named for the section they fold into, and a
 * backlog event folds into no section — it IS a journal entry, and reads back
 * through the GET above (and `get_backlog`'s projection of it).
 *
 * Built like `weighing/events`: `graph:write`, a body cap before parsing, a
 * typed parser (a 400 on shape), then a planner (`planBacklogEvents`, the zod
 * schema every writer uses, plus the dangling-`node_id` check the bundle
 * validator makes) whose refusal is a 422 naming each entry's `index`. All or
 * nothing. The envelope — `id`, `ts`, `actor` — is stamped here and refused
 * from the body; the actor says what acted (`arkaik-agent` for a token,
 * `arkaik-app` for a session), as on the mutations route.
 *
 * Unlocked, like its siblings: the journal is append-only, the snapshot is
 * never touched, and two concurrent filings are two signals either way. The
 * append still waits out a whole-bundle restore (`appendJournalEvents`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BACKLOG_BODY_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BACKLOG_BODY_BYTES }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const inputs = parseBacklogEventInputs(body);
  if (!Array.isArray(inputs)) {
    return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });
  }

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const actor = caller.via === "token" ? "arkaik-agent" : "arkaik-app";
    const nodes = (found.bundle as { nodes?: Node[] }).nodes ?? [];

    const plan = planBacklogEvents(nodes, inputs, { actor });
    if (!plan.ok) {
      const message = plan.refusals.map((r) => `entry ${r.index}: ${r.reason} — ${r.detail}`).join("; ");
      return Response.json({ error: "refused", message, refusals: plan.refusals }, { status: 422 });
    }

    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, actor);
    if (!result.ok) {
      if (result.reason === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    }

    return Response.json({ events: plan.events, warnings: plan.warnings }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST journal failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append journal events." }, { status: 500 });
  }
}

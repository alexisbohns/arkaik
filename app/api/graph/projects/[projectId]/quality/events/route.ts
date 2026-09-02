import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { appendJournalEvents, getProject, qualityFindingEvents } from "@/lib/services/graph/store";
import { parseQualityEventInputs, planQualityEvents } from "@/lib/services/graph/quality-events";
import type { QualitySection } from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the hosted, events-only write path for Kritik findings (issue
 * #400, part 2 of the stack).
 *
 * A batch of `{ type, finding_id, resolved_by? | reason }` entries, each
 * either `quality.finding.resolved` or `quality.finding.accepted` — nothing
 * else. That whitelist is the point: this route is not a general
 * event-append surface (the journal `GET` stays read-only), it is the one
 * place a caller with `graph:write` can record a Kritik decision on a
 * project that has no checkout for `arkaik kritik finding resolve` or
 * `accept` to run against.
 *
 * `snapshot.quality` is NEVER mutated here — same doctrine as the GitHub
 * App's resolution pass in `lib/services/github/quality.ts`. A finding's
 * stored `status` stays exactly as the last audit left it; what changes is
 * the journal, and `foldFindingEvents` is what makes the decision visible on
 * the next `GET`. Refusals are per-finding (`unknown_finding`, `not_open`,
 * both checked post-fold by `planQualityEvents`) but the batch is
 * all-or-nothing, mirroring `persistMutation`: one refusal anywhere refuses
 * every entry, so a caller never has to reason about a partial write.
 *
 * Issue #392's bundle-shape concern does not apply here: this route never
 * accepts a bundle or a `PUT`, only a small typed events array, so there is
 * no snapshot payload for that concern to be about.
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

  // Read as text first so the size check runs BEFORE `JSON.parse` ever
  // touches the payload, against the same shared cap as every other
  // bundle-accepting route (app/api/graph/projects/[projectId]/route.ts's
  // PATCH is the sibling this pattern is copied from).
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const inputs = parseQualityEventInputs(body);
  if (!Array.isArray(inputs)) {
    return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });
  }

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const section = (found.bundle as { quality?: QualitySection }).quality;
    const priorEvents = await qualityFindingEvents(projectId, caller.ownerIds);
    const plan = planQualityEvents(section, priorEvents, inputs, "arkaik-agent");
    if (!plan.ok) {
      return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
    }

    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, "arkaik-agent");
    if (!result.ok) {
      return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    }

    return Response.json({ events: plan.events }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST quality events failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append quality events." }, { status: 500 });
  }
}

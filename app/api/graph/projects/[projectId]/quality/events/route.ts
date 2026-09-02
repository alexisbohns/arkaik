import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { appendJournalEvents, getProject, qualityFindingEvents } from "@/lib/services/graph/store";
import { parseQualityEventInputs, planQualityEvents, requiredScopeFor } from "@/lib/services/graph/quality-events";
import type { QualitySection } from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the hosted, events-only write path for Kritik findings (issue
 * #400, part 2 of the stack).
 *
 * A batch of typed entries, each one of exactly three whitelisted types —
 * `quality.finding.resolved`, `quality.finding.accepted`, or
 * `quality.signal.tripped` (issue #406) — and nothing else. That whitelist is
 * the point: this route is not a general event-append surface (the journal
 * `GET` stays read-only), it is the one place a caller can record a Kritik
 * decision, or a Kritik observation, on a project that has no checkout for
 * `arkaik kritik finding resolve`, `accept` or `trip-signal` to run against.
 *
 * **The scope guard is asymmetric.** `graph:write` may send all three.
 * `quality:append` alone may send only a trip: a trip decides nothing, so it
 * can overwrite no verdict, which is exactly why a narrower credential can be
 * trusted with it. A `quality:append`-only caller that sends a finding
 * decision gets a 403 naming `graph:write`. That asymmetry is the whole
 * feature — it is what lets a nightly workflow in a PUBLIC repository hold a
 * token that can append an observation and do nothing else: no graph reads,
 * no graph writes, no finding decisions.
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
  // Pre-parse, this can only ask whether the caller could POST here at all.
  // The broad scope stays the one named for the broad ask: a caller holding
  // neither is being told what a full-powered request to this route needs.
  if (!hasScope(caller, "graph:write") && !hasScope(caller, "quality:append")) {
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

  // Stricter than the schema on one field: a trip sent through THIS route must
  // carry the `commit` it observed. The schema leaves `commit` optional
  // because it describes every trip in every mode, and a repo-mode trip has
  // no obligation to anchor — but the caller class this route exists for is a
  // CI job, which pays nothing for the anchor (`GITHUB_SHA` is ambient). A
  // missing `commit` is a shape error, so it lands here as a 400, not as a
  // 422 refusal: the caller sent something malformed, not something the graph
  // declined.
  const inputs = parseQualityEventInputs(body);
  if (!Array.isArray(inputs)) {
    return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });
  }

  // Post-parse, because the answer depends on the event types — which is also
  // why this cannot be folded into the guard above.
  const required = requiredScopeFor(inputs);
  if (!hasScope(caller, required)) {
    return Response.json({ error: "insufficient_scope", required }, { status: 403 });
  }

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    // The audit trail records what acted, not just who: an agent's writes are
    // distinguishable from the same person's edits in the browser. Mirrors
    // the mutations route (app/api/graph/projects/[projectId]/mutations/route.ts) —
    // `getCaller` grants `graph:write` to both token (agent) and session
    // (browser) callers, so the route, not the pure core, is what knows which
    // one this request actually is.
    const actor = caller.via === "token" ? "arkaik-agent" : "arkaik-app";

    const section = (found.bundle as { quality?: QualitySection }).quality;
    const priorEvents = await qualityFindingEvents(projectId, caller.ownerIds);
    // Deliberately unlocked. The journal is append-only and `snapshot.quality`
    // is never touched here, and `foldFindingEvents` folds events in seq
    // order, first-decision-wins: if two concurrent batches both decide the
    // same finding, whichever event lands first in the journal is the one
    // every later read honors, and the later batch's event — though it does
    // get appended — is inert from then on, the same outcome a lock would
    // have produced by refusing it outright. No row lock buys anything a
    // lock-free append-and-fold doesn't already give for free.
    const plan = planQualityEvents(section, priorEvents, inputs, actor);
    if (!plan.ok) {
      return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
    }

    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, actor);
    if (!result.ok) {
      return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    }

    return Response.json({ events: plan.events }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST quality events failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append quality events." }, { status: 500 });
  }
}

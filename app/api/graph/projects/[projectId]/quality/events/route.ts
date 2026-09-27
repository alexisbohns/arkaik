import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { QUALITY_FOLD_TYPES, appendJournalEvents, getProject, qualityEventsOfTypes } from "@/lib/services/graph/store";
import {
  callerMaySendQualityEvents,
  parseQualityEventInputs,
  planQualityEvents,
  requiredScopeFor,
} from "@/lib/services/graph/quality-events";
import type { QualitySection } from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the hosted, events-only write path for Kritik findings and hosted
 * scores (issue #400, part 2 of the stack; scoring added by issue #473).
 *
 * A batch of typed entries, each one of exactly five whitelisted types —
 * `quality.finding.resolved`, `quality.finding.accepted`,
 * `quality.signal.tripped` (issue #406), `quality.assessment.scored` and a
 * scoped `quality.audit.completed` (issue #473) — and nothing else. That
 * whitelist is the point: this route is not a general event-append surface
 * (the journal `GET` stays read-only), it is the one place a caller can
 * record a Kritik decision, a Kritik observation, or hosted assessment
 * progress, on a project that has no checkout for `arkaik kritik finding
 * resolve`, `accept`, `trip-signal` or `score` to run against. The first
 * three are decisions or observations, unchanged from #400/#406; the last two
 * are assessment state — a hosted re-score of one cell, and the scoped
 * re-audit's completion — and both are checked against the scope the server
 * itself derives from the journal, never trusted from the caller: a hosted
 * score can only land in a cell a resolved finding made stale, and a
 * completion's `scores`/`counts` are computed here (`planQualityEvents`,
 * `deriveQualityMatrix`), never accepted on the wire.
 *
 * **The scope guard is asymmetric.** `graph:write` may send all five.
 * `quality:append` alone may send only a trip: a trip decides nothing, so it
 * can overwrite no verdict, which is exactly why a narrower credential can be
 * trusted with it. A `quality:append`-only caller that sends a finding
 * decision, a score, or a completion gets a 403 naming `graph:write`. That
 * asymmetry is the whole feature — it is what lets a nightly workflow in a
 * PUBLIC repository hold a token that can append an observation and do
 * nothing else: no graph reads, no graph writes, no finding decisions, no
 * scores.
 *
 * `snapshot.quality` is NEVER mutated here — same doctrine as the GitHub
 * App's resolution pass in `lib/services/github/quality.ts`. A finding's
 * stored `status` stays exactly as the last audit left it, and a cell's
 * stored `level` stays exactly what the last audit scored it; what changes is
 * the journal, and `foldQualityEvents` is what makes a decision or a hosted
 * score visible on the next `GET`. Refusals are per-entry (`index`, plus
 * `finding_id` for the two decision reasons — see
 * `QualityEventRefusal`) but the batch is all-or-nothing, mirroring
 * `persistMutation`: one refusal anywhere refuses every entry, so a caller
 * never has to reason about a partial write.
 *
 * **The baseline is written once, here, on the fly.** A restored project
 * carries an audit's assessments and findings but no recorded
 * `quality.audit.completed` for it (issue #472) — until the first hosted
 * score would otherwise overwrite a level nothing has read yet. That score's
 * batch also plans a backdated baseline recording (`planQualityEvents`,
 * `implicitAuditBaseline`), first in the plan, so every reader from then on
 * has a real reading to measure the scope and the trend from.
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
  //
  // `requiredScopeFor` returns the NARROWEST scope that suffices, not the only
  // one that does — `callerMaySendQualityEvents` is where that subsumption
  // lives, so the rule is tested rather than trusted.
  if (!callerMaySendQualityEvents(caller.scopes, inputs)) {
    return Response.json({ error: "insufficient_scope", required: requiredScopeFor(inputs) }, { status: 403 });
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
    // `planQualityEvents` needs more than the fold types now: a hosted score
    // is checked against the scope `deriveAuditScope` measures from the
    // newest recorded `quality.audit.completed`, so that type has to be in
    // `priorEvents` too, alongside `QUALITY_FOLD_TYPES` — `foldQualityEvents`
    // does not fold `quality.audit.completed` into `section.assessments` at
    // all, so without it here the scope would always read as "no baseline".
    const priorEvents = await qualityEventsOfTypes(projectId, caller.ownerIds, [
      ...QUALITY_FOLD_TYPES,
      "quality.audit.completed",
    ]);
    // Deliberately unlocked. The journal is append-only and `snapshot.quality`
    // is never touched here, and `foldQualityEvents` folds events in seq
    // order, first-decision-wins: if two concurrent batches both decide the
    // same finding, whichever event lands first in the journal is the one
    // every later read honors, and the later batch's event — though it does
    // get appended — is inert from then on, the same outcome a lock would
    // have produced by refusing it outright. No row lock buys anything a
    // lock-free append-and-fold doesn't already give for free.
    //
    // A hosted score adds one more race to that story, and it is inert in the
    // COMMON case only — not in every case.
    //
    // Common case, inert: two concurrent FIRST scores measured from the same
    // prior journal (in particular, the same already-recorded decisions) each
    // find no baseline yet and each plan one. Both synthesize
    // `implicitAuditBaseline` from the same untouched stored section and the
    // same prior decisions, so the two rows differ only in their own envelope
    // id — same `audit_id`, same `ts`, same `scores`/`counts`. Every reader
    // that matters keys on `audit_id`, not on how many rows carry it:
    // `recordedAuditIds` (packages/schema/src/quality-scope.ts) dedupes by
    // `audit_id`, and `deriveQualityTrend` (quality-trend.ts) replays into a
    // `Map` keyed by `audit_id` — "the same `audit_id` recorded twice … the
    // latest wins and the earlier snapshot is dropped." Since the two rows
    // agree on everything but their id, whichever one "wins" is indistinguishable
    // from the other, and `deriveAuditScope`'s `since_ts` is the same either way.
    //
    // Exception, not inert: `implicitAuditBaseline`'s `ts` is backdated to the
    // audit's own newest assessment when that resolves, else to just before
    // the FIRST decision each caller's own view of the journal knows about.
    // Two concurrent batches that each bring their own first-ever resolution
    // (no prior decision, and an assessment whose `ts` doesn't resolve) each
    // see only their own resolution as "first" and stamp their baseline from
    // it — two different `ts`, and two different `scores`/`counts` (each
    // reopens only the finding IT resolved). `deriveQualityTrend`'s
    // latest-wins keeps whichever row sorts later, discarding the other's
    // reading outright — and because the surviving baseline is dated after
    // its own resolution but possibly after the OTHER batch's resolution too,
    // the scope measured from it can read that other fix as pre-baseline and
    // drop it from the re-audit window.
    //
    // Also not locked: a score racing a scoped completion (or two concurrent
    // completions of the same audit) can record a `quality.audit.completed`
    // reading computed from a `working` snapshot that does not yet include
    // the other request's write, so the recorded history undercounts. The
    // damage is bounded to that recorded snapshot, not to what the product
    // reads live: every `GET` still folds the full journal on the way out
    // (`foldQualityEvents`), so the missing score is never invisible, only
    // absent from that one historical row.
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

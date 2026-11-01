import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { parseScreenshotEntries, planScreenshots } from "@/lib/services/graph/screenshots";
import { applyMutation, getProject, type StoreFailure } from "@/lib/services/graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-read and re-plan this many times on a version conflict before giving up with 409. */
const MAX_ATTEMPTS = 3;

/**
 * `POST` — the screenshot door (spec 2026-11-01 § 3): *here is a screenshot
 * of this node on this platform, from this commit*, and nothing else.
 *
 * The live door's shape, for the same reason: the producer is a CI job
 * holding a credential in a public repository's secrets, so the scope it
 * needs (`screenshot:append`) opens this route alone. It cannot read the
 * graph, cannot move a status, and can only fill a slot on a view or an
 * acceptance for a platform it lists. A leaked token can post a picture.
 *
 * The decision is `planScreenshots` (DB-free), which defers to
 * `decideScreenshot` — the same function `applyOps` runs under the lock, so
 * the plan and the write agree. The plan is computed from a read outside the
 * lock, so a version conflict re-reads and re-plans up to three times; the
 * plan is idempotent (`unchanged`, `stale_order`), so a retry can only
 * converge. Skips are a 200 with nothing written; one refusal refuses the
 * whole batch with a 422 naming each entry's `index` and `reason`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write") && !hasScope(caller, "screenshot:append")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

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
  const entries = parseScreenshotEntries(body);
  if (!Array.isArray(entries)) {
    return Response.json({ error: "invalid_entries", message: entries.error }, { status: 400 });
  }

  const actor = caller.via === "token" ? "arkaik-ci" : "arkaik-app";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const found = await getProject(projectId, caller.ownerIds);
      if (!found) return Response.json({ error: "not_found" }, { status: 404 });

      const plan = planScreenshots(found.bundle.nodes, entries);
      if (!plan.ok) {
        return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
      }
      if (plan.ops.length === 0) {
        // Every entry was a skip: a re-run or an out-of-order run. Nothing to write, 200.
        return Response.json(
          { version: found.version, applied: [], skipped: plan.skipped, events: [] },
          { status: 200, headers: { ETag: `"${found.version}"` } },
        );
      }

      const result = await applyMutation({
        projectId,
        ownerIds: caller.ownerIds,
        ops: plan.ops,
        actor,
        // Fills slots on existing nodes, never adds an entity: a CI job must
        // not fail on a tier cap it cannot act on (as the live door).
        tier: "klub",
        expectedVersion: found.version,
      });

      if (result.ok) {
        return Response.json(
          { version: result.version, applied: plan.applied, skipped: plan.skipped, events: result.events },
          { status: 200, headers: { ETag: `"${result.version}"` } },
        );
      }
      if (result.reason === "conflict" && attempt < MAX_ATTEMPTS) continue;
      return failureResponse(result);
    }
    throw new Error("unreachable: the last attempt always returns");
  } catch (err) {
    console.error("[graph] POST screenshots failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to record screenshots." }, { status: 500 });
  }
}

/**
 * A store failure as the response the mutations route gives for it. No
 * `default`: a new `StoreFailure` reason is a type error here (TS2366), not a
 * silent fall-through.
 */
function failureResponse(result: StoreFailure): Response {
  switch (result.reason) {
    case "conflict":
      return Response.json(
        { error: "version_conflict", version: result.version },
        { status: 409, headers: { ETag: `"${result.version}"` } },
      );
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "validation":
      return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
    case "mutation":
      return Response.json({ error: "mutation_refused", code: result.code, message: result.message }, { status: 422 });
    case "limit":
      return Response.json(
        { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
        { status: 403 },
      );
  }
}

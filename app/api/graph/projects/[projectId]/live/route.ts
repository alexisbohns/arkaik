import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { parseLiveEntries, planLive } from "@/lib/services/graph/live";
import { applyMutation, getProject, getUserTier } from "@/lib/services/graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the deployment door (issue #424): *this acceptance reached `live`
 * on this platform*, and nothing else.
 *
 * This is the last hop of the delivery lifecycle, the one no repository event
 * marks: web goes live when the production deploy succeeds, iOS and Android
 * when a store accepts a build, days after the merge. The signals all live in
 * CI, and CI is where a broad credential must not go — so this route is what
 * `release:append` opens, the way `quality:append` opens `…/quality/events`:
 * a token that can read nothing, move a status nowhere but `live`, touch
 * nothing but an acceptance, and must name the platform. A caller holding
 * neither `graph:write` nor `release:append` gets a 403 naming the broad
 * scope, as on the quality route.
 *
 * The decision is `planLive` (lib/services/graph/live.ts, DB-free); the write
 * is `applyMutation`, so the row lock, the validators, the entity limits and
 * the version bump all apply unchanged and the journal gets an ordinary
 * `node.status_changed` carrying `platform`, the entry's `detail` (stamped by
 * the store from the plan's annotations) and an actor the journal can tell
 * apart: `arkaik-ci` for a token, `arkaik-app` for a session.
 *
 * **The plan is computed from a read outside the lock.** The patch replaces
 * `metadata` wholesale, so a concurrent edit between our read and our write
 * would be clobbered. `applyMutation` is therefore called with the version we
 * read as `expectedVersion`, and a conflict re-reads and re-plans, up to
 * three times — the plan is idempotent (`already_live`), so a retry can only
 * ever converge. The webhook and the mutations route accept the same hazard
 * without the retry; this route's callers are unattended jobs, which is why
 * it does not.
 */
const MAX_ATTEMPTS = 3;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write") && !hasScope(caller, "release:append")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  // Size before parse, against the shared cap, as on every other write route.
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
  const entries = parseLiveEntries(body);
  if (!Array.isArray(entries)) {
    return Response.json({ error: "invalid_entries", message: entries.error }, { status: 400 });
  }

  const actor = caller.via === "token" ? "arkaik-ci" : "arkaik-app";

  try {
    const tier = await getUserTier(caller.userId);
    for (let attempt = 1; ; attempt++) {
      const found = await getProject(projectId, caller.ownerIds);
      if (!found) return Response.json({ error: "not_found" }, { status: 404 });

      const plan = planLive(found.bundle.nodes, entries);
      if (!plan.ok) {
        return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
      }
      if (plan.ops.length === 0) {
        // Every entry was already live: a re-run. Nothing to write, 200.
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
        tier,
        expectedVersion: found.version,
        annotations: plan.annotations,
      });

      if (result.ok) {
        return Response.json(
          { version: result.version, applied: plan.applied, skipped: plan.skipped, events: result.events },
          { status: 200, headers: { ETag: `"${result.version}"` } },
        );
      }
      switch (result.reason) {
        case "conflict":
          if (attempt < MAX_ATTEMPTS) continue;
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
  } catch (err) {
    console.error("[graph] POST live failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to mark live." }, { status: 500 });
  }
}

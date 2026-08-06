import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { createProject, getUserTier, listProjects } from "@/lib/services/graph/store";

/**
 * Hosted graph projects — collection (docs/spec/services.md § Hosted Graph
 * Projects; db/migrations/008_graph_projects.sql).
 *
 * `getCaller` accepts a browser session OR an agent's bearer token, so the app
 * and a CLI reach the same store through one code path. Every query filters on
 * `caller.ownerIds`; a token's list is exactly one owner, which is deliberately
 * narrower than a session's.
 *
 * Node runtime for the `pg` driver; force-dynamic because every response
 * depends on the caller.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/graph/projects — the caller's hosted projects. */
export async function GET(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:read")) {
    return Response.json({ error: "insufficient_scope", required: "graph:read" }, { status: 403 });
  }

  try {
    return Response.json({ projects: await listProjects(caller.ownerIds) }, { status: 200 });
  } catch (err) {
    console.error("[graph] GET projects failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to list projects." }, { status: 500 });
  }
}

/**
 * POST /api/graph/projects — create a hosted project from a full bundle.
 *
 * The body is a `ProjectBundle`, so "create empty" and "import existing" are the
 * same operation and neither can produce a project that has never been
 * validated. The journal, if present, is stored verbatim.
 */
export async function POST(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const tier = await getUserTier(caller.userId);
    const result = await createProject({ ownerId: caller.ownerIds[0], tier, bundle });

    if (!result.ok) {
      if (result.reason === "validation") {
        return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
      }
      if (result.reason === "limit") {
        return Response.json(
          { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
          { status: 403 },
        );
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    return Response.json({ id: result.id, version: result.version }, { status: 201 });
  } catch (err) {
    console.error("[graph] POST project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to create project." }, { status: 500 });
  }
}

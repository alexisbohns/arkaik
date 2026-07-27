import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { archiveProject, getProject, updateProjectFields } from "@/lib/services/graph/store";
import type { Project } from "@arkaik/schema";

/**
 * A single hosted project (db/migrations/008_graph_projects.sql).
 *
 * A project belonging to another owner is indistinguishable from one that does
 * not exist — both 404 — so these endpoints cannot be used to probe for ids.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — snapshot + version. The version is also returned as an `ETag`, which is
 * what a client passes back as `If-Match` on a mutation to say "only if nothing
 * moved since I read this".
 */
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

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(
      { bundle: found.bundle, version: found.version },
      { status: 200, headers: { ETag: `"${found.version}"` } },
    );
  } catch (err) {
    console.error("[graph] GET project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to load project." }, { status: 500 });
  }
}

/**
 * PATCH — project-level fields only (title, description, version, metadata).
 *
 * Deliberately cannot touch nodes or edges: the graph has exactly one write
 * path, `POST .../mutations`, so there is no second route that could skip the
 * validator gate or the journal.
 */
export async function PATCH(
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

  let body: { project?: unknown };
  try {
    body = (await req.json()) as { project?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.project !== "object" || body.project === null || Array.isArray(body.project)) {
    return Response.json({ error: "invalid_project" }, { status: 400 });
  }

  try {
    const result = await updateProjectFields(projectId, caller.ownerIds, body.project as Partial<Project>);
    if (!result.ok) {
      if (result.reason === "validation") {
        return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ version: result.version }, { status: 200, headers: { ETag: `"${result.version}"` } });
  } catch (err) {
    console.error("[graph] PATCH project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to update project." }, { status: 500 });
  }
}

/** DELETE — archive (soft). History is kept; the project leaves listings. */
export async function DELETE(
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

  try {
    const archived = await archiveProject(projectId, caller.ownerIds);
    if (!archived) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[graph] DELETE project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to archive project." }, { status: 500 });
  }
}

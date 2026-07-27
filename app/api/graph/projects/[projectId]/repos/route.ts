import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { linkRepo, listRepoLinks, unlinkRepo } from "@/lib/services/graph/repos";

/**
 * Repository links for a hosted project (db/migrations/009_project_repos.sql).
 *
 * These rows are what the GitHub webhook resolves a delivery against, so
 * without this endpoint the PR-transition feature has no reachable state and
 * silently does nothing.
 *
 * DELETE takes the repo as a QUERY parameter rather than a path segment: a
 * repository name contains a slash, and encoding one into a dynamic segment is
 * the kind of detail that works until some proxy normalises it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const links = await listRepoLinks(projectId, caller.ownerIds);
    if (links === null) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ repos: links }, { status: 200 });
  } catch (err) {
    console.error("[graph] GET repos failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST — link a repo, or change the platform of an existing link. */
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

  let body: { repo_full_name?: unknown; platform?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.repo_full_name !== "string") {
    return Response.json({ error: "invalid_repo", message: "`repo_full_name` must be \"owner/name\"." }, { status: 400 });
  }
  const platform =
    body.platform === undefined || body.platform === null || body.platform === ""
      ? null
      : String(body.platform);

  try {
    const result = await linkRepo(projectId, caller.ownerIds, {
      repoFullName: body.repo_full_name,
      platform,
    });
    if (!result.ok) {
      if (result.reason === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json(
        {
          error: result.reason,
          message:
            result.reason === "invalid_repo"
              ? 'Expected "owner/name".'
              : "Platform must be web, ios, android, or omitted.",
        },
        { status: 400 },
      );
    }
    return Response.json({ repo: result.link }, { status: 201 });
  } catch (err) {
    console.error("[graph] POST repos failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** DELETE ?repo=owner/name — remove a link. */
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
  const repo = new URL(req.url).searchParams.get("repo");
  if (!repo) return Response.json({ error: "invalid_repo", message: "`?repo=owner/name` is required." }, { status: 400 });

  try {
    const removed = await unlinkRepo(projectId, caller.ownerIds, repo);
    if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[graph] DELETE repos failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

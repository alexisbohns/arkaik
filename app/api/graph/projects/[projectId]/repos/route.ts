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
 * the kind of detail that works until some proxy normalises it. `path` is a
 * query parameter for the same reason and more so — `apps/ios` is nothing BUT
 * slashes, and a link is identified by (repo, path) since
 * db/migrations/010_repo_path_prefix.sql, so both halves of the identity have
 * to travel the same way.
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

  let body: { repo_full_name?: unknown; platform?: unknown; path?: unknown };
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
  // An absent path means the WHOLE repository, which is what every link written
  // before path scoping existed already means — so an old client keeps working
  // unchanged and gets exactly the row it used to get.
  if (body.path !== undefined && body.path !== null && typeof body.path !== "string") {
    return Response.json(
      { error: "invalid_path", message: "`path` must be a string, e.g. \"apps/ios\"." },
      { status: 400 },
    );
  }
  const path = typeof body.path === "string" ? body.path : "";

  try {
    const result = await linkRepo(projectId, caller.ownerIds, {
      repoFullName: body.repo_full_name,
      platform,
      pathPrefix: path,
    });
    if (!result.ok) {
      if (result.reason === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json(
        {
          error: result.reason,
          message:
            result.reason === "invalid_repo"
              ? 'Expected "owner/name".'
              : result.reason === "invalid_path"
                ? 'A path must name a directory inside the repository, e.g. "apps/ios". ".." segments are not allowed.'
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

/**
 * DELETE ?repo=owner/name[&path=apps/ios] — remove ONE link.
 *
 * An absent `path` means the whole-repository link, exactly as it does on POST,
 * and NOT "every link for this repository". Deleting more than was asked fails
 * silently here — the extra links stop promoting and nothing says so until a
 * merge quietly does nothing — while deleting too few is a visible 404 that
 * names the prefixes that do exist.
 */
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
  const params_ = new URL(req.url).searchParams;
  const repo = params_.get("repo");
  if (!repo) return Response.json({ error: "invalid_repo", message: "`?repo=owner/name` is required." }, { status: 400 });
  const path = params_.get("path") ?? "";

  try {
    const removed = await unlinkRepo(projectId, caller.ownerIds, repo, path);
    if (!removed) {
      // The payoff of the non-destructive default: someone who guessed the
      // wrong half of the identity is told what the other rows are, instead of
      // being left to wonder whether the link exists at all.
      const links = (await listRepoLinks(projectId, caller.ownerIds)) ?? [];
      const siblings = links
        .filter((link) => link.repoFullName === repo.trim().toLowerCase())
        .map((link) => (link.pathPrefix === "" ? "(whole repository)" : link.pathPrefix));
      return Response.json(
        {
          error: "not_found",
          message:
            siblings.length > 0
              ? `No link for ${repo} at ${path === "" ? "the whole repository" : `"${path}"`}. Linked paths: ${siblings.join(", ")}.`
              : `No link for ${repo}.`,
        },
        { status: 404 },
      );
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[graph] DELETE repos failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

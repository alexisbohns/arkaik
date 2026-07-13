import { getSession } from "@/lib/services/auth";
import {
  BUNDLE_SHA256_HEADER,
  deleteProject,
  putBackup,
  servicesConfigured,
  servicesUnavailable,
} from "@/lib/services/synk";

/**
 * PUT    /api/synk/projects/{projectId} — store a backup version of the bundle,
 *        or dedupe it (docs/spec/services.md § Synk → Backup protocol).
 * DELETE /api/synk/projects/{projectId} — remove the project and all its backups.
 *
 * Both are session-guarded and user-scoped: every persisted row carries the
 * caller's user id and every query filters on it (§ "Authorization is by
 * ownership"). Node runtime for the `pg` driver; force-dynamic because the
 * response depends on the session cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  // Parse the JSON body. Malformed JSON is a syntactic error → 400.
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  // Advisory canonical hash the client MAY send to skip re-work (§ dedupe).
  const clientHash = req.headers.get(BUNDLE_SHA256_HEADER);

  try {
    const result = await putBackup({ userId, projectId, input, clientHash });
    switch (result.status) {
      case "invalid":
        return Response.json({ error: "validation_failed", findings: result.findings }, { status: 422 });
      case "limit":
        return Response.json(
          { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
          { status: 403 },
        );
      case "deduped":
        return Response.json({ deduped: true }, { status: 200 });
      case "stored":
        return Response.json({ id: result.backupId, deduped: false }, { status: 201 });
    }
  } catch (err) {
    console.error("[synk] PUT backup failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to store backup." },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  try {
    const deleted = await deleteProject(userId, projectId);
    if (!deleted) {
      return Response.json({ error: "not_found", message: "Project not found." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[synk] DELETE project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to delete project." },
      { status: 500 },
    );
  }
}

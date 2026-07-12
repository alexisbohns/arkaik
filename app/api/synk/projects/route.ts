import { getSession } from "@/lib/services/auth";
import { listProjects, servicesConfigured, servicesUnavailable } from "@/lib/services/synk";

/**
 * GET /api/synk/projects — list the caller's backed-up projects, each with its
 * latest backup metadata (docs/spec/services.md § Synk → Backup protocol).
 *
 * Session-guarded and user-scoped: the listing is filtered by the session's
 * user id, so a caller can only ever see their own projects (§ "Authorization is
 * by ownership"). Node runtime for the `pg` driver; force-dynamic because the
 * response depends on the request's session cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const projects = await listProjects(userId);
    return Response.json({ projects }, { status: 200 });
  } catch (err) {
    console.error("[synk] GET projects failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to list projects." },
      { status: 500 },
    );
  }
}

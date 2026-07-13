import { getSession } from "@/lib/services/auth";
import { listBackups, servicesConfigured, servicesUnavailable } from "@/lib/services/synk";

/**
 * GET /api/synk/projects/{projectId}/backups — list the retained backup
 * versions of one project (id, created_at, size, content hash), newest first
 * (docs/spec/services.md § Synk → Backup protocol).
 *
 * Session-guarded and user-scoped: the query filters on the session's user id,
 * so requesting another user's project id yields an empty list, never their
 * rows (§ "Authorization is by ownership"). Node runtime for the `pg` driver.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, { params }: Context): Promise<Response> {
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
    const backups = await listBackups(userId, projectId);
    return Response.json({ backups }, { status: 200 });
  } catch (err) {
    console.error("[synk] GET backups failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to list backups." },
      { status: 500 },
    );
  }
}

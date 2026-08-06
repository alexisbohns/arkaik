import { getCaller, hasScope } from "@/lib/services/auth";
import { listBackups, servicesConfigured, servicesUnavailable } from "@/lib/services/synk";

/**
 * GET /api/synk/projects/{projectId}/backups — list the retained backup
 * versions of one project (id, created_at, size, content hash), newest first
 * (docs/spec/services.md § Synk → Backup protocol).
 *
 * Session or `synk`-scoped bearer token, via the same `getCaller` seam as the
 * rest of Synk (see `app/api/synk/projects/route.ts`). User-scoped either way:
 * the query filters on the acting user id, so requesting another user's project
 * id yields an empty list, never their rows (§ "Authorization is by
 * ownership"). Node runtime for the `pg` driver.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const caller = await getCaller(req);
  if (!caller) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasScope(caller, "synk")) {
    return Response.json({ error: "insufficient_scope", required: "synk" }, { status: 403 });
  }

  const { projectId } = await params;

  try {
    const backups = await listBackups(caller.userId, projectId);
    return Response.json({ backups }, { status: 200 });
  } catch (err) {
    console.error("[synk] GET backups failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to list backups." },
      { status: 500 },
    );
  }
}

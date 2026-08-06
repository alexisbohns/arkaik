import { getCaller, hasScope } from "@/lib/services/auth";
import { getBackupBundle, servicesConfigured, servicesUnavailable } from "@/lib/services/synk";

/**
 * GET /api/synk/backups/{backupId} — return the stored bundle JSON for a backup
 * so the client can restore it (docs/spec/services.md § Synk → Backup protocol).
 *
 * Session or `synk`-scoped bearer token, via the same `getCaller` seam as the
 * rest of Synk (see `app/api/synk/projects/route.ts`). User-scoped either way:
 * the lookup is filtered by the acting user id, so a backup id owned by another
 * user is indistinguishable from a missing one — 404 either way (§
 * "Authorization is by ownership"; § Security & Privacy → "The client never
 * receives another user's rows"). Node runtime for `pg`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ backupId: string }> };

export async function GET(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const caller = await getCaller(req);
  if (!caller) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasScope(caller, "synk")) {
    return Response.json({ error: "insufficient_scope", required: "synk" }, { status: 403 });
  }

  const { backupId } = await params;

  try {
    const bundle = await getBackupBundle(caller.userId, backupId);
    if (bundle === null) {
      return Response.json({ error: "not_found", message: "Backup not found." }, { status: 404 });
    }
    // Verbatim stored bundle (journal included — it is the user's private data).
    return Response.json(bundle, { status: 200 });
  } catch (err) {
    console.error("[synk] GET backup failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to fetch backup." },
      { status: 500 },
    );
  }
}

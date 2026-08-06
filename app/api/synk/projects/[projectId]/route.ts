import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES } from "@/lib/services/db";
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
 * Both accept a browser session OR a bearer token carrying the `synk` scope, via
 * the same `getCaller` seam the hosted graph routes use — see
 * `app/api/synk/projects/route.ts` for why that scope was inert until these
 * handlers stopped calling `getSession()` directly.
 *
 * User-scoped either way: every persisted row carries the acting user id and
 * every query filters on it (§ "Authorization is by ownership"). Node runtime
 * for the `pg` driver; force-dynamic because the response depends on the
 * request's credentials.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const caller = await getCaller(req);
  if (!caller) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasScope(caller, "synk")) {
    return Response.json({ error: "insufficient_scope", required: "synk" }, { status: 403 });
  }

  const { projectId } = await params;

  // Size cap first, against the shared `MAX_BUNDLE_BYTES`, so `JSON.parse`
  // never touches an unbounded payload — the same read-text-then-check order
  // `POST /api/publik` and the graph routes use. Synk's tier limit counts
  // ENTITIES (250 on the free floor), which bounds how many nodes a backup
  // holds and not how many bytes each one carries: without this, one node with
  // megabytes of metadata was stored per retained version.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json(
      {
        error: "payload_too_large",
        message: `Bundle exceeds the ${MAX_BUNDLE_BYTES} byte limit.`,
      },
      { status: 413 },
    );
  }

  // Parse the JSON body. Malformed JSON is a syntactic error → 400.
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  // Advisory canonical hash the client MAY send to skip re-work (§ dedupe).
  const clientHash = req.headers.get(BUNDLE_SHA256_HEADER);

  try {
    const result = await putBackup({ userId: caller.userId, projectId, input, clientHash });
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

export async function DELETE(req: Request, { params }: Context): Promise<Response> {
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
    const deleted = await deleteProject(caller.userId, projectId);
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

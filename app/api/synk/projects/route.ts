import { getCaller, hasScope } from "@/lib/services/auth";
import { listProjects, servicesConfigured, servicesUnavailable } from "@/lib/services/synk";

/**
 * GET /api/synk/projects — list the caller's backed-up projects, each with its
 * latest backup metadata (docs/spec/services.md § Synk → Backup protocol).
 *
 * `getCaller` accepts a browser session OR a bearer token carrying the `synk`
 * scope, the same dual path the hosted graph routes use. That scope has been in
 * `TOKEN_SCOPES` — and mintable from the settings UI — since tokens shipped, but
 * while these handlers called `getSession()` directly it authenticated nowhere:
 * graph routes refused it for insufficient scope and Synk 401'd it for carrying
 * no cookie. Routing through `getCaller` is what makes the credential real.
 *
 * User-scoped either way: every Synk row carries `user_id` and `verifyToken`
 * resolves one, so the listing is filtered by the acting user and a caller can
 * only ever see their own projects (§ "Authorization is by ownership"). Node
 * runtime for the `pg` driver; force-dynamic because the response depends on the
 * request's credentials.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const caller = await getCaller(req);
  if (!caller) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasScope(caller, "synk")) {
    return Response.json({ error: "insufficient_scope", required: "synk" }, { status: 403 });
  }

  try {
    const projects = await listProjects(caller.userId);
    return Response.json({ projects }, { status: 200 });
  } catch (err) {
    console.error("[synk] GET projects failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to list projects." },
      { status: 500 },
    );
  }
}

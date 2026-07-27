import "server-only";

import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";

/**
 * The shared body of every read-only graph route (nodes, edges, journal,
 * export). All four differ only in which loader they call and what key the
 * result is returned under, so the guard chain — services configured, caller
 * resolved, `graph:read` held, project owned — lives here once instead of being
 * copy-pasted four times and drifting.
 */
export function graphReadRoute<T>(
  label: string,
  key: string,
  load: (projectId: string, ownerIds: readonly string[]) => Promise<T | null>,
) {
  return async function GET(
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
      const result = await load(projectId, caller.ownerIds);
      // null means "not yours or not there" — the same 404 either way, so this
      // cannot be used to probe for project ids.
      if (result === null) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({ [key]: result }, { status: 200 });
    } catch (err) {
      console.error(`[graph] GET ${label} failed:`, err instanceof Error ? err.message : "unknown error");
      return Response.json({ error: "internal_error", message: `Failed to load ${label}.` }, { status: 500 });
    }
  };
}

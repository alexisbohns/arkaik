import "server-only";

import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { ifNoneMatchSatisfied, readResponseHeaders } from "@/lib/services/graph/etag";
import { loadValidators, type ProjectValidators } from "@/lib/services/graph/store";

/**
 * The shared body of every read-only graph route (nodes, edges, journal,
 * export). All four differ only in which loader they call, what key the
 * result is returned under and which validators make up their ETag, so the
 * guard chain — services configured, caller resolved, `graph:read` held,
 * project owned — and the conditional-GET flow live here once instead of
 * being copy-pasted four times and drifting.
 *
 * ── The conditional flow (docs/spec/services.md § Hosted Graph Projects →
 * Read contract) ────────────────────────────────────────────────────────────
 * A request carrying `If-None-Match` pays the auth queries plus ONE
 * validator statement; when the header matches, the answer is a bodiless 304
 * and no snapshot ever leaves Postgres. Otherwise the body is loaded and the
 * 200's ETag is derived from the validators THAT load returned — the same
 * statement as the body for the snapshot routes, the statement just before
 * it for the journal — never from the earlier check, which would stamp a
 * possibly-newer validator on an older body.
 *
 * The validator check runs only when the header is present: an unconditional
 * read (the CLI, the MCP remote store) gets its validators from the body
 * load for free, and never sees a 304.
 */
export function graphReadRoute<K extends string, T, O = undefined>(
  label: string,
  key: K,
  load: (
    projectId: string,
    ownerIds: readonly string[],
    options: O,
  ) => Promise<(Record<K, T> & { validators: ProjectValidators }) | null>,
  etagFor: (validators: ProjectValidators) => string,
  /**
   * Reads the loader's options off the request — the `?types=` projection, and
   * only the journal route has one. A route WITHOUT a parser ignores the query
   * string entirely: `/nodes`, `/edges` and `/export` answer the same body
   * whatever is appended to their URL, which is what makes their validators
   * honest (a projection that changed the body without changing the ETag
   * would hand every client a 304 over the wrong rows).
   */
  parseOptions?: (req: Request) => { ok: true; options: O } | { ok: false; error: string },
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

    // Before the conditional check and before any load: a request that cannot
    // be read at all is a 400 whatever it would have matched.
    let options = undefined as O;
    if (parseOptions) {
      const parsed = parseOptions(req);
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
      options = parsed.options;
    }

    try {
      // null means "not yours or not there" — the same 404 either way, so this
      // cannot be used to probe for project ids. The validator statement is
      // owner-scoped exactly like the body load, so a 304 cannot leak
      // existence either: a non-owner gets 404 whatever it sends.
      const ifNoneMatch = req.headers.get("if-none-match");
      if (ifNoneMatch !== null) {
        const validators = await loadValidators(projectId, caller.ownerIds);
        if (validators === null) return Response.json({ error: "not_found" }, { status: 404 });
        const etag = etagFor(validators);
        if (ifNoneMatchSatisfied(ifNoneMatch, etag)) {
          return new Response(null, { status: 304, headers: readResponseHeaders(etag) });
        }
      }

      const result = await load(projectId, caller.ownerIds, options);
      if (result === null) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json(
        { [key]: result[key] },
        { status: 200, headers: readResponseHeaders(etagFor(result.validators)) },
      );
    } catch (err) {
      console.error(`[graph] GET ${label} failed:`, err instanceof Error ? err.message : "unknown error");
      return Response.json({ error: "internal_error", message: `Failed to load ${label}.` }, { status: 500 });
    }
  };
}

import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { bundleEtag, ifNoneMatchSatisfied, readResponseHeaders } from "@/lib/services/graph/etag";
import {
  archiveProject,
  getProject,
  loadValidators,
  qualityFindingEvents,
  updateProjectFields,
} from "@/lib/services/graph/store";
import { foldFindingEvents } from "@/lib/utils/quality";
import type { Project, QualitySection } from "@arkaik/schema";

/**
 * A single hosted project (db/migrations/008_graph_projects.sql).
 *
 * A project belonging to another owner is indistinguishable from one that does
 * not exist — both 404 — so these endpoints cannot be used to probe for ids.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — snapshot + version, with the quality decisions folded in.
 *
 * The JSON `version` is what a client passes back as `If-Match` on a mutation
 * to say "only if nothing moved since I read this". The `ETag` header is NOT
 * that: it is the weak read validator `W/"<version>.<quality event count>"`
 * for `If-None-Match` (lib/services/graph/etag.ts says why weak, and why the
 * quality count rather than the whole journal's). A client that echoes it
 * into `If-Match` is refused loudly by the write routes, never applied.
 */
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
    // The conditional path first, on the validators alone: a matching
    // `If-None-Match` answers 304 without the snapshot ever leaving Postgres.
    // Owner-scoped like the load below, so a non-owner still gets 404 and an
    // archived project still answers its owner (lib/services/graph/read-route.ts
    // walks through the same flow for the other four reads).
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch !== null) {
      const validators = await loadValidators(projectId, caller.ownerIds);
      if (!validators) return Response.json({ error: "not_found" }, { status: 404 });
      const etag = bundleEtag(validators);
      if (ifNoneMatchSatisfied(ifNoneMatch, etag)) {
        return new Response(null, { status: 304, headers: readResponseHeaders(etag) });
      }
    }

    // One snapshot load. `qualityFindingEvents` authorizes with a one-row
    // check rather than a second load, and runs AFTER the snapshot statement
    // the 200's validators come from — so the ETag can only be older than
    // the fold it stamps, which is the safe direction (an extra 200 later,
    // never a 304 over stale decisions).
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    // The app's read, and the only one that folds. `store.getProject` keeps
    // returning exactly what Postgres holds because its other callers — the
    // acceptance planner in pull-request.ts, the pollen route — load a bundle
    // to plan mutations from; a derived finding status inside the object a
    // mutation is planned from is one refactor away from being written back
    // as though it had been stored. So the fold happens here instead, on the
    // one caller that is a read all the way out to the client.
    const storedQuality = (found.bundle as { quality?: QualitySection }).quality;
    const quality = foldFindingEvents(
      storedQuality,
      await qualityFindingEvents(projectId, caller.ownerIds),
    );
    const bundle = quality === storedQuality ? found.bundle : { ...found.bundle, quality };
    return Response.json(
      { bundle, version: found.version },
      { status: 200, headers: readResponseHeaders(bundleEtag(found.validators)) },
    );
  } catch (err) {
    console.error("[graph] GET project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to load project." }, { status: 500 });
  }
}

/**
 * PATCH — project-level fields only (title, description, version, metadata).
 *
 * Deliberately cannot touch nodes or edges: the graph has exactly one write
 * path, `POST .../mutations`, so there is no second route that could skip the
 * validator gate or the journal.
 */
export async function PATCH(
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

  // Read as text first so the size check runs BEFORE `JSON.parse` ever touches
  // the payload, against the same shared cap as every other bundle-accepting
  // route. `project.metadata` is free-form, so "project fields only" bounds
  // what this route can write, never how many bytes it can be handed.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let body: { project?: unknown };
  try {
    body = JSON.parse(raw) as { project?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.project !== "object" || body.project === null || Array.isArray(body.project)) {
    return Response.json({ error: "invalid_project" }, { status: 400 });
  }

  try {
    const result = await updateProjectFields(projectId, caller.ownerIds, body.project as Partial<Project>);
    if (!result.ok) {
      if (result.reason === "validation") {
        return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ version: result.version }, { status: 200, headers: { ETag: `"${result.version}"` } });
  } catch (err) {
    console.error("[graph] PATCH project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to update project." }, { status: 500 });
  }
}

/** DELETE — archive (soft). History is kept; the project leaves listings. */
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

  try {
    const archived = await archiveProject(projectId, caller.ownerIds);
    if (!archived) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[graph] DELETE project failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to archive project." }, { status: 500 });
  }
}

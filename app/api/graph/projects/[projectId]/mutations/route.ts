import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { applyMutation, getUserTier } from "@/lib/services/graph/store";
import type { MutationOp } from "@arkaik/schema";

/**
 * POST /api/graph/projects/{projectId}/mutations — THE write path
 * (docs/spec/services.md § Hosted Graph Projects → Write path).
 *
 * One endpoint taking a BATCH of typed ops, rather than a REST verb per entity:
 *
 *  - a batch is atomic, so "create the acceptance and the covers edge" cannot
 *    half-apply — the failure mode that forced the app into a hand-rolled
 *    rollback before `applyOps` existed;
 *  - one validator gate runs over the finished graph, not once per verb, so an
 *    intermediate state that is briefly invalid (a flow whose composes edges
 *    are still being added) is never rejected;
 *  - it mirrors the MCP tool catalog and the `DataProvider` interface exactly,
 *    which is what lets a RemoteProvider and `arkaik-mcp --remote` share it.
 *
 * Optimistic concurrency: send `If-Match: "<version>"` to require that nothing
 * moved since you read. Omit it to apply regardless. Correctness does not depend
 * on it — the store takes a row lock either way — it is there so a client can
 * notice that someone else changed the project under it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ops accepted here, mirroring @arkaik/schema's MutationOp union. */
const VALID_OPS = new Set([
  "create_node",
  "update_node",
  "delete_node",
  "delete_nodes",
  "create_edge",
  "delete_edge",
]);

/** Guard against an unbounded batch turning one request into a long lock hold. */
const MAX_OPS = 500;

function parseIfMatch(req: Request): string | undefined {
  const header = req.headers.get("if-match");
  if (!header) return undefined;
  return header.trim().replace(/^"|"$/g, "");
}

export async function POST(
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

  let body: { ops?: unknown };
  try {
    body = (await req.json()) as { ops?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    return Response.json({ error: "invalid_ops", message: "`ops` must be a non-empty array." }, { status: 400 });
  }
  if (body.ops.length > MAX_OPS) {
    return Response.json({ error: "too_many_ops", limit: MAX_OPS, actual: body.ops.length }, { status: 400 });
  }
  for (const op of body.ops) {
    if (typeof op !== "object" || op === null || !VALID_OPS.has((op as { op?: string }).op ?? "")) {
      return Response.json(
        { error: "invalid_ops", message: `Each op must be one of: ${[...VALID_OPS].join(", ")}.` },
        { status: 400 },
      );
    }
  }

  try {
    const tier = await getUserTier(caller.userId);
    const result = await applyMutation({
      projectId,
      ownerIds: caller.ownerIds,
      ops: body.ops as MutationOp[],
      // The audit trail records what acted, not just who: an agent's writes are
      // distinguishable from the same person's edits in the browser.
      actor: caller.via === "token" ? "arkaik-agent" : "arkaik-app",
      tier,
      expectedVersion: parseIfMatch(req),
    });

    if (result.ok) {
      return Response.json(
        {
          version: result.version,
          nodes: result.nodes,
          edges: result.edges,
          events: result.events,
          warnings: result.warnings,
        },
        { status: 200, headers: { ETag: `"${result.version}"` } },
      );
    }

    switch (result.reason) {
      case "not_found":
        return Response.json({ error: "not_found" }, { status: 404 });
      case "conflict":
        // 409, not 412 — a known, deliberate inconsistency with
        // `PUT .../bundle` (lib/services/graph/restore.ts's `classifyIfMatch`
        // maps its equivalent case to 412 Precondition Failed, the RFC 9110
        // §13.1.1-correct code for a failed If-Match). NOT changed here: this
        // route's `If-Match` is optional/best-effort ("Correctness does not
        // depend on it," above) — a materially different contract from
        // restore's mandatory, fail-closed one — so reconciling the two codes
        // is a separate decision with its own blast radius, flagged but out
        // of scope for Task 11 (docs/superpowers/plans/2026-08-04-bootstrap-
        // method.md, Task 11, note 5).
        return Response.json(
          { error: "version_conflict", version: result.version },
          { status: 409, headers: { ETag: `"${result.version}"` } },
        );
      case "validation":
        return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
      case "mutation":
        // A refused op (unknown node, duplicate id, playlist cycle) is a client
        // error about the request, not about the stored graph — 422 with the
        // machine-readable code from @arkaik/schema.
        return Response.json({ error: "mutation_refused", code: result.code, message: result.message }, { status: 422 });
      case "limit":
        return Response.json(
          { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
          { status: 403 },
        );
    }
  } catch (err) {
    console.error("[graph] POST mutations failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to apply mutations." }, { status: 500 });
  }
}

import { getCaller, hasScope } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { classifyDryRun } from "@/lib/services/graph/restore";
import { getUserTier, replaceProjectBundle } from "@/lib/services/graph/store";

/**
 * PUT /api/graph/projects/{projectId}/bundle — replace snapshot + journal.
 *
 * The landing path for a bootstrapped map (docs/superpowers/specs/2026-08-04-
 * bootstrap-method-design.md § 7). `POST .../mutations` stays the write path
 * for ordinary edits; this exists only because mined history cannot be
 * expressed as mutations — the journal there is derived server-side from the
 * diff, never supplied by the caller.
 *
 * Destructive by construction, so every rail is deliberate:
 *  - Owner-only, via the same `owner_id = any(ownerIds)` scoping every other
 *    write in the graph store uses — not a separate check.
 *  - `If-Match` is REQUIRED, no wildcard, and fails CLOSED on anything this
 *    endpoint does not recognize as a single well-formed version
 *    (`lib/services/graph/restore.ts`'s `classifyIfMatch`).
 *  - `?dryRun=` fails CLOSED too, in the OPPOSITE direction: an unrecognized
 *    token is refused (400) rather than silently taking the destructive
 *    branch (`classifyDryRun`, same file — see its own doc comment for the
 *    coordinator finding this fixed).
 *  - The body is capped at `MAX_BUNDLE_BYTES`, same as `POST /api/graph/projects`
 *    — see that check below for why this route needed it more, not less.
 *  - `arkaik restore` writes a local backup before it ever calls this, and
 *    can preview the exact server-computed delta first via `?dryRun=1`.
 *
 * ── Why `dryRun` is a query param, not a body field ─────────────────────────
 * The body is the bundle to write — identical in shape whether the call is a
 * preview or the real thing. A query param toggles the MODE of the same
 * request without touching how the body is built, mirrors this codebase's
 * existing precedent for a boolean request toggle (`?include_journal=` on
 * `GET /api/publik`), and keeps `arkaik restore --dry-run` a one-line diff
 * from `arkaik restore` in the CLI (Task 12): same request, same body,
 * `?dryRun=1` appended.
 *
 * ── Why 428 / 400 / 412, not one 409 ────────────────────────────────────────
 * `classifyIfMatch` distinguishes three different client situations that a
 * single boolean would collapse into one: no version stated at all (428
 * Precondition Required — the caller must supply one, not retry as-is), a
 * shape this endpoint refuses on principle (400 Bad Request — wildcard, weak
 * ETag, multi-value list), and a well-formed but stale version (412
 * Precondition Failed — the one genuine conflict, RFC 9110 §13.1.1/§8.8.3.2).
 * `POST .../mutations` replies 409 for the stale case — a known, deliberate
 * inconsistency, NOT fixed here: that route's `If-Match` is optional and
 * best-effort ("correctness does not depend on it," per that route's own
 * comment), a materially different contract from this one's mandatory,
 * fail-closed check, and reconciling the two status codes is a separate
 * decision with its own blast radius (docs/superpowers/plans/2026-08-04-
 * bootstrap-method.md, Task 11, note 5).
 *
 * ── `limit_exceeded` is 403, not 413 ─────────────────────────────────────────
 * Both `POST /api/graph/projects` and `POST .../mutations` reply 403 for a
 * tier-limit refusal; 413 is reserved on this endpoint for the payload-size
 * cap below (`payload_too_large`), which is the one distinct-from-siblings
 * meaning 413 actually has here. Using 413 for both would make the same
 * status code mean two different things on the same route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import cap, mirroring `POST /api/graph/projects` and Publik
 * (docs/spec/services.md). This route's body is a full `ProjectBundle`
 * PLUS a mined journal (potentially every event the project has ever had),
 * which makes it the LARGEST body any graph route accepts — the opposite of
 * where a cap could be skipped. The same 5 MB ceiling applies rather than a
 * larger one: every bundle observed in practice (cycle 5's 173 nodes / 337
 * edges / 253 events was 164 KB; Pebbles at full parity is projected around
 * 400 nodes / 700 edges) sits two-plus orders of magnitude under it, so this
 * is headroom, not a real constraint, and a single shared number is easier
 * to reason about than a bigger one that only this route gets.
 */
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export async function PUT(
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

  // Fast path for the common, cheap-to-detect case only: a header that is
  // simply not there. This is NOT the authoritative classification — every
  // other "absent" shape (whitespace-only, etc.) still reaches
  // `classifyIfMatch` inside `replaceProjectBundle`, which is the single
  // source of truth (Task 11, note 4). Skipping straight to 428 here just
  // saves a DB round trip for a request that could never succeed anyway.
  const ifMatchHeader = req.headers.get("if-match");
  if (!ifMatchHeader) {
    return Response.json(
      { error: "if_match_required", message: "Send If-Match with the version you read." },
      { status: 428 },
    );
  }

  const dryRunClassification = classifyDryRun(new URL(req.url).searchParams.get("dryRun"));
  if (!dryRunClassification.ok) {
    return Response.json(
      {
        error: "invalid_dry_run",
        message: "dryRun must be 1/true (or bare `?dryRun`) for a preview, or 0/false for a real write.",
      },
      { status: 400 },
    );
  }
  const dryRun = dryRunClassification.dryRun;

  // Read as text first so the size check runs BEFORE `JSON.parse` ever
  // touches the payload — mirrors `POST /api/graph/projects` exactly.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const tier = await getUserTier(caller.userId);
    const result = await replaceProjectBundle({
      projectId,
      ownerIds: caller.ownerIds,
      // Accept either `{ bundle: {...} }` or a bare bundle as the body, same
      // as the reference shape carried in the plan.
      bundle: (body as { bundle?: unknown })?.bundle ?? body,
      ifMatch: ifMatchHeader,
      tier,
      dryRun,
    });

    if (result.ok) {
      return Response.json(
        { version: result.version, delta: result.delta, dryRun },
        { status: 200, headers: { ETag: `"${result.version}"` } },
      );
    }

    switch (result.reason) {
      case "not_found":
        return Response.json({ error: "not_found" }, { status: 404 });
      case "precondition_required":
        return Response.json(
          { error: "if_match_required", message: "Send If-Match with the version you read." },
          { status: 428 },
        );
      case "precondition_unsupported":
        return Response.json(
          {
            error: "if_match_unsupported",
            message:
              "If-Match must be a single, strong version token — no wildcard, weak validator (W/\"…\"), or multi-value list.",
          },
          { status: 400 },
        );
      case "conflict":
        // `current` only makes sense here — a 428/400 caller sent nothing
        // comparable in the first place, so those two responses omit it.
        return Response.json(
          { error: "conflict", message: "The project changed since you read it.", current: result.current },
          { status: 412, headers: { ETag: `"${result.current}"` } },
        );
      case "limit":
        // 403, matching POST /api/graph/projects and POST .../mutations —
        // see the module doc comment for why 413 is reserved for the
        // payload-size cap above instead.
        return Response.json(
          { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
          { status: 403 },
        );
      case "validation":
        return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
    }
  } catch (err) {
    console.error("[graph] PUT bundle failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to replace the bundle." }, { status: 500 });
  }
}

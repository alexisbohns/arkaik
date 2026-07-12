import {
  deleteSnapshot,
  fetchSnapshotBundle,
  servicesConfigured,
  servicesUnavailable,
} from "@/lib/services/publik";

/**
 * GET  /api/publik/{id} — return the stored bundle verbatim, or 404.
 * DELETE /api/publik/{id} — delete iff the Bearer owner key matches (204/403).
 *
 * docs/spec/services.md § Publik → Protocol. Node runtime for the `pg` driver.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const { id } = await params;
  try {
    const bundle = await fetchSnapshotBundle(id);
    if (bundle === null) {
      return Response.json({ error: "not_found", message: "Snapshot not found." }, { status: 404 });
    }
    // Verbatim stored bundle (§ "returns the stored bundle verbatim").
    return Response.json(bundle, { status: 200 });
  } catch (err) {
    console.error("[publik] GET failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to fetch snapshot." },
      { status: 500 },
    );
  }
}

/** Extract the token from an `Authorization: Bearer <token>` header, or null. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function DELETE(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const token = bearerToken(req);
  if (!token) {
    return Response.json(
      { error: "unauthorized", message: "Missing Authorization: Bearer <owner_key>." },
      { status: 401 },
    );
  }

  const { id } = await params;
  try {
    const outcome = await deleteSnapshot(id, token);
    if (outcome === "not_found") {
      return Response.json({ error: "not_found", message: "Snapshot not found." }, { status: 404 });
    }
    if (outcome === "forbidden") {
      return Response.json(
        { error: "forbidden", message: "Owner key does not match." },
        { status: 403 },
      );
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[publik] DELETE failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to delete snapshot." },
      { status: 500 },
    );
  }
}

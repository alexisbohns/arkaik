import { getSession } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { revokeToken } from "@/lib/services/tokens";

/**
 * DELETE /api/tokens/{id} — revoke a token (db/migrations/007_api_tokens.sql).
 *
 * Session-only for the same reason as minting: a leaked token must not be able
 * to revoke the credentials that would be used to contain it.
 *
 * Revocation is a tombstone, not a delete — `revokeToken` sets `revoked_at` so
 * the row survives as an audit record and its prefix stays reserved. A token
 * that does not exist, is already revoked, or belongs to another user all return
 * the same 404, so this endpoint cannot be used to probe for valid token ids.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Tokens");

  const session = await getSession();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const revoked = await revokeToken(id, userId);
    if (!revoked) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[tokens] DELETE failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to revoke token." }, { status: 500 });
  }
}

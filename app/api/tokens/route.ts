import { getSession } from "@/lib/services/auth";
import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { userBelongsToOwner, resolveOwnerIds } from "@/lib/services/owners";
import {
  DEFAULT_TOKEN_SCOPES,
  isTokenScope,
  listTokens,
  mintToken,
  type TokenScope,
} from "@/lib/services/tokens";

/**
 * Token management (db/migrations/007_api_tokens.sql).
 *
 * SESSION-ONLY, DELIBERATELY. These handlers call `getSession()`, not
 * `getCaller()`: if a token could mint tokens, a single leaked credential could
 * manufacture fresh ones with wider scopes and outlive its own revocation.
 * Minting requires an interactive sign-in, always.
 *
 * Node runtime for the `pg` driver; force-dynamic because every response depends
 * on the request's session cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longest accepted token name — a label, not a document. */
const MAX_NAME_LENGTH = 100;

async function requireUserId(): Promise<number | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const userId = Number(session.user.id);
  return Number.isInteger(userId) ? userId : null;
}

/** GET /api/tokens — the caller's tokens. Secrets and hashes are never selected. */
export async function GET(): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Tokens");

  const userId = await requireUserId();
  if (userId === null) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    return Response.json({ tokens: await listTokens(userId) }, { status: 200 });
  } catch (err) {
    console.error("[tokens] GET failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to list tokens." }, { status: 500 });
  }
}

/**
 * POST /api/tokens — mint one. The plaintext secret is in the 201 body and is
 * never retrievable again; the client must surface it immediately.
 *
 * Body: `{ name, scopes?, owner_id?, expires_in_days? }`.
 */
export async function POST(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Tokens");

  const userId = await requireUserId();
  if (userId === null) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return Response.json(
      { error: "invalid_name", message: `A token name of 1–${MAX_NAME_LENGTH} characters is required.` },
      { status: 400 },
    );
  }

  // Unknown scope strings are rejected rather than silently dropped: a client
  // asking for a scope this deployment does not know about has a bug, and
  // quietly issuing a narrower token would hide it until the token failed.
  let scopes: TokenScope[] = [...DEFAULT_TOKEN_SCOPES];
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || body.scopes.some((s) => typeof s !== "string" || !isTokenScope(s))) {
      return Response.json({ error: "invalid_scopes" }, { status: 400 });
    }
    scopes = body.scopes as TokenScope[];
    if (scopes.length === 0) return Response.json({ error: "invalid_scopes" }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (body.expires_in_days !== undefined && body.expires_in_days !== null) {
    const days = Number(body.expires_in_days);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return Response.json({ error: "invalid_expiry" }, { status: 400 });
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  try {
    // An explicit owner_id must be one the caller belongs to; otherwise mint
    // against their own. This is the membership gate between a request and
    // another tenant's namespace.
    let ownerId: string;
    if (typeof body.owner_id === "string" && body.owner_id) {
      if (!(await userBelongsToOwner(userId, body.owner_id))) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      ownerId = body.owner_id;
    } else {
      const session = await getSession();
      ownerId = (await resolveOwnerIds(userId, session?.user?.name))[0];
    }

    const minted = await mintToken({ ownerId, userId, name, scopes, expiresAt });
    return Response.json({ token: minted.record, secret: minted.plaintext }, { status: 201 });
  } catch (err) {
    console.error("[tokens] POST failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to mint token." }, { status: 500 });
  }
}

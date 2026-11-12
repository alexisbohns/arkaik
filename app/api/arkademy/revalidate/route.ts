import { createHash, timingSafeEqual } from "node:crypto";

import { expireArkademyCache } from "@/lib/services/arkademy";

/**
 * POST /api/arkademy/revalidate — expires the cached Arkademy library at once
 * (docs/spec/services.md § Arkademy). The upload script calls it after a
 * publish or a rollback, so the new version is served on the next read
 * instead of after the data cache's hour.
 *
 * `Authorization: Bearer <ARKADEMY_REVALIDATE_SECRET>`, compared in constant
 * time. 404 while the variable is unset on this deployment, so the route
 * answers as if it did not exist; 401 on a missing or wrong token; 204 once
 * the tag is expired. It reads nothing and writes nothing but the cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** SHA-256 first, so the two buffers always have one length and nothing leaks it. */
function sameSecret(presented: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ARKADEMY_REVALIDATE_SECRET;
  if (!secret) return new Response(null, { status: 404, headers: NO_STORE });

  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  if (!match || !sameSecret(match[1], secret)) {
    return Response.json(
      { error: "unauthorized", message: "A valid bearer token is required." },
      { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Bearer realm="arkademy"' } },
    );
  }

  expireArkademyCache();
  return new Response(null, { status: 204, headers: NO_STORE });
}

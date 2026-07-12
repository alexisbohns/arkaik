import { NextResponse } from "next/server";

import { getSession } from "@/lib/services/auth";

/**
 * Minimal session-guarded route (docs/spec/services.md § Synk). This is NOT the
 * Synk backup API — it is the smallest possible expression of the auth check the
 * real Synk handlers (another issue) will copy: read the session, 401 if absent,
 * otherwise act as the owner. It also backs the M4 acceptance test
 * (tests/services/auth-guard.test.js): unauthenticated GET → 401.
 *
 * `getSession()` returns null both when no one is signed in AND when auth is
 * unconfigured, so this correctly 401s in the env-unset build too.
 *
 * `force-dynamic`: the response depends on the request's session cookie and must
 * never be statically cached.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, user: session.user });
}

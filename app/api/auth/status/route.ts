import { NextResponse } from "next/server";

import { getSession, isAuthConfigured } from "@/lib/services/auth";

/**
 * Client-facing auth status (docs/spec/services.md § Synk → Auth: "session
 * available to client components"). The app shell's sign-in button
 * (components/auth/AuthButton) polls this once on mount to decide whether to
 * render at all, and whom it is rendering for.
 *
 * It ships ONLY a boolean plus the signed-in user's public profile — never a
 * secret. When auth is unconfigured this returns `{ configured: false }` and the
 * button renders nothing, keeping every services surface hidden.
 *
 * `force-dynamic`: configured-ness and the session are runtime facts (env +
 * cookie), so this response must never be statically cached at build time.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  const session = await getSession();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null;

  return NextResponse.json({ configured: true, user });
}

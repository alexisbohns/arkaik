import "server-only";

import type { Session } from "next-auth";

import { auth } from "@/auth";

/**
 * Server-side auth helpers for the arkaik services surface
 * (docs/spec/services.md § Synk → Auth).
 *
 * This is the seam the Synk API depends on: a single place that answers "is auth
 * turned on?" and "who is the caller?" without any route handler having to know
 * about NextAuth internals — and, critically, without breaking when auth is
 * unconfigured.
 */

/**
 * True only when every variable Auth.js needs to run is present. Reads env at
 * call time (never at import), so the local-first app boots with all of them
 * unset. These are all server-only vars — no NEXT_PUBLIC_ — so this MUST NOT be
 * imported into client code; the client learns configured-ness as a bare boolean
 * from GET /api/auth/status.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GITHUB_ID &&
      process.env.AUTH_GITHUB_SECRET,
  );
}

/**
 * The current session, or null when there is none — and null, never a throw,
 * when auth is unconfigured. Guarding on `isAuthConfigured()` first means we
 * never invoke `auth()` (and therefore never construct the Postgres adapter /
 * read DATABASE_URL) in the env-unset build. `auth()` itself is wrapped so that
 * being called outside a request scope, or any decode error, degrades to "no
 * session" rather than a 500 — the JWT strategy makes this a pure cookie decode,
 * so there is no database dependency to mask.
 */
export async function getSession(): Promise<Session | null> {
  if (!isAuthConfigured()) {
    return null;
  }
  try {
    return await auth();
  } catch {
    return null;
  }
}

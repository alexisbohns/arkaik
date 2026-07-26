import "server-only";

import type { Session } from "next-auth";

import { auth } from "@/auth";
import { resolveOwnerIds } from "@/lib/services/owners";
import {
  TOKEN_SCOPES,
  bearerToken,
  verifyToken,
  type TokenScope,
} from "@/lib/services/tokens";

/**
 * Server-side auth helpers for the arkaik services surface
 * (docs/spec/services.md § Synk → Auth, § Hosted Graph Projects → Machine auth).
 *
 * This is the seam every service route depends on: a single place that answers
 * "is auth turned on?" and "who is the caller?" without any route handler having
 * to know about NextAuth internals or token verification — and, critically,
 * without breaking when auth is unconfigured.
 *
 * Two callers exist. `getSession()` answers the browser question and is what
 * session-only surfaces (token management itself) use. `getCaller()` answers the
 * broader one — a signed-in human OR an agent presenting a bearer token — and is
 * what the hosted graph API and Synk use.
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

/**
 * An authenticated caller — a signed-in human or a token-bearing machine.
 *
 * `ownerIds` is the authorization surface: every hosted query MUST filter on it.
 * A session caller gets every owner they belong to; a token caller gets exactly
 * the one owner its token was minted for, which is deliberately narrower.
 */
export interface Caller {
  userId: number;
  ownerIds: string[];
  scopes: TokenScope[];
  via: "session" | "token";
  /** Present only for token callers — the audit handle for what acted. */
  tokenId?: string;
}

/**
 * Resolve the caller from a bearer token if one is presented, otherwise from the
 * session cookie. Returns null — never throws — when auth or the database is
 * unconfigured, so an env-unset build 401s cleanly instead of 500ing.
 *
 * A malformed or rejected bearer token does NOT fall through to the session.
 * Falling through would mean a request carrying a revoked token could still
 * succeed on the browser's cookie, which makes revocation untestable from the
 * client's point of view and hides credential errors behind ambient auth.
 * Presenting a credential is a claim about which identity you want to act as.
 */
export async function getCaller(req?: Request): Promise<Caller | null> {
  // Owner resolution needs Postgres. Checked inline rather than importing
  // servicesConfigured() from publik.ts, which would pull @arkaik/schema into
  // every module that only wants to know who the caller is.
  if (!isAuthConfigured() || !process.env.DATABASE_URL) {
    return null;
  }

  const presented = req ? bearerToken(req) : null;
  if (presented !== null) {
    const resolved = await verifyToken(presented);
    if (!resolved) return null;
    return {
      userId: resolved.userId,
      ownerIds: [resolved.ownerId],
      scopes: resolved.scopes,
      via: "token",
      tokenId: resolved.id,
    };
  }

  const session = await getSession();
  if (!session?.user?.id) return null;

  // Auth.js exposes the id as a string; Postgres stores it as SERIAL/INTEGER.
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) return null;

  return {
    userId,
    ownerIds: await resolveOwnerIds(userId, session.user.name),
    // An interactively signed-in human is not scope-limited; scopes exist to
    // constrain credentials that live outside the browser.
    scopes: [...TOKEN_SCOPES],
    via: "session",
  };
}

/** Whether the caller carries a scope. Session callers carry all of them. */
export function hasScope(caller: Caller, scope: TokenScope): boolean {
  return caller.scopes.includes(scope);
}


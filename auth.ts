import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import PostgresAdapter from "@auth/pg-adapter";

import { getPool } from "@/lib/services/db";

/**
 * Auth.js (NextAuth v5) configuration for Synk accounts
 * (docs/spec/services.md § Synk → Auth).
 *
 * GRACEFUL ABSENCE (§ Backend — env rules): this module MUST be importable, and
 * `next build` MUST succeed, with every AUTH_* / DATABASE_URL variable unset —
 * the local-first app has no server. That is why the config is passed as a
 * *lazy* function: NextAuth only invokes it when a request actually reaches an
 * auth route or when `auth()` is called, never at import. Nothing here reads an
 * env var or opens a Postgres connection at module scope.
 *
 * The GitHub provider needs no arguments: Auth.js infers `AUTH_GITHUB_ID` /
 * `AUTH_GITHUB_SECRET` as its clientId/secret, and `AUTH_SECRET` signs the JWT.
 * Callers gate on `isAuthConfigured()` (lib/services/auth.ts) before ever
 * invoking `auth()`, so `getPool()` — which throws when DATABASE_URL is unset —
 * is only reached in a correctly configured deployment.
 *
 * Session strategy is JWT: stateless, serverless-friendly, and it means reading
 * a session on the request path (the Synk API's auth check) never touches the
 * database. The Postgres adapter still persists users/accounts on sign-in.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: PostgresAdapter(getPool()),
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    // Surface the user id to the session so route handlers and client
    // components can scope Synk data by owner. On the JWT strategy the id lives
    // in `token.sub` (set by Auth.js on sign-in); copy it onto `session.user`.
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
}));

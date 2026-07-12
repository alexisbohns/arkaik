import "server-only";

import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * Server-only Postgres access for the arkaik services surface
 * (docs/spec/services.md § Backend — Decision Record).
 *
 * Driver choice: `pg` (node-postgres) — the same driver the migration runner
 * uses. It speaks the standard Postgres wire protocol, so it works unchanged
 * against Neon's pooled connection on Vercel, the CI Postgres service
 * container, and any self-hosted Postgres (Inkognito). `@neondatabase/serverless`
 * would shave cold-start latency on Vercel but ties the code to a WebSocket/HTTP
 * endpoint, which the "runs on any Postgres" self-hosting promise forbids.
 *
 * The pool is created lazily and DATABASE_URL is read at call time, never at
 * module import. This is what lets the local-first app build and boot with every
 * services env var unset: nothing here runs until a route handler issues a query.
 */

let pool: Pool | undefined;

/**
 * The lazily-created singleton connection pool. Exported so the Auth.js Postgres
 * adapter (auth.ts) can share the same pool instead of opening a second one.
 * DATABASE_URL is still read here at call time, never at import — the adapter is
 * only constructed inside NextAuth's lazy config, which runs on request, so the
 * local-first app boots untouched with services env vars unset.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. arkaik services (Publik/Synk) require a Postgres " +
          "connection; the local-first app runs without one. See .env.example.",
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Run a parameterized query. Callers MUST pass values through `params` (never
 * interpolate into `text`) — parameterized queries are the only SQL path the
 * services spec permits (§ Security & Privacy).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[] | undefined);
}

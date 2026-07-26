import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

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

/** True when the services surface has a database configured. */
export function servicesConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * 503 for when `DATABASE_URL` is unset: the local-first app still builds and
 * serves, and the client gets a clear, non-crashing signal that hosted services
 * are absent on this deployment (docs/spec/services.md § Backend — env vars).
 *
 * `service` names the surface in the message ("Publik", "Synk", "Tokens"), which
 * is the only way the per-service copies of this helper ever differed.
 */
export function servicesUnavailable(service: string): Response {
  return Response.json(
    {
      error: "services_unavailable",
      message: `arkaik services (${service}) are not configured on this deployment.`,
    },
    { status: 503 },
  );
}

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

/**
 * Run `fn` inside a single transaction on one checked-out connection, committing
 * on return and rolling back on throw. The client is always released, including
 * when the rollback itself fails.
 *
 * Why this exists rather than `query()` calls wrapped in begin/commit: `query()`
 * checks a connection out of the pool per statement, so consecutive calls can
 * land on *different* connections — which would silently scatter the statements
 * across transactions. Anything needing atomicity, or a lock that must outlive a
 * single statement (`select … for update`), MUST go through here.
 *
 * The callback receives the client; use `client.query(...)` for every statement
 * inside it. Values still go through $-params, never interpolation
 * (docs/spec/services.md § Security & Privacy).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

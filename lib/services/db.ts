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

/**
 * Maximum request body, in bytes, for every route that accepts a bundle-shaped
 * payload (docs/spec/services.md § Publik → "Size cap 5 MB").
 *
 * It lives here, beside {@link servicesUnavailable}, for exactly that helper's
 * reason: the number used to be re-declared per route, and three of the routes
 * that parse a bundle (`POST …/mutations`, `PATCH …/{projectId}`, `PUT
 * /api/synk/projects/{id}`) had drifted to no cap at all — which made it
 * possible to grow a hosted snapshot past a ceiling the capped import/restore
 * endpoints still enforce, so the project could no longer round-trip through
 * its own export. One definition is the only shape in which they cannot drift
 * apart again.
 *
 * `/api/github/webhook` keeps its own, smaller cap on purpose: its body is a
 * delivery payload, not a bundle, so the two numbers describe different things
 * and sharing one would only couple them.
 */
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

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

/**
 * Namespaces for the transaction-scoped advisory locks this codebase takes
 * (`select pg_advisory_xact_lock($namespace, $key)`).
 *
 * Postgres keeps ONE advisory-lock key space per database, so two subsystems
 * that each key a lock on, say, a user id would serialize against each other
 * for no reason — a contention bug that looks fine in a single-feature test and
 * only shows up under mixed production traffic. The two-key form takes a
 * namespace plus a key; listing every namespace here, once, is what stops a new
 * one from silently reusing a value. The numbers are arbitrary (ASCII of a
 * four-letter tag) and only have to be distinct and stable.
 *
 * Why these three sites use an advisory lock at all rather than `select … for
 * update`: each guards a count-then-write where the thing being counted may not
 * exist yet (a user's first backup, an owner's first project, an IP's first
 * request in the window). `for update` locks the rows a query RETURNS, which
 * for an empty result is nothing at all — precisely the case the check-then-act
 * race lives in. `_xact_` scopes the lock to the surrounding transaction, so
 * the commit or the rollback releases it and there is no unlock path to forget.
 */
export const ADVISORY_LOCK = {
  /** One user's Synk backup writes (lib/services/synk.ts → putBackup). */
  synkUser: 0x53594e4b,
  /** One owner's hosted-project creates (lib/services/graph/store.ts → createProject). */
  graphOwner: 0x47525048,
  /** One (action, ip_hash) throttle bucket (lib/services/publik.ts → checkRateLimit). */
  publikRateLimit: 0x50424c4b,
} as const;

/**
 * The caller's tier from `users.tier`, defaulting to the safe floor.
 *
 * Lives here rather than in lib/services/limits.ts — which owns the tier →
 * limits tables and would be the obvious home — because that module is
 * deliberately database-free, which is what lets the hosted-restore rules be
 * tested in CI's fast, Postgres-less job (tests/services/load-graph-restore.js
 * asserts exactly that). The lookup is one statement, and both consumers
 * (lib/services/synk.ts, lib/services/graph/store.ts) already import this
 * module; they re-export it, so neither service's surface changes. Before this
 * they held byte-identical copies.
 *
 * The 'synk' fallback is the safe floor: a missing row (which should not happen
 * for a valid caller) must never resolve to more than the free allowance —
 * `getLimitsForTier` applies the same rule to an unrecognized value.
 */
export async function getUserTier(userId: number): Promise<string> {
  const { rows } = await query<{ tier: string }>(`select tier from users where id = $1`, [userId]);
  return rows[0]?.tier ?? "synk";
}

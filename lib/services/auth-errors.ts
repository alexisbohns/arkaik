/**
 * Telling a database outage apart from a misconfiguration during sign-in
 * (issue #491).
 *
 * Auth.js wraps any failure inside the Postgres adapter in an `AdapterError`,
 * and because that type is not client-safe it redirects the browser to
 * `?error=Configuration` — the same code a missing secret produces. On
 * 2026-09-30 a Neon quota (pg `53000`) took sign-in down and everything pointed
 * at env vars. This module is the server-log half of the fix: a logger that
 * names the database as the cause in one greppable line. The browser half is
 * app/auth/error/page.tsx.
 *
 * Deliberately free of `server-only`, `next-auth` and `pg` imports — it reads
 * errors by shape — so the CI fast job can test it without a database
 * (tests/services/auth-errors.test.js).
 */

/** The database failure underneath an Auth.js error, when there is one. */
export interface DatabaseFailure {
  /** SQLSTATE (`53000`) or Node system code (`ECONNREFUSED`), when present. */
  code: string | null;
  message: string;
}

/** Auth.js's `AuthError` keeps the wrapped error at `cause.err`. */
function wrapped(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "err" in cause) {
    return (cause as { err: unknown }).err;
  }
  return undefined;
}

function typeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const type = (error as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/**
 * The database failure behind `error`, or null when the error is not one.
 *
 * An `AdapterError` means the adapter — the only part of sign-in that talks to
 * Postgres — threw, and the driver's own error sits at its `cause.err` with the
 * code worth logging. Auth.js rethrows an `AuthError` unchanged on its way to
 * the top, so the `AdapterError` is what reaches the logger both times.
 */
export function databaseFailure(error: unknown): DatabaseFailure | null {
  if (typeOf(error) !== "AdapterError") return null;

  const inner = (wrapped(error) ?? error) as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof inner.code === "string" && inner.code ? inner.code : null;
  // A refused connection surfaces as an AggregateError with an empty message.
  const message =
    typeof inner.message === "string" && inner.message
      ? inner.message
      : typeof inner.name === "string"
        ? inner.name
        : "unknown error";
  return { code, message };
}

/** The single log line a database outage writes. */
export function databaseFailureLine(failure: DatabaseFailure): string {
  return `[auth] database unavailable: ${failure.code ? `${failure.code} ` : ""}${failure.message}`;
}

/**
 * Auth.js `logger.error` replacement.
 *
 * A database failure gets the one line from {@link databaseFailureLine}.
 * Auth.js logs the same `AdapterError` twice — once where the adapter throws,
 * again where the request fails — so an error already written is skipped. Everything else keeps the shape of Auth.js's
 * built-in logger, which this replaces entirely.
 */
export function createAuthErrorLogger(write: (...args: unknown[]) => void = console.error) {
  const seen = new WeakSet<object>();
  return function logAuthError(error: Error): void {
    if (seen.has(error)) return;
    seen.add(error);

    const failure = databaseFailure(error);
    if (failure) {
      write(databaseFailureLine(failure));
      return;
    }

    write(`[auth][error] ${typeOf(error) ?? error.name}: ${error.message}`);
    const inner = wrapped(error);
    if (inner instanceof Error) {
      write("[auth][cause]:", inner.stack);
    } else if (error.stack) {
      write(error.stack.replace(/.*/, "").substring(1));
    }
  };
}

/** What the sign-in error page tells the person, by cause. */
export type SignInFailure = "database" | "configuration" | "denied" | "other";

/**
 * Pick the explanation for `/auth/error?error=<type>`.
 *
 * `Configuration` is the only ambiguous code: it covers both a broken setup and
 * a database that refused the adapter's write. `databaseUp` settles it — the
 * page probes only for that code, and passes null when it did not probe.
 */
export function signInFailure(type: string | undefined, databaseUp: boolean | null): SignInFailure {
  if (type === "AccessDenied") return "denied";
  if (type === "Configuration") return databaseUp === false ? "database" : "configuration";
  return "other";
}

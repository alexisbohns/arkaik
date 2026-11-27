/**
 * The `pg` client config for DATABASE_URL, with TLS pinned to a private CA when
 * DATABASE_CA_CERT is set (docs/spec/services.md § Self-hosted Postgres with a
 * private CA).
 *
 * Why a CA and not `rejectUnauthorized: false`: a Postgres hosted on Coolify (or
 * any box that mints its own certificates) presents a certificate signed by
 * that box's own CA, which no system trust store knows. Turning verification
 * off would make the connection encrypted but unauthenticated — anyone on the
 * path could stand in for the database and collect the password. Pinning the
 * CA keeps full verification (chain AND hostname/IP), against a root we chose.
 *
 * Why the URL's ssl parameters are stripped: node-postgres parses the
 * connection string AFTER the config object and lets it win, so a
 * `?sslmode=require` in DATABASE_URL silently replaces the `ssl: { ca }` given
 * here and the connection falls back to the system trust store — and fails.
 * With a CA set, this module is the single place TLS is decided.
 *
 * Without DATABASE_CA_CERT nothing changes: the connection string goes through
 * untouched, exactly as before (Neon, the CI service container, localhost).
 *
 * Plain CommonJS with no dependencies so the migration runner (ESM), the
 * one-shot scripts (CJS) and the copy script can all load it in Node 20 without
 * a loader. lib/services/db.ts keeps a TypeScript twin of `pgConfig` (the test
 * build dirs cannot follow a relative import out of lib/); the two are held to
 * identical behaviour by tests/services/pg-config.test.js.
 */

"use strict";

const tls = require("tls");

const SSL_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "uselibpqcompat"];

/**
 * The CA certificate(s) from DATABASE_CA_CERT, as PEM. Accepts the file's
 * contents verbatim, or with literal `\n` escapes for hosts that only store
 * single-line values. A base64-encoded copy is refused with a message saying
 * so — the same rule as GITHUB_APP_PRIVATE_KEY.
 */
function readCa(raw) {
  const text = String(raw).trim().replace(/\\n/g, "\n");
  if (!text.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "DATABASE_CA_CERT must be the CA certificate's PEM text, including the " +
        '"-----BEGIN CERTIFICATE-----" and "-----END CERTIFICATE-----" lines ' +
        "(literal \\n escapes are accepted; a base64-encoded copy is not).",
    );
  }
  return `${text}\n`;
}

/** The connection string with every TLS parameter removed, and its host. */
function withoutSslParams(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a postgres:// URL when DATABASE_CA_CERT is set.");
  }
  for (const name of SSL_PARAMS) url.searchParams.delete(name);
  return { connectionString: url.toString(), host: url.hostname.replace(/^\[|\]$/g, "") };
}

/**
 * `{ connectionString }` when no CA is configured; otherwise the connection
 * string stripped of its ssl parameters plus `ssl: { ca, rejectUnauthorized:
 * true, checkServerIdentity }`, the last pinned to the URL's host. `env`
 * defaults to process.env, read at call time.
 */
function pgConfig(connectionString, env = process.env) {
  const caRaw = env.DATABASE_CA_CERT;
  if (!caRaw || !String(caRaw).trim()) return { connectionString };
  const ca = readCa(caRaw);
  const { connectionString: stripped, host } = withoutSslParams(connectionString);
  return {
    connectionString: stripped,
    ssl: {
      ca,
      rejectUnauthorized: true,
      // node-postgres sends no SNI for an IP host, and Node then checks the
      // certificate against "localhost". Check it against the host we dialled.
      checkServerIdentity: (_servername, cert) => tls.checkServerIdentity(host, cert),
    },
  };
}

module.exports = { pgConfig };

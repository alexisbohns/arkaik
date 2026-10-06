#!/usr/bin/env node

/**
 * A database outage during sign-in must be named as one (issue #491).
 *
 * The errors are built with @auth/core's own classes, wrapped exactly the way
 * Auth.js wraps them (lib/init.js → adapterErrorHandler, lib/actions/callback),
 * so a change to that wrapping in an Auth.js upgrade fails here rather than in
 * the next outage. No database, no next-auth runtime: this runs in CI's fast job.
 */

const fs = require("fs");
const path = require("path");
const { loadAuthErrors, BUILD_DIR } = require("./load-auth-errors");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function pgError(code, message) {
  return Object.assign(new Error(message), { code, severity: "ERROR" });
}

async function main() {
  const { AdapterError, CallbackRouteError, MissingSecret, AccessDenied } = await import("@auth/core/errors");
  const { databaseFailure, databaseFailureLine, createAuthErrorLogger, signInFailure } = loadAuthErrors();

  // The 2026-09-30 incident: Neon's quota rejected the adapter's write.
  const quota = new AdapterError(pgError("53000", "Your account or project has exceeded the quota"));
  const failure = databaseFailure(quota);
  check("an AdapterError is a database failure", failure !== null);
  check("it carries the SQLSTATE", failure && failure.code === "53000", JSON.stringify(failure));
  check(
    "the log line names the database, the code and the message",
    failure &&
      databaseFailureLine(failure) ===
        "[auth] database unavailable: 53000 Your account or project has exceeded the quota",
    failure && databaseFailureLine(failure),
  );

  // The callback route rethrows an AuthError as-is rather than wrapping it in a
  // CallbackRouteError (lib/actions/callback/index.js). If an upgrade starts
  // wrapping, the AdapterError's type is flattened away and this must change.
  const callbackSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "node_modules", "@auth", "core", "lib", "actions", "callback", "index.js"),
    "utf8",
  );
  check(
    "Auth.js still rethrows AuthErrors from the callback unwrapped",
    /if \(e instanceof AuthError\)\s*throw e;/.test(callbackSource),
  );

  // A refused connection is an AggregateError with an empty message.
  const refused = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
  const refusedFailure = databaseFailure(new AdapterError(refused));
  check(
    "a refused connection falls back to the error name",
    refusedFailure && databaseFailureLine(refusedFailure) === "[auth] database unavailable: ECONNREFUSED AggregateError",
    refusedFailure && databaseFailureLine(refusedFailure),
  );

  // Not database failures.
  check("a missing secret is not a database failure", databaseFailure(new MissingSecret("no secret")) === null);
  check(
    "a callback error with no adapter in it is not a database failure",
    databaseFailure(new CallbackRouteError(new Error("token exchange failed"))) === null,
  );
  check("a plain pg error outside Auth.js is not claimed", databaseFailure(pgError("53000", "quota")) === null);
  check("non-errors are ignored", databaseFailure(undefined) === null && databaseFailure("boom") === null);

  // The logger: one line per outage, even though Auth.js logs it twice.
  const lines = [];
  const log = createAuthErrorLogger((...args) => lines.push(args.join(" ")));
  log(quota); // adapterErrorHandler
  log(quota); // the top-level catch, same object
  check("an outage is written exactly once", lines.length === 1, JSON.stringify(lines));
  check("and that line is the database line", lines[0] && lines[0].startsWith("[auth] database unavailable: 53000"));

  lines.length = 0;
  log(new MissingSecret("Please define a `secret`"));
  check(
    "other errors keep Auth.js's [auth][error] shape",
    lines[0] && lines[0].startsWith("[auth][error] MissingSecret: Please define a `secret`"),
    lines[0],
  );
  check("and are not called a database outage", !lines.some((l) => l.includes("database unavailable")));

  // What the error page says.
  check("Configuration with the database down → database", signInFailure("Configuration", false) === "database");
  check("Configuration with the database up → configuration", signInFailure("Configuration", true) === "configuration");
  check("Configuration without a probe → configuration", signInFailure("Configuration", null) === "configuration");
  check("AccessDenied → denied", signInFailure(new AccessDenied().type, null) === "denied");
  check("anything else → other", signInFailure("Verification", null) === "other" && signInFailure(undefined, null) === "other");
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    if (failures > 0) {
      console.log(`\n${failures} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll auth-errors checks passed");
  });

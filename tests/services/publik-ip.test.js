#!/usr/bin/env node

/**
 * Client-IP derivation for the Publik rate limiter (lib/services/publik.ts →
 * `trustsForwardedHeaders`, `deriveClientIp`).
 *
 * Deliberately DATABASE-FREE, and therefore in CI's fast `build` job rather than
 * the Postgres-backed `services` one — the same reasoning as
 * tests/services/graph-restore.test.js. These two functions are pure header and
 * env reads; nothing about them needs a migrated schema, and a regression here
 * should fail on a laptop with no Postgres running, not only in CI.
 *
 * What is actually at stake: `x-forwarded-for` is written by whoever sent the
 * request. Trusted, it identifies the client. Untrusted, a caller can send a
 * fresh random value per request and hand itself a fresh rate-limit bucket every
 * time, which reduces the throttle on the UNAUTHENTICATED POST /api/publik to
 * nothing. So the assertions below are about exactly one thing: WHEN the header
 * is believed, and that the default believes it only where the platform — not
 * the caller — vouches for it.
 */

const fs = require("fs");
const { loadPublikApi, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-publik-api");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function reqWith(headers) {
  return new Request("https://publik.test/api/publik", { method: "POST", headers });
}

/** Run `fn` with the two env vars set exactly as given, then restore them. */
function withEnv({ trusted, vercel }, fn) {
  const saved = {
    ARKAIK_TRUSTED_PROXY: process.env.ARKAIK_TRUSTED_PROXY,
    VERCEL: process.env.VERCEL,
  };
  const apply = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  apply("ARKAIK_TRUSTED_PROXY", trusted);
  apply("VERCEL", vercel);
  try {
    fn();
  } finally {
    apply("ARKAIK_TRUSTED_PROXY", saved.ARKAIK_TRUSTED_PROXY);
    apply("VERCEL", saved.VERCEL);
  }
}

function main() {
  const { publik } = loadPublikApi();
  const { deriveClientIp, trustsForwardedHeaders } = publik;

  const spoofed = reqWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  const realIpOnly = reqWith({ "x-real-ip": "203.0.113.9" });

  // --- 1. no proxy declared, not on Vercel: headers are ignored -------------
  withEnv({ trusted: undefined, vercel: undefined }, () => {
    check("default off-platform: forwarded headers are not trusted", trustsForwardedHeaders() === false);
    check(
      "default off-platform: a spoofable x-forwarded-for is ignored",
      deriveClientIp(spoofed) === "unknown",
      deriveClientIp(spoofed),
    );
    check(
      "default off-platform: x-real-ip is ignored too — same spoofability",
      deriveClientIp(realIpOnly) === "unknown",
      deriveClientIp(realIpOnly),
    );
    // The bypass this closes: two requests differing ONLY in their forwarded
    // header must land in the same bucket, or rotating the value resets the
    // throttle at will.
    const rotated = reqWith({ "x-forwarded-for": "198.51.100.4" });
    check(
      "default off-platform: rotating the header cannot move buckets",
      deriveClientIp(spoofed) === deriveClientIp(rotated),
    );
  });

  // --- 2. explicitly behind a trusted proxy --------------------------------
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    withEnv({ trusted: value, vercel: undefined }, () => {
      check(`ARKAIK_TRUSTED_PROXY=${value} trusts forwarded headers`, trustsForwardedHeaders() === true);
      check(
        `ARKAIK_TRUSTED_PROXY=${value} takes the FIRST hop, not the proxy's own address`,
        deriveClientIp(spoofed) === "203.0.113.7",
        deriveClientIp(spoofed),
      );
    });
  }

  withEnv({ trusted: "1", vercel: undefined }, () => {
    check(
      "trusted: x-real-ip is the fallback when there is no x-forwarded-for",
      deriveClientIp(realIpOnly) === "203.0.113.9",
      deriveClientIp(realIpOnly),
    );
    check(
      "trusted: a request carrying no forwarding headers still gets a bucket",
      deriveClientIp(reqWith({})) === "unknown",
      deriveClientIp(reqWith({})),
    );
  });

  // --- 3. Vercel is the safe default ---------------------------------------
  // The platform sets VERCEL itself and no request can forge it, so a Vercel
  // deployment keeps per-IP throttling with nothing configured. This is the
  // property that makes the strict default safe to ship.
  withEnv({ trusted: undefined, vercel: "1" }, () => {
    check("VERCEL set: forwarded headers are trusted with no configuration", trustsForwardedHeaders() === true);
    check(
      "VERCEL set: the first hop is the client address",
      deriveClientIp(spoofed) === "203.0.113.7",
      deriveClientIp(spoofed),
    );
  });

  // --- 4. an explicit "off" beats the platform default ---------------------
  for (const value of ["0", "false", "no"]) {
    withEnv({ trusted: value, vercel: "1" }, () => {
      check(
        `ARKAIK_TRUSTED_PROXY=${value} overrides the Vercel default`,
        trustsForwardedHeaders() === false && deriveClientIp(spoofed) === "unknown",
      );
    });
  }

  // Empty/whitespace is "not configured", not "off": it must fall through to
  // the platform default rather than silently disabling throttling on Vercel.
  withEnv({ trusted: "   ", vercel: "1" }, () => {
    check("a blank ARKAIK_TRUSTED_PROXY falls through to the platform default", trustsForwardedHeaders() === true);
  });

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} publik-ip test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll publik client-IP derivation tests passed.");
}

main();

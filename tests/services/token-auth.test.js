#!/usr/bin/env node

/**
 * Integration tests for API tokens and the getCaller() seam
 * (db/migrations/006_owners.sql, 007_api_tokens.sql; lib/services/auth.ts).
 *
 * Run against a real Postgres (the CI "services" job's container, or a local
 * instance) whose schema was applied by `npm run db:migrate`. Only the NextAuth
 * import is stubbed — token minting, verification, owner resolution, and the
 * bearer-vs-session precedence all execute for real.
 *
 * The security-critical assertions, and why each exists:
 *   - a tampered secret with a VALID prefix is rejected → the prefix is a lookup
 *     key, never a credential
 *   - a revoked or expired token is rejected at verification time, not mint time
 *   - a bad bearer token does NOT fall through to a valid session cookie → a
 *     revoked credential cannot keep working on ambient browser auth
 *   - token listing and revocation are owner-scoped → one tenant cannot see or
 *     kill another's credentials, and probing returns 404, not 403
 *
 * Test rows use the `tokentest-%@example.com` email pattern and are cleaned up
 * (cascading to owners/tokens) at start and end, so local re-runs are idempotent.
 */

const { Client } = require("pg");
const fs = require("fs");
const { loadTokenApi, BUILD_DIR } = require("./load-token-api");

const ORIGIN = "https://tokens.test";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function seedUser(client, label) {
  const email = `tokentest-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query(
    `insert into users (name, email) values ($1, $2) returning id`,
    [`tokentest ${label}`, email],
  );
  return rows[0].id;
}

/**
 * Remove only rows this test created. Owners are matched by their DERIVED id
 * (`own-u<testUserId>`) rather than by "any ownerless own-u% row" — the latter
 * would happily delete a real user's personal owner if this ever ran against a
 * developer's database instead of CI's throwaway container.
 */
async function cleanup(client) {
  const { rows } = await client.query(
    `select id from users where email like 'tokentest-%@example.com'`,
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const ownerIds = ids.map((id) => `own-u${id}`);

  await client.query(`delete from api_tokens where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owner_members where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owners where id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from users where id = any($1::int[])`, [ids]);
}

const sessionFor = (userId, name) => ({ user: { id: String(userId), name: name ?? "tokentest" } });
const tokenCtx = (id) => ({ params: Promise.resolve({ id }) });

function bearerReq(token, { method = "GET", url = `${ORIGIN}/api/graph` } = {}) {
  return new Request(url, { method, headers: { authorization: `Bearer ${token}` } });
}

function mintReq(body) {
  return new Request(`${ORIGIN}/api/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — this integration test needs a migrated Postgres.");
    process.exit(1);
  }
  // getCaller() refuses to resolve anyone unless auth is configured; these are
  // never used for a real OAuth round-trip (NextAuth itself is stubbed).
  process.env.AUTH_SECRET ||= "tokentest-secret";
  process.env.AUTH_GITHUB_ID ||= "tokentest-id";
  process.env.AUTH_GITHUB_SECRET ||= "tokentest-secret";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup(client);

  const api = loadTokenApi();
  const { tokens, owners, auth, setSession } = api;

  try {
    const userA = await seedUser(client, "a");
    const userB = await seedUser(client, "b");

    // --- Owner resolution ---------------------------------------------------
    const ownerA = (await owners.resolveOwnerIds(userA, "A"))[0];
    check("personal owner is created lazily for a new user", ownerA === `own-u${userA}`, ownerA);
    const ownerAgain = (await owners.resolveOwnerIds(userA, "A"))[0];
    check("owner resolution is idempotent", ownerAgain === ownerA);
    check(
      "membership check accepts the user's own owner",
      (await owners.userBelongsToOwner(userA, ownerA)) === true,
    );
    check(
      "membership check rejects another user's owner",
      (await owners.userBelongsToOwner(userB, ownerA)) === false,
    );

    // --- Mint and verify ----------------------------------------------------
    const minted = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "laptop",
      scopes: ["graph:read", "graph:write"],
    });
    check("minted plaintext uses the ark_ scheme", minted.plaintext.startsWith("ark_"), minted.plaintext);
    check(
      "minted plaintext embeds the record's public prefix",
      tokens.parseToken(minted.plaintext).prefix === minted.record.prefix,
    );

    const resolved = await tokens.verifyToken(minted.plaintext);
    check("a fresh token verifies", resolved !== null);
    check("verification returns the owner", resolved && resolved.ownerId === ownerA);
    check("verification returns the minting user", resolved && resolved.userId === userA);
    check(
      "verification returns the stored scopes",
      resolved && resolved.scopes.join(",") === "graph:read,graph:write",
      resolved && resolved.scopes.join(","),
    );

    // The secret is the credential; the prefix alone must be worthless.
    const parsed = tokens.parseToken(minted.plaintext);
    const tampered = `ark_${parsed.prefix}_${"x".repeat(parsed.secret.length)}`;
    check("a valid prefix with a wrong secret is rejected", (await tokens.verifyToken(tampered)) === null);
    check("an unknown prefix is rejected", (await tokens.verifyToken("ark_aabbccddeeff_zzzz")) === null);
    check("a malformed token is rejected", (await tokens.verifyToken("not-a-token")) === null);

    // REGRESSION: secrets are base64url, whose alphabet includes `_`. Parsing
    // with split("_") rejected roughly half of all issued tokens. Mint enough
    // that at least one secret is virtually certain to contain an underscore,
    // and require every one of them to verify.
    const underscoreSample = [];
    for (let i = 0; i < 12; i++) {
      underscoreSample.push(
        await tokens.mintToken({ ownerId: ownerA, userId: userA, name: `sample-${i}` }),
      );
    }
    const withUnderscore = underscoreSample.filter((t) =>
      tokens.parseToken(t.plaintext).secret.includes("_"),
    );
    check(
      "the sample contains at least one secret with an underscore",
      withUnderscore.length > 0,
      `0 of ${underscoreSample.length} — sample too small to prove the regression`,
    );
    let allVerified = true;
    for (const sample of underscoreSample) {
      if ((await tokens.verifyToken(sample.plaintext)) === null) allVerified = false;
    }
    check("every minted token verifies, underscores in the secret included", allVerified);
    check(
      "prefixes are hex, so the separator is never ambiguous",
      underscoreSample.every((t) => /^[0-9a-f]+$/.test(t.record.prefix)),
    );

    // --- Expiry -------------------------------------------------------------
    const expired = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "expired",
      expiresAt: new Date(Date.now() - 1000),
    });
    check("an expired token is rejected", (await tokens.verifyToken(expired.plaintext)) === null);

    // --- getCaller ----------------------------------------------------------
    setSession(null);
    const tokenCaller = await auth.getCaller(bearerReq(minted.plaintext));
    check("getCaller resolves a bearer token", tokenCaller !== null);
    check("token caller is marked via=token", tokenCaller && tokenCaller.via === "token");
    check(
      "token caller is scoped to exactly one owner",
      tokenCaller && tokenCaller.ownerIds.length === 1 && tokenCaller.ownerIds[0] === ownerA,
    );
    check(
      "token caller carries only its granted scopes",
      tokenCaller && !tokenCaller.scopes.includes("synk"),
      tokenCaller && tokenCaller.scopes.join(","),
    );
    check(
      "hasScope reflects the granted scopes",
      auth.hasScope(tokenCaller, "graph:write") === true && auth.hasScope(tokenCaller, "synk") === false,
    );

    // THE no-fallthrough rule: a signed-in browser session must not rescue a bad token.
    setSession(sessionFor(userA));
    const badBearerWithSession = await auth.getCaller(bearerReq("ark_zzzzzzzz_zzzz"));
    check(
      "a rejected bearer token does NOT fall through to a valid session",
      badBearerWithSession === null,
      JSON.stringify(badBearerWithSession),
    );

    const sessionCaller = await auth.getCaller(new Request(`${ORIGIN}/api/graph`));
    check("getCaller resolves a session when no bearer is present", sessionCaller !== null);
    check("session caller is marked via=session", sessionCaller && sessionCaller.via === "session");
    check(
      "session caller carries every scope",
      sessionCaller && sessionCaller.scopes.includes("synk") && sessionCaller.scopes.includes("graph:write"),
    );

    // --- Route: listing and isolation ---------------------------------------
    setSession(sessionFor(userA));
    const listA = await api.LIST_TOKENS();
    const bodyA = await listA.json();
    check("GET /api/tokens returns 200 for a signed-in user", listA.status === 200);
    check("listing includes the minted tokens", bodyA.tokens.length === 2, String(bodyA.tokens.length));
    check(
      "listing never leaks a secret or hash",
      JSON.stringify(bodyA).indexOf(parsed.secret) === -1 && !JSON.stringify(bodyA).includes("token_hash"),
    );

    setSession(sessionFor(userB));
    const listB = await api.LIST_TOKENS();
    const bodyB = await listB.json();
    check("another user sees none of those tokens", bodyB.tokens.length === 0, String(bodyB.tokens.length));

    setSession(null);
    check("GET /api/tokens unauthenticated returns 401", (await api.LIST_TOKENS()).status === 401);

    // --- Route: minting -----------------------------------------------------
    setSession(null);
    check(
      "POST /api/tokens unauthenticated returns 401",
      (await api.MINT_TOKEN(mintReq({ name: "x" }))).status === 401,
    );

    setSession(sessionFor(userA, "A"));
    const created = await api.MINT_TOKEN(mintReq({ name: "ci", scopes: ["graph:read"] }));
    const createdBody = await created.json();
    check("POST /api/tokens returns 201", created.status === 201, String(created.status));
    check("the 201 body carries the plaintext exactly once", typeof createdBody.secret === "string");
    check(
      "the minted token actually verifies",
      (await tokens.verifyToken(createdBody.secret)) !== null,
    );
    check(
      "POST rejects an unknown scope",
      (await api.MINT_TOKEN(mintReq({ name: "x", scopes: ["graph:admin"] }))).status === 400,
    );
    check(
      "POST rejects an empty scope list",
      (await api.MINT_TOKEN(mintReq({ name: "x", scopes: [] }))).status === 400,
    );
    check("POST rejects a blank name", (await api.MINT_TOKEN(mintReq({ name: "  " }))).status === 400);
    check(
      "POST rejects an owner the caller does not belong to",
      (await api.MINT_TOKEN(mintReq({ name: "x", owner_id: `own-u${userB}` }))).status === 404,
    );

    // --- Route: revocation --------------------------------------------------
    setSession(sessionFor(userB));
    const crossRevoke = await api.REVOKE_TOKEN(new Request(ORIGIN), tokenCtx(minted.record.id));
    check("revoking another user's token returns 404", crossRevoke.status === 404, String(crossRevoke.status));
    check(
      "the cross-user revoke attempt did not revoke anything",
      (await tokens.verifyToken(minted.plaintext)) !== null,
    );

    setSession(sessionFor(userA));
    const revoked = await api.REVOKE_TOKEN(new Request(ORIGIN), tokenCtx(minted.record.id));
    check("revoking own token returns 204", revoked.status === 204, String(revoked.status));
    check("a revoked token stops verifying", (await tokens.verifyToken(minted.plaintext)) === null);
    check(
      "revoking twice returns 404",
      (await api.REVOKE_TOKEN(new Request(ORIGIN), tokenCtx(minted.record.id))).status === 404,
    );
    check(
      "getCaller rejects the revoked token",
      (await auth.getCaller(bearerReq(minted.plaintext))) === null,
    );
  } finally {
    await cleanup(client);
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll token-auth checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

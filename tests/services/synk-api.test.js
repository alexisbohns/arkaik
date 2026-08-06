#!/usr/bin/env node

/**
 * Integration tests for the Synk API (docs/spec/services.md § Synk, § CI
 * Additions). The route handlers are invoked directly with real `Request`
 * objects against a real Postgres (the CI "services" job's Postgres 16 container,
 * or a local instance) whose schema was applied by `npm run db:migrate`. Only
 * NextAuth is stubbed, so `setSession()` picks the signed-in user without a live
 * OAuth round-trip while `getCaller` itself — bearer-vs-session precedence,
 * token verification, the `synk` scope check — runs for real.
 *
 * Coverage (the acceptance list from issue #242):
 *   - authz isolation: user B cannot read user A's projects/backups
 *   - content-hash dedupe (server-truth hash AND the advisory client header)
 *   - tier-limit rejection: entities and projects → 403 { limit, actual, tier }
 *   - retention prune keeps the newest backup even when it is itself stale
 *   - plus: store round-trip, DELETE cascade, unauthenticated → 401
 * Plus, from the #364 hardening pass:
 *   - a `synk`-scoped bearer token authenticates every Synk route (it used to
 *     authenticate nowhere: no handler read a bearer token at all)
 *   - a token WITHOUT that scope is refused 403, and a bad token does not fall
 *     through to a valid session cookie
 *   - an over-cap PUT body is refused 413 before it is parsed
 *
 * Two users are seeded directly in SQL so the isolation test has genuinely
 * distinct owners. All test rows use the `synktest-%@example.com` email pattern
 * and are cleaned up (cascading to synk rows) at start and end, so local re-runs
 * are idempotent.
 */

const { Client } = require("pg");
const { loadSynkApi, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-synk-api");
const fs = require("fs");

const ORIGIN = "https://synk.test";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A valid ProjectBundle with `nodeCount` view nodes (each a distinct entity). */
function makeBundle(projectId, nodeCount = 1, extra = {}) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `V-n${i}`,
      project_id: projectId,
      species: "view",
      title: `Node ${i}`,
      status: "idea",
      platforms: ["web"],
    });
  }
  return {
    project: {
      id: projectId,
      title: `Project ${projectId}`,
      version: "1.0.0",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes,
    edges: [],
    ...extra,
  };
}

function putReq(bundle, { header, bearer } = {}) {
  const headers = { "content-type": "application/json" };
  if (header) headers["x-bundle-sha256"] = header;
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new Request(`${ORIGIN}/api/synk/projects/x`, {
    method: "PUT",
    headers,
    // A string body is passed through verbatim — that is how the over-cap case
    // hands the handler more bytes than JSON.stringify of a real bundle would.
    body: typeof bundle === "string" ? bundle : JSON.stringify(bundle),
  });
}

function bareReq(method, { bearer } = {}) {
  const headers = {};
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new Request(`${ORIGIN}/api/synk`, { method, headers });
}

/** GET /api/synk/projects now reads credentials off the request, so it needs one. */
function listReq({ bearer } = {}) {
  const headers = {};
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new Request(`${ORIGIN}/api/synk/projects`, { headers });
}

const projectCtx = (projectId) => ({ params: Promise.resolve({ projectId }) });
const backupCtx = (backupId) => ({ params: Promise.resolve({ backupId }) });

async function seedUser(client, label) {
  const email = `synktest-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query(
    `insert into users (name, email) values ($1, $2) returning id`,
    [`synktest ${label}`, email],
  );
  return rows[0].id;
}

/**
 * Remove only rows this test created. `delete from users` cascades to the synk
 * tables and to owner_members, but NOT to `owners` — a personal owner row has no
 * user foreign key by design (db/migrations/006_owners.sql). Now that the Synk
 * handlers go through `getCaller`, every authenticated request resolves (and
 * lazily creates) one, so they have to be swept explicitly. Matched by DERIVED
 * id, exactly as tests/services/graph-api.test.js does and for the same reason:
 * "any ownerless own-u% row" would happily delete a real user's personal owner
 * if this were ever run against a developer's database.
 */
async function cleanup(client) {
  const { rows } = await client.query(
    `select id from users where email like 'synktest-%@example.com'`,
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const ownerIds = ids.map((id) => `own-u${id}`);
  await client.query(`delete from api_tokens where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owner_members where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owners where id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from users where id = any($1::int[])`, [ids]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n[synk-api.test] DATABASE_URL is not set. These integration tests require a " +
        "migrated Postgres (the CI services job sets it; locally, start Postgres and " +
        "`npm run db:migrate` first). Refusing to pass silently.",
    );
    process.exit(1);
  }

  // `getCaller` refuses everything unless auth is configured — it reads env at
  // call time, so setting them here is enough (no OAuth round-trip happens: the
  // NextAuth import is stubbed).
  process.env.AUTH_SECRET ||= "synktest-secret";
  process.env.AUTH_GITHUB_ID ||= "synktest-id";
  process.env.AUTH_GITHUB_SECRET ||= "synktest-secret";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Idempotent local re-runs: purge any prior test users (cascades to synk rows).
  await cleanup(client);

  const {
    LIST_PROJECTS,
    PUT_BACKUP,
    DELETE_PROJECT,
    LIST_BACKUPS,
    GET_BACKUP,
    setSession,
    synk,
    tokens,
    owners,
  } = loadSynkApi();

  const asUser = (id) => setSession(id == null ? null : { user: { id: String(id) } });

  try {
    // --- 0. store round-trip + list + fetch --------------------------------
    {
      const uid = await seedUser(client, "roundtrip");
      asUser(uid);
      const res = await PUT_BACKUP(putReq(makeBundle("p-round", 2)), projectCtx("p-round"));
      const body = await res.json();
      check("store returns 201", res.status === 201, `status ${res.status}`);
      check("store body reports deduped:false + backup id", body.deduped === false && typeof body.id === "string", JSON.stringify(body));

      const listRes = await LIST_PROJECTS(listReq());
      const listBody = await listRes.json();
      check("list projects returns 200", listRes.status === 200, `status ${listRes.status}`);
      check(
        "list projects shows the backed-up project with latest metadata",
        Array.isArray(listBody.projects) &&
          listBody.projects.length === 1 &&
          listBody.projects[0].project_id === "p-round" &&
          listBody.projects[0].latest_entity_count === 2,
        JSON.stringify(listBody.projects),
      );

      const backupsRes = await LIST_BACKUPS(bareReq("GET"), projectCtx("p-round"));
      const backupsBody = await backupsRes.json();
      check(
        "list backups returns one version with hash + size + entity_count",
        backupsRes.status === 200 &&
          backupsBody.backups.length === 1 &&
          typeof backupsBody.backups[0].sha256 === "string" &&
          backupsBody.backups[0].entity_count === 2,
        JSON.stringify(backupsBody),
      );

      const getRes = await GET_BACKUP(bareReq("GET"), backupCtx(body.id));
      const fetched = await getRes.json();
      check("get backup returns the stored bundle verbatim", getRes.status === 200 && fetched.project.id === "p-round", JSON.stringify(fetched.project));
      check("backup keeps its journal-capable bundle (nodes intact)", Array.isArray(fetched.nodes) && fetched.nodes.length === 2);
    }

    // --- 1. content-hash dedupe --------------------------------------------
    {
      const uid = await seedUser(client, "dedupe");
      asUser(uid);
      const bundle = makeBundle("p-dupe", 3);

      const first = await PUT_BACKUP(putReq(bundle), projectCtx("p-dupe"));
      check("dedupe: first store is 201", first.status === 201, `status ${first.status}`);

      // Server recomputes the hash from its own canonicalization → dedupe.
      const second = await PUT_BACKUP(putReq(bundle), projectCtx("p-dupe"));
      const secondBody = await second.json();
      check("dedupe: identical re-backup returns 200", second.status === 200, `status ${second.status}`);
      check("dedupe: 200 body reports deduped:true", secondBody.deduped === true, JSON.stringify(secondBody));

      // Advisory client header equal to the stored hash → early skip, also 200.
      const { rows } = await client.query(
        `select sha256 from synk_backups where user_id = $1 and project_id = $2 order by created_at desc limit 1`,
        [uid, "p-dupe"],
      );
      const storedHash = rows[0].sha256;
      const third = await PUT_BACKUP(putReq(bundle, { header: storedHash }), projectCtx("p-dupe"));
      const thirdBody = await third.json();
      check("dedupe: matching x-bundle-sha256 header returns 200 deduped", third.status === 200 && thirdBody.deduped === true, JSON.stringify(thirdBody));

      const { rows: countRows } = await client.query(
        `select count(*)::int as n from synk_backups where user_id = $1 and project_id = $2`,
        [uid, "p-dupe"],
      );
      check("dedupe: no extra backup rows were stored", countRows[0].n === 1, `rows ${countRows[0].n}`);

      // A genuine change stores a new version.
      const changed = await PUT_BACKUP(putReq(makeBundle("p-dupe", 4)), projectCtx("p-dupe"));
      check("dedupe: a changed bundle stores a new version (201)", changed.status === 201, `status ${changed.status}`);
      const { rows: after } = await client.query(
        `select count(*)::int as n from synk_backups where user_id = $1 and project_id = $2`,
        [uid, "p-dupe"],
      );
      check("dedupe: changed bundle added exactly one version", after[0].n === 2, `rows ${after[0].n}`);
    }

    // --- 2. tier-limit rejection: entities ---------------------------------
    {
      const uid = await seedUser(client, "entlimit");
      asUser(uid);
      // 251 nodes → 251 entities, over the synk cap of 250.
      const res = await PUT_BACKUP(putReq(makeBundle("p-ent", 251)), projectCtx("p-ent"));
      const body = await res.json();
      check("entities over limit returns 403", res.status === 403, `status ${res.status}`);
      check(
        "403 body carries { limit, actual, tier }",
        body.limit === 250 && body.actual === 251 && body.tier === "synk",
        JSON.stringify(body),
      );
      const { rows } = await client.query(`select count(*)::int as n from synk_backups where user_id = $1`, [uid]);
      check("rejected over-limit backup stored nothing", rows[0].n === 0, `rows ${rows[0].n}`);
    }

    // --- 3. tier-limit rejection: projects ---------------------------------
    {
      const uid = await seedUser(client, "projlimit");
      asUser(uid);
      const first = await PUT_BACKUP(putReq(makeBundle("p-a", 1)), projectCtx("p-a"));
      check("projects limit: first project stores (201)", first.status === 201, `status ${first.status}`);
      // Second DISTINCT project would make 2 > synk cap of 1.
      const second = await PUT_BACKUP(putReq(makeBundle("p-b", 1)), projectCtx("p-b"));
      const body = await second.json();
      check("second distinct project returns 403", second.status === 403, `status ${second.status}`);
      check(
        "projects 403 body carries { limit:1, actual:2, tier:synk }",
        body.limit === 1 && body.actual === 2 && body.tier === "synk",
        JSON.stringify(body),
      );
      // Re-backing the EXISTING project is not a new project → allowed.
      const reBackup = await PUT_BACKUP(putReq(makeBundle("p-a", 2)), projectCtx("p-a"));
      check("re-backing an existing project is allowed (201)", reBackup.status === 201, `status ${reBackup.status}`);
    }

    // --- 4. authz isolation: user B cannot read user A's rows --------------
    {
      const userA = await seedUser(client, "isoA");
      const userB = await seedUser(client, "isoB");

      // Both back up a project with the SAME client-chosen id.
      asUser(userA);
      const aRes = await PUT_BACKUP(putReq(makeBundle("shared", 2)), projectCtx("shared"));
      const aBody = await aRes.json();
      check("isolation: user A stores backup", aRes.status === 201, `status ${aRes.status}`);
      const aBackupId = aBody.id;

      asUser(userB);
      const bRes = await PUT_BACKUP(putReq(makeBundle("shared", 3)), projectCtx("shared"));
      const bBody = await bRes.json();
      check("isolation: user B stores backup under same project id", bRes.status === 201, `status ${bRes.status}`);
      const bBackupId = bBody.id;

      // User B lists backups for "shared": only their own row.
      const bList = await LIST_BACKUPS(bareReq("GET"), projectCtx("shared"));
      const bListBody = await bList.json();
      check(
        "isolation: user B sees only their own backup for the shared project id",
        bListBody.backups.length === 1 && bListBody.backups[0].id === bBackupId,
        JSON.stringify(bListBody.backups),
      );

      // User B cannot fetch user A's backup by id → 404.
      const bGetA = await GET_BACKUP(bareReq("GET"), backupCtx(aBackupId));
      check("isolation: user B GET of user A's backup id is 404", bGetA.status === 404, `status ${bGetA.status}`);

      // User A can still fetch their own.
      asUser(userA);
      const aGetA = await GET_BACKUP(bareReq("GET"), backupCtx(aBackupId));
      check("isolation: user A can fetch their own backup", aGetA.status === 200, `status ${aGetA.status}`);

      // User A's project list does not leak user B's rows.
      const aProjects = await (await LIST_PROJECTS(listReq())).json();
      check(
        "isolation: user A's project list is scoped to user A",
        aProjects.projects.length === 1 && aProjects.projects[0].latest_backup_id === aBackupId,
        JSON.stringify(aProjects.projects),
      );

      // User B deleting "shared" removes only B's rows; A's survive.
      asUser(userB);
      const bDel = await DELETE_PROJECT(bareReq("DELETE"), projectCtx("shared"));
      check("isolation: user B deletes their project (204)", bDel.status === 204, `status ${bDel.status}`);
      asUser(userA);
      const aStill = await GET_BACKUP(bareReq("GET"), backupCtx(aBackupId));
      check("isolation: user A's backup survives user B's delete", aStill.status === 200, `status ${aStill.status}`);

      // Delete cascade: after A deletes their project, its backups are gone.
      const aDel = await DELETE_PROJECT(bareReq("DELETE"), projectCtx("shared"));
      check("delete: user A deletes their project (204)", aDel.status === 204, `status ${aDel.status}`);
      const { rows: gone } = await client.query(`select count(*)::int as n from synk_backups where id = $1`, [aBackupId]);
      check("delete cascade removes the project's backups", gone[0].n === 0, `rows ${gone[0].n}`);
      const aGone = await GET_BACKUP(bareReq("GET"), backupCtx(aBackupId));
      check("delete: fetching a deleted backup is 404", aGone.status === 404, `status ${aGone.status}`);
    }

    // --- 5. retention prune keeps the newest even when stale ---------------
    {
      const uid = await seedUser(client, "retain");
      // Seed the project + three backups directly, ALL older than the 7-day
      // window (10, 9, 8 days ago). No fresh backup is written, so the newest
      // retained row (8 days ago) is itself stale.
      await client.query(`insert into synk_projects (user_id, id, title) values ($1, $2, $3)`, [uid, "p-old", "Old"]);
      const seedBackup = async (id, daysAgo) =>
        client.query(
          `insert into synk_backups (id, user_id, project_id, bundle, sha256, size_bytes, entity_count, created_at)
           values ($1, $2, $3, '{}'::jsonb, $4, 2, 1, now() - make_interval(days => $5::int))`,
          [id, uid, "p-old", `hash-${daysAgo}`, daysAgo],
        );
      await seedBackup("b-10", 10);
      await seedBackup("b-9", 9);
      await seedBackup("b-8", 8); // newest (least days ago), still > 7 days → stale

      const pruned = await synk.pruneRetention(uid, "p-old", 7);
      check("retention: prune removed the two older stale backups", pruned === 2, `pruned ${pruned}`);

      const { rows } = await client.query(
        `select id from synk_backups where user_id = $1 and project_id = $2 order by created_at desc`,
        [uid, "p-old"],
      );
      check(
        "retention: the newest backup survives even though it is itself stale",
        rows.length === 1 && rows[0].id === "b-8",
        JSON.stringify(rows),
      );

      // And pruning runs on write: seed two more stale rows, then a real PUT
      // (fresh, distinct content) prunes every now-stale row but its own.
      await seedBackup("b-6", 6);
      await seedBackup("b-5", 5);
      asUser(uid);
      const wRes = await PUT_BACKUP(putReq(makeBundle("p-old", 2)), projectCtx("p-old"));
      check("retention-on-write: fresh backup stores (201)", wRes.status === 201, `status ${wRes.status}`);
      const { rows: afterWrite } = await client.query(
        `select id from synk_backups where user_id = $1 and project_id = $2`,
        [uid, "p-old"],
      );
      // Only the just-written fresh backup remains: b-8 (8d), b-6 (6d), b-5 (5d)
      // were all < now()-7d? b-6 and b-5 are inside the window, so they survive
      // too. Assert the fresh one is present and the >7d ones (b-8) are gone.
      const ids = afterWrite.map((r) => r.id);
      check("retention-on-write: the stale >7d backup (b-8) was pruned", !ids.includes("b-8"), JSON.stringify(ids));
      check("retention-on-write: in-window backups (b-6, b-5) survive", ids.includes("b-6") && ids.includes("b-5"), JSON.stringify(ids));
    }

    // --- 6. unauthenticated → 401 ------------------------------------------
    {
      asUser(null);
      const listRes = await LIST_PROJECTS(listReq());
      check("unauthenticated list projects is 401", listRes.status === 401, `status ${listRes.status}`);
      const putRes = await PUT_BACKUP(putReq(makeBundle("nope", 1)), projectCtx("nope"));
      check("unauthenticated PUT is 401", putRes.status === 401, `status ${putRes.status}`);
      const getRes = await GET_BACKUP(bareReq("GET"), backupCtx("whatever"));
      check("unauthenticated GET backup is 401", getRes.status === 401, `status ${getRes.status}`);
      const delRes = await DELETE_PROJECT(bareReq("DELETE"), projectCtx("nope"));
      check("unauthenticated DELETE is 401", delRes.status === 401, `status ${delRes.status}`);
    }

    // --- 7. `synk`-scoped bearer tokens ------------------------------------
    // The scope was mintable from the settings UI long before any route read a
    // bearer token, so a synk-only token authenticated NOWHERE: graph routes
    // refused it for insufficient scope and Synk 401'd it for having no cookie.
    {
      const uid = await seedUser(client, "bearer");
      const ownerId = (await owners.resolveOwnerIds(uid))[0];
      const synkToken = await tokens.mintToken({
        ownerId,
        userId: uid,
        name: "synk agent",
        scopes: ["synk"],
      });
      const graphToken = await tokens.mintToken({
        ownerId,
        userId: uid,
        name: "graph agent",
        scopes: ["graph:read", "graph:write"],
      });

      // Signed OUT for every assertion below: the token is the only credential.
      asUser(null);

      const stored = await PUT_BACKUP(
        putReq(makeBundle("p-bearer", 2), { bearer: synkToken.plaintext }),
        projectCtx("p-bearer"),
      );
      const storedBody = await stored.json();
      check("bearer: a synk-scoped token can PUT a backup (201)", stored.status === 201, `status ${stored.status}`);

      const listed = await LIST_PROJECTS(listReq({ bearer: synkToken.plaintext }));
      const listedBody = await listed.json();
      check(
        "bearer: the token's listing is scoped to its own user",
        listed.status === 200 &&
          listedBody.projects.length === 1 &&
          listedBody.projects[0].project_id === "p-bearer",
        JSON.stringify(listedBody),
      );

      const fetched = await GET_BACKUP(bareReq("GET", { bearer: synkToken.plaintext }), backupCtx(storedBody.id));
      check("bearer: a synk-scoped token can fetch its own backup", fetched.status === 200, `status ${fetched.status}`);

      const versions = await LIST_BACKUPS(bareReq("GET", { bearer: synkToken.plaintext }), projectCtx("p-bearer"));
      check("bearer: a synk-scoped token can list backup versions", versions.status === 200, `status ${versions.status}`);

      // Wrong scope → 403 with the scope it needed, matching the graph routes.
      const wrongScope = await LIST_PROJECTS(listReq({ bearer: graphToken.plaintext }));
      const wrongScopeBody = await wrongScope.json();
      check(
        "bearer: a graph-only token is refused 403 insufficient_scope",
        wrongScope.status === 403 && wrongScopeBody.required === "synk",
        `${wrongScope.status} ${JSON.stringify(wrongScopeBody)}`,
      );
      const wrongScopePut = await PUT_BACKUP(
        putReq(makeBundle("p-nope", 1), { bearer: graphToken.plaintext }),
        projectCtx("p-nope"),
      );
      check("bearer: a graph-only token cannot PUT (403)", wrongScopePut.status === 403, `status ${wrongScopePut.status}`);

      // A presented-but-bad token must NOT fall through to a valid session:
      // otherwise a revoked credential keeps working on ambient browser auth.
      asUser(uid);
      const garbage = await LIST_PROJECTS(listReq({ bearer: "ark_deadbeef_nonsense" }));
      check(
        "bearer: a bad token does not fall through to the session (401)",
        garbage.status === 401,
        `status ${garbage.status}`,
      );

      // And the session path still works untouched.
      const sessionList = await LIST_PROJECTS(listReq());
      check("bearer: the session path still lists the same project", sessionList.status === 200, `status ${sessionList.status}`);

      // Deleting via the token cleans up and proves the write verb too.
      asUser(null);
      const del = await DELETE_PROJECT(bareReq("DELETE", { bearer: synkToken.plaintext }), projectCtx("p-bearer"));
      check("bearer: a synk-scoped token can DELETE its project (204)", del.status === 204, `status ${del.status}`);
    }

    // --- 8. over-cap body refused before it is parsed (413) ----------------
    {
      const uid = await seedUser(client, "toobig");
      asUser(uid);
      // Just over the shared 5 MB cap, and deliberately NOT a valid bundle: a
      // 422 here would mean the body was parsed and validated before the size
      // check, which is the thing the cap exists to prevent.
      const oversized = JSON.stringify({ blob: "x".repeat(5 * 1024 * 1024) });
      const res = await PUT_BACKUP(putReq(oversized), projectCtx("p-big"));
      check("over-cap PUT returns 413", res.status === 413, `status ${res.status}`);
      const { rows } = await client.query(`select count(*)::int as n from synk_backups where user_id = $1`, [uid]);
      check("over-cap PUT stored nothing", rows[0].n === 0, `rows ${rows[0].n}`);

      // A body just UNDER the cap still stores, so the check is a ceiling and
      // not a blanket refusal. `description` is free-form on a project.
      const padded = makeBundle("p-big", 1);
      padded.project.description = "y".repeat(1024 * 1024);
      const ok = await PUT_BACKUP(putReq(padded), projectCtx("p-big"));
      check("under-cap PUT still stores (201)", ok.status === 201, `status ${ok.status}`);
    }

    // --- 9. the limits hold under concurrency ------------------------------
    // Sequentially they always did. putBackup used to run its project count,
    // its project upsert and its backup insert as separate pooled statements,
    // so simultaneous first-ever PUTs from one user all read count = 0 and all
    // stored — past the tier's 1-project cap, with no request ever seeing a
    // limit. The count now happens under a per-user advisory lock inside the
    // transaction that writes.
    {
      const uid = await seedUser(client, "concurrent");
      asUser(uid);
      const burst = await Promise.all(
        ["c-a", "c-b", "c-c"].map((pid) => PUT_BACKUP(putReq(makeBundle(pid, 1)), projectCtx(pid))),
      );
      const stored = burst.filter((res) => res.status === 201).length;
      const refused = burst.filter((res) => res.status === 403).length;
      check("concurrency: three simultaneous new projects stop at the 1-project cap", stored === 1, `stored ${stored}`);
      check("concurrency: the other two are refused 403", refused === 2, `refused ${refused}`);
      const { rows } = await client.query(
        `select count(*)::int as n from synk_projects where user_id = $1`,
        [uid],
      );
      check("concurrency: exactly one project row exists", rows[0].n === 1, `rows ${rows[0].n}`);
    }

    // Dedupe is the other half of the same lock: identical content sent at the
    // same time used to pass step 3 in every request (all comparing against the
    // same pre-write hash) and store a version each, which is exactly what the
    // content-hash contract says cannot happen.
    {
      const uid = await seedUser(client, "dedupe-race");
      asUser(uid);
      const bundle = makeBundle("c-dupe", 2);
      const burst = await Promise.all(
        Array.from({ length: 4 }, () => PUT_BACKUP(putReq(bundle), projectCtx("c-dupe"))),
      );
      const created = burst.filter((res) => res.status === 201).length;
      const deduped = burst.filter((res) => res.status === 200).length;
      check("concurrency: four identical simultaneous PUTs store once", created === 1, `created ${created}`);
      check("concurrency: the other three report deduped", deduped === 3, `deduped ${deduped}`);
      const { rows } = await client.query(
        `select count(*)::int as n from synk_backups where user_id = $1 and project_id = $2`,
        [uid, "c-dupe"],
      );
      check("concurrency: exactly one backup row was written", rows[0].n === 1, `rows ${rows[0].n}`);
    }
  } finally {
    // Clean up all test rows (cascades to synk_projects + synk_backups).
    await cleanup(client);
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`\n${failures} synk-api test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll synk-api integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

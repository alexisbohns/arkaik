#!/usr/bin/env node

/**
 * Integration tests for the Synk API (docs/spec/services.md § Synk, § CI
 * Additions). The route handlers are invoked directly with real `Request`
 * objects against a real Postgres (the CI "services" job's Postgres 16 container,
 * or a local instance) whose schema was applied by `npm run db:migrate`. The
 * `getSession()` seam is stubbed at the module boundary (as
 * tests/services/auth-guard.test.js does) so `setSession()` picks the acting
 * user without a live OAuth round-trip.
 *
 * Coverage (the acceptance list from issue #242):
 *   - authz isolation: user B cannot read user A's projects/backups
 *   - content-hash dedupe (server-truth hash AND the advisory client header)
 *   - tier-limit rejection: entities and projects → 403 { limit, actual, tier }
 *   - retention prune keeps the newest backup even when it is itself stale
 *   - plus: store round-trip, DELETE cascade, unauthenticated → 401
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

function putReq(bundle, { header } = {}) {
  const headers = { "content-type": "application/json" };
  if (header) headers["x-bundle-sha256"] = header;
  return new Request(`${ORIGIN}/api/synk/projects/x`, {
    method: "PUT",
    headers,
    body: JSON.stringify(bundle),
  });
}

function bareReq(method) {
  return new Request(`${ORIGIN}/api/synk`, { method });
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n[synk-api.test] DATABASE_URL is not set. These integration tests require a " +
        "migrated Postgres (the CI services job sets it; locally, start Postgres and " +
        "`npm run db:migrate` first). Refusing to pass silently.",
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Idempotent local re-runs: purge any prior test users (cascades to synk rows).
  await client.query(`delete from users where email like 'synktest-%@example.com'`);

  const { LIST_PROJECTS, PUT_BACKUP, DELETE_PROJECT, LIST_BACKUPS, GET_BACKUP, setSession, synk } =
    loadSynkApi();

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

      const listRes = await LIST_PROJECTS();
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
      const aProjects = await (await LIST_PROJECTS()).json();
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
      const listRes = await LIST_PROJECTS();
      check("unauthenticated list projects is 401", listRes.status === 401, `status ${listRes.status}`);
      const putRes = await PUT_BACKUP(putReq(makeBundle("nope", 1)), projectCtx("nope"));
      check("unauthenticated PUT is 401", putRes.status === 401, `status ${putRes.status}`);
      const getRes = await GET_BACKUP(bareReq("GET"), backupCtx("whatever"));
      check("unauthenticated GET backup is 401", getRes.status === 401, `status ${getRes.status}`);
      const delRes = await DELETE_PROJECT(bareReq("DELETE"), projectCtx("nope"));
      check("unauthenticated DELETE is 401", delRes.status === 401, `status ${delRes.status}`);
    }
  } finally {
    // Clean up all test rows (cascades to synk_projects + synk_backups).
    await client.query(`delete from users where email like 'synktest-%@example.com'`);
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

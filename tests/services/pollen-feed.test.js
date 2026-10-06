#!/usr/bin/env node

/**
 * Integration tests for the pollen feed
 * (app/api/graph/projects/[projectId]/pollen, lib/pollen/map.ts against a
 * real journal in Postgres).
 *
 * The properties that matter most here:
 *   - the feed is OPT-IN: a project without `metadata.pollen.plant` answers
 *     the same 404 as a project that does not exist;
 *   - cursor semantics are exactly docs/POLLEN.md § Report: server order,
 *     `after` = last processed pollen id, unknown `after` → 410 Gone,
 *     empty array = caught up, limit capped at 200;
 *   - every served envelope passes the vendored reference validator;
 *   - auth is the ordinary graph read plane (401 / 403 / cross-owner 404);
 *   - the feed answers conditionally (issue #490): a weak ETag on every 200,
 *     a bodiless 304 for a matching If-None-Match that loads neither the
 *     bundle nor the journal, and a 410 that still wins for an unknown cursor.
 *
 * Same harness as graph-api.test.js: only NextAuth is stubbed; store, tokens,
 * owners, scopes and Postgres run for real. Rows use the
 * `graphtest-%@example.com` pattern and are cleaned up on both ends.
 */

const { Client } = require("pg");
const fs = require("fs");
const { loadGraphApi, BUILD_DIR } = require("./load-graph-api");
const { loadPollen } = require("../app/load-pollen");

const ORIGIN = "https://graph.test";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ctx = (projectId) => ({ params: Promise.resolve({ projectId }) });
const sessionFor = (userId) => ({ user: { id: String(userId), name: "graphtest" } });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

function jsonReq(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// 26-char Crockford-safe ids (no I, L, O, U).
const E1 = "01KTEST0000000000000000001";
const E2 = "01KTEST0000000000000000002";
const E3 = "01KTEST0000000000000000003";
const E4 = "01KTEST0000000000000000004";
const E5 = "01KTEST0000000000000000005";

const JOURNAL = [
  {
    id: E1,
    ts: "2026-08-10T10:00:00.000Z",
    actor: "github-app",
    type: "deliverable.shipped",
    deliverable_id: "pr-1",
    title: "Find your way around",
    summary: "A sidebar on wide screens.",
    url: "https://github.com/x/y/pull/1",
    lab_note: {
      en: { title: "Find your way around", summary: "A sidebar on wide screens." },
      fr: { title: "Trouve ton chemin", summary: "Une barre latérale sur grand écran." },
    },
  },
  { id: E2, ts: "2026-08-11T10:00:00.000Z", actor: "arkaik-cli", type: "release.tagged", version: "1.0.0" },
  { id: E3, ts: "2026-08-12T10:00:00.000Z", actor: "seed", type: "node.created", node_id: "V-a", species: "view", title: "V-a" },
  {
    id: E4,
    ts: "2026-08-13T10:00:00.000Z",
    actor: "github-app",
    type: "deliverable.shipped",
    deliverable_id: "pr-1",
    title: "Find your way around, edited",
    summary: "A sidebar, now with a map.",
    url: "https://github.com/x/y/pull/1",
  },
];

function bundle(withPollen) {
  return {
    schema_version: 3,
    project: {
      id: "gp-pollen",
      title: "Pollen feed test",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...(withPollen ? { metadata: { pollen: { plant: "pbbls" } } } : {}),
    },
    nodes: [
      { id: "V-a", project_id: "gp-pollen", species: "view", title: "V-a", status: "idea", platforms: ["web"] },
    ],
    edges: [],
    journal: JOURNAL,
  };
}

async function seedUser(client, label) {
  const email = `graphtest-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query(
    `insert into users (name, email) values ($1, $2) returning id`,
    [`graphtest ${label}`, email],
  );
  return rows[0].id;
}

async function cleanup(client) {
  const { rows } = await client.query(
    `select id from users where email like 'graphtest-%@example.com'`,
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  const ownerIds = ids.map((id) => `own-u${id}`);
  await client.query(`delete from graph_projects where owner_id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from api_tokens where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owner_members where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owners where id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from users where id = any($1::int[])`, [ids]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — this integration test needs a migrated Postgres.");
    process.exit(1);
  }
  process.env.AUTH_SECRET ||= "graphtest-secret";
  process.env.AUTH_GITHUB_ID ||= "graphtest-id";
  process.env.AUTH_GITHUB_SECRET ||= "graphtest-secret";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup(client);

  const api = loadGraphApi();
  const { tokens, owners, setSession } = api;
  const { contract } = loadPollen();
  const { validatePollen } = contract;

  try {
    const userA = await seedUser(client, "pollen-a");
    const userB = await seedUser(client, "pollen-b");
    const ownerA = (await owners.resolveOwnerIds(userA))[0];
    const ownerB = (await owners.resolveOwnerIds(userB))[0];

    const tokenA = await tokens.mintToken({ ownerId: ownerA, userId: userA, name: "reader", scopes: ["graph:read"] });
    const noReadToken = await tokens.mintToken({ ownerId: ownerA, userId: userA, name: "scopeless", scopes: [] });
    const tokenB = await tokens.mintToken({ ownerId: ownerB, userId: userB, name: "other", scopes: ["graph:read"] });

    setSession(sessionFor(userA));
    const created = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle(true)));
    const createdBody = await created.json();
    check("federated project imports", created.status === 201, JSON.stringify(createdBody));
    const projectId = createdBody.id;

    const plain = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle(false)));
    const plainId = (await plain.json()).id;
    setSession(null);

    const feedUrl = (id, qs = "") => `${ORIGIN}/api/graph/projects/${id}/pollen${qs}`;
    const get = (id, qs, headers) => api.GET_POLLEN(new Request(feedUrl(id, qs), { headers }), ctx(id));

    // --- auth plane ---------------------------------------------------------
    check("no token → 401", (await get(projectId, "")).status === 401);
    check("token without graph:read → 403", (await get(projectId, "", bearer(noReadToken.plaintext))).status === 403);
    check("other owner's token → 404", (await get(projectId, "", bearer(tokenB.plaintext))).status === 404);

    // --- opt-in -------------------------------------------------------------
    check("project without metadata.pollen → 404", (await get(plainId, "", bearer(tokenA.plaintext))).status === 404);

    // --- full read ----------------------------------------------------------
    const full = await get(projectId, "", bearer(tokenA.plaintext));
    const fullBody = await full.json();
    check("full read is 200", full.status === 200, String(full.status));
    const pollen = fullBody.pollen ?? [];
    check("three envelopes (node.created is noise)", pollen.length === 3, JSON.stringify(pollen.map((p) => p.id)));
    check("server order by seq", pollen.map((p) => p.id).join(",") === `arkaik:${E1},arkaik:${E2},arkaik:${E4}`);
    check("bilingual title served", pollen[0].title.fr === "Trouve ton chemin");
    check("re-append corrects the first occurrence", pollen[2].refs.some((r) => r.label === "corrects" && r.ref === `arkaik:${E1}`));
    check("every envelope validates", pollen.every((p) => validatePollen(p).ok));

    // --- paging -------------------------------------------------------------
    const page1 = await (await get(projectId, "?limit=1", bearer(tokenA.plaintext))).json();
    check("limit=1 serves the first envelope", page1.pollen.length === 1 && page1.pollen[0].id === `arkaik:${E1}`);
    const page2 = await (await get(projectId, `?after=arkaik:${E1}&limit=10`, bearer(tokenA.plaintext))).json();
    check("after=e1 serves the rest", page2.pollen.map((p) => p.id).join(",") === `arkaik:${E2},arkaik:${E4}`);
    const caughtUp = await (await get(projectId, `?after=arkaik:${E4}`, bearer(tokenA.plaintext))).json();
    check("after=last is caught up (empty array)", Array.isArray(caughtUp.pollen) && caughtUp.pollen.length === 0);

    // --- cursor reset + limit cap -------------------------------------------
    check("unknown cursor → 410", (await get(projectId, "?after=arkaik:NOPE", bearer(tokenA.plaintext))).status === 410);
    check("oversize limit is capped, not an error", (await get(projectId, "?limit=999", bearer(tokenA.plaintext))).status === 200);

    // --- conditional reads (#490) --------------------------------------------
    //
    // The whole section runs with `getProject` and `getJournal` spied: the
    // route must call NEITHER on any path, 200 or 304 — the point of #490 is
    // that a poll never pulls the bundle or the journal body out of Postgres.
    // The spy works because the transpiled route reads the function off the
    // store module object at call time.
    const loads = [];
    const { getProject: realGetProject, getJournal: realGetJournal } = api.store;
    api.store.getProject = (...args) => { loads.push("getProject"); return realGetProject(...args); };
    api.store.getJournal = (...args) => { loads.push("getJournal"); return realGetJournal(...args); };
    try {
      const first = await get(projectId, "?limit=10", bearer(tokenA.plaintext));
      const etag = first.headers.get("etag");
      check("200 carries a weak ETag", typeof etag === "string" && /^W\/"/.test(etag), String(etag));
      check(
        "200 carries the read cache headers",
        first.headers.get("cache-control") === "private, no-cache" && first.headers.get("vary") === "Authorization",
      );

      const inm = (tag) => ({ ...bearer(tokenA.plaintext), "if-none-match": tag });
      const cond = await get(projectId, "?limit=10", inm(etag));
      check("matching If-None-Match → 304", cond.status === 304, String(cond.status));
      check("304 has no body", (await cond.text()) === "");
      check("304 re-stamps the same ETag", cond.headers.get("etag") === etag);
      check("304 carries the read cache headers too", cond.headers.get("cache-control") === "private, no-cache");

      const otherPage = await get(projectId, `?limit=10&after=arkaik:${E1}`, inm(etag));
      check("the same validator for a different page → 200, never a 304", otherPage.status === 200, String(otherPage.status));
      const otherLimit = await get(projectId, "?limit=20", inm(etag));
      check("…and a different limit is a different page as well", otherLimit.status === 200, String(otherLimit.status));

      const caughtUpRes = await get(projectId, `?after=arkaik:${E4}`, bearer(tokenA.plaintext));
      const caughtUpTag = caughtUpRes.headers.get("etag");
      check("a caught-up page has its own ETag", typeof caughtUpTag === "string" && caughtUpTag !== etag, String(caughtUpTag));
      check(
        "a caught-up poll that finds nothing new is a 304",
        (await get(projectId, `?after=arkaik:${E4}`, inm(caughtUpTag))).status === 304,
      );

      // No existence oracle through the conditional path.
      check(
        "another owner's token with If-None-Match: * → 404",
        (await get(projectId, "", { ...bearer(tokenB.plaintext), "if-none-match": "*" })).status === 404,
      );
      check("feed-less project with If-None-Match: * → 404", (await get(plainId, "", inm("*"))).status === 404);
      check(
        "unknown cursor beats If-None-Match: * → 410",
        (await get(projectId, "?after=arkaik:NOPE", inm("*"))).status === 410,
      );
      check(
        "a cursor on an event the feed never serves is unknown too → 410",
        (await get(projectId, `?after=arkaik:${E3}`, inm("*"))).status === 410,
      );

      // A journal-only append (what a merged PR's Lab Note does) moves it.
      await client.query(
        `insert into graph_events (id, project_id, event, actor) values ($1, $2, $3, $4)`,
        [E5, projectId, JSON.stringify({ id: E5, ts: "2026-08-14T10:00:00.000Z", actor: "arkaik-cli", type: "release.tagged", version: "1.1.0" }), "graphtest"],
      );
      const moved = await get(projectId, `?after=arkaik:${E4}`, inm(caughtUpTag));
      check("an appended event turns the next poll into a 200", moved.status === 200, String(moved.status));
      check("…with a new ETag", moved.headers.get("etag") !== caughtUpTag);
      const movedBody = await moved.json();
      check("…whose body is exactly the new envelope", movedBody.pollen.map((p) => p.id).join(",") === `arkaik:${E5}`, JSON.stringify(movedBody));

      check("no path loaded the bundle or the journal body", loads.length === 0, loads.join(","));
    } finally {
      api.store.getProject = realGetProject;
      api.store.getJournal = realGetJournal;
    }
  } finally {
    await cleanup(client);
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`\n${failures} pollen feed test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll pollen feed tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

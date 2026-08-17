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
 *   - auth is the ordinary graph read plane (401 / 403 / cross-owner 404).
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

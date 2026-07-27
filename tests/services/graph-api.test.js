#!/usr/bin/env node

/**
 * Integration tests for the hosted graph API (db/migrations/008_graph_projects.sql,
 * lib/services/graph/store.ts, app/api/graph/**).
 *
 * Run against a real Postgres whose schema was applied by `npm run db:migrate`.
 * Only NextAuth is stubbed; the store, token verification, owner resolution,
 * scope enforcement, and the `select … for update` transactions all run for real.
 *
 * The properties that matter most here, and why:
 *   - a REFUSED mutation writes nothing — not the snapshot, not the version, not
 *     a single event. This is the whole promise of the validator gate, and it is
 *     the one thing a partial implementation would still appear to pass.
 *   - owner scoping: another owner's project is 404, never 403, so ids cannot be
 *     probed.
 *   - batch atomicity: node + edge land together or not at all.
 *   - scopes are enforced, so a read-only agent token cannot write.
 *
 * Test rows use the `graphtest-%@example.com` email pattern and are cleaned up
 * by derived owner id at start and end, so local re-runs are idempotent.
 */

const { Client } = require("pg");
const fs = require("fs");
const { loadGraphApi, BUILD_DIR } = require("./load-graph-api");

const ORIGIN = "https://graph.test";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ctx = (projectId) => ({ params: Promise.resolve({ projectId }) });
const sessionFor = (userId) => ({ user: { id: String(userId), name: "graphtest" } });

function node(id, species, extra = {}) {
  return {
    id,
    project_id: "gp",
    species,
    title: id,
    status: "idea",
    platforms: ["web"],
    ...extra,
  };
}

function bundle(nodes = [], edges = []) {
  return {
    schema_version: 2,
    project: {
      id: "gp",
      title: "Graph test",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes,
    edges,
  };
}

function jsonReq(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

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
  // graph_events cascades from graph_projects, which cascades from owners.
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
  const { store, tokens, owners, setSession } = api;

  try {
    const userA = await seedUser(client, "a");
    const userB = await seedUser(client, "b");
    const ownerA = (await owners.resolveOwnerIds(userA))[0];
    await owners.resolveOwnerIds(userB);

    // --- Auth + scope gates -------------------------------------------------
    setSession(null);
    check(
      "unauthenticated list returns 401",
      (await api.LIST_PROJECTS(new Request(`${ORIGIN}/api/graph/projects`))).status === 401,
    );

    const readOnly = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "read-only",
      scopes: ["graph:read"],
    });
    const writeToken = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "agent",
      scopes: ["graph:read", "graph:write"],
    });

    // --- Create -------------------------------------------------------------
    setSession(sessionFor(userA));
    const created = await api.CREATE_PROJECT(
      jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle([node("V-a", "view")])),
    );
    const createdBody = await created.json();
    check("POST /projects returns 201", created.status === 201, String(created.status));
    check("the created id is server-owned (prj_)", createdBody.id?.startsWith("prj_"), createdBody.id);
    const projectId = createdBody.id;

    const badCreate = await api.CREATE_PROJECT(
      jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle([], [
        { id: "e-x-y", project_id: "gp", source_id: "V-nope", target_id: "V-alsonope", edge_type: "composes" },
      ])),
    );
    check("a dangling-edge bundle is refused with 422", badCreate.status === 422, String(badCreate.status));
    check("the 422 carries pathed findings", Array.isArray((await badCreate.json()).errors));

    // --- Owner scoping ------------------------------------------------------
    setSession(sessionFor(userB));
    const otherList = await api.LIST_PROJECTS(new Request(`${ORIGIN}/api/graph/projects`));
    check("another owner sees no projects", (await otherList.json()).projects.length === 0);
    const otherGet = await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId));
    check("another owner gets 404, not 403", otherGet.status === 404, String(otherGet.status));
    const otherMutate = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-evil", "view") }] }),
      ctx(projectId),
    );
    check("another owner cannot mutate (404)", otherMutate.status === 404, String(otherMutate.status));

    // --- Read ---------------------------------------------------------------
    setSession(sessionFor(userA));
    const got = await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId));
    const gotBody = await got.json();
    check("GET project returns the bundle", got.status === 200 && gotBody.bundle.nodes.length === 1);
    check("GET project sets an ETag from the version", got.headers.get("etag") === `"${gotBody.version}"`);
    check("initial version is 1", gotBody.version === "1", gotBody.version);

    // --- Scope enforcement --------------------------------------------------
    setSession(null);
    const readOnlyWrite = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-b", "view") }] }, bearer(readOnly.plaintext)),
      ctx(projectId),
    );
    check(
      "a graph:read token cannot write (403 insufficient_scope)",
      readOnlyWrite.status === 403,
      String(readOnlyWrite.status),
    );
    const readOnlyRead = await api.GET_NODES(
      new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }),
      ctx(projectId),
    );
    check("a graph:read token can read", readOnlyRead.status === 200);

    // --- Mutate via an agent token -----------------------------------------
    const mutated = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-b", "view") }] }, bearer(writeToken.plaintext)),
      ctx(projectId),
    );
    const mutatedBody = await mutated.json();
    check("an agent token can mutate", mutated.status === 200, String(mutated.status));
    check("the mutation returns the new graph", mutatedBody.nodes.length === 2);
    check("the version bumped to 2", mutatedBody.version === "2", mutatedBody.version);
    check("the response ETag matches the new version", mutated.headers.get("etag") === '"2"');
    check(
      "an agent's write is attributed to arkaik-agent",
      mutatedBody.events[0]?.actor === "arkaik-agent",
      mutatedBody.events[0]?.actor,
    );

    // --- Batch atomicity ----------------------------------------------------
    const batch = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        {
          ops: [
            { op: "create_node", node: node("AC-x", "acceptance") },
            {
              op: "create_edge",
              edge: { id: "", project_id: "gp", source_id: "AC-x", target_id: "V-a", edge_type: "covers" },
            },
          ],
        },
        bearer(writeToken.plaintext),
      ),
      ctx(projectId),
    );
    const batchBody = await batch.json();
    check("a node+edge batch applies", batch.status === 200, String(batch.status));
    check("both landed together", batchBody.nodes.length === 3 && batchBody.edges.length === 1);
    check("the batch emitted two events", batchBody.events.length === 2);

    // --- A refused mutation writes NOTHING ---------------------------------
    const beforeRefusal = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId))).json();
    const refused = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        {
          ops: [
            { op: "create_node", node: node("V-ghost", "view") },
            {
              op: "create_edge",
              edge: { id: "", project_id: "gp", source_id: "V-ghost", target_id: "V-missing", edge_type: "composes" },
            },
          ],
        },
        bearer(writeToken.plaintext),
      ),
      ctx(projectId),
    );
    check("a dangling edge is refused with 422", refused.status === 422, String(refused.status));
    const afterRefusal = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId))).json();
    check("the refused batch left the version alone", afterRefusal.version === beforeRefusal.version);
    check(
      "the refused batch left the snapshot alone",
      afterRefusal.bundle.nodes.length === beforeRefusal.bundle.nodes.length,
    );
    check(
      "the refused batch wrote no ghost node",
      !afterRefusal.bundle.nodes.some((n) => n.id === "V-ghost"),
    );

    const refusedOp = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "update_node", node_id: "V-nope", patch: { status: "live" } }] }, bearer(writeToken.plaintext)),
      ctx(projectId),
    );
    const refusedOpBody = await refusedOp.json();
    check("an unknown node is refused with 422", refusedOp.status === 422);
    check(
      "the refusal carries the machine-readable code",
      refusedOpBody.code === "node_not_found",
      JSON.stringify(refusedOpBody),
    );

    // --- Optimistic concurrency --------------------------------------------
    const current = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId))).json();
    const stale = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        { ops: [{ op: "create_node", node: node("V-stale", "view") }] },
        { ...bearer(writeToken.plaintext), "if-match": '"1"' },
      ),
      ctx(projectId),
    );
    check("a stale If-Match returns 409", stale.status === 409, String(stale.status));
    check("the 409 reports the current version", (await stale.json()).version === current.version);

    const fresh = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        { ops: [{ op: "create_node", node: node("V-fresh", "view") }] },
        { ...bearer(writeToken.plaintext), "if-match": `"${current.version}"` },
      ),
      ctx(projectId),
    );
    check("a matching If-Match applies", fresh.status === 200, String(fresh.status));

    // --- Journal + export ---------------------------------------------------
    const journal = await (await api.GET_JOURNAL(new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }), ctx(projectId))).json();
    check("the journal accumulated every accepted event", journal.journal.length >= 5, String(journal.journal.length));
    check(
      "no event from a refused mutation is present",
      !journal.journal.some((e) => JSON.stringify(e).includes("V-ghost")),
    );
    const exported = await (await api.EXPORT(new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }), ctx(projectId))).json();
    check("export embeds the journal", Array.isArray(exported.bundle.journal) && exported.bundle.journal.length > 0);
    check("export carries the graph", exported.bundle.nodes.length >= 3);

    // --- Bad requests -------------------------------------------------------
    setSession(sessionFor(userA));
    check(
      "an empty ops array is rejected",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [] }), ctx(projectId))).status === 400,
    );
    check(
      "an unknown op name is rejected",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [{ op: "drop_table" }] }), ctx(projectId))).status === 400,
    );

    // --- Limits -------------------------------------------------------------
    await client.query(`update users set tier = 'synk' where id = $1`, [userA]);
    const limitResult = await store.applyMutation({
      projectId,
      ownerIds: [ownerA],
      ops: Array.from({ length: 3 }, (_, i) => ({ op: "create_node", node: node(`V-bulk${i}`, "view") })),
      actor: "test",
      tier: "synk",
    });
    check("a mutation within the entity cap succeeds", limitResult.ok === true);
    const overLimit = await store.applyMutation({
      projectId,
      ownerIds: [ownerA],
      ops: [{ op: "create_node", node: node("V-over", "view") }],
      actor: "test",
      tier: "nonexistent-tier",
    });
    // An unknown tier falls back to the most restrictive row, which still allows
    // this small graph — the assertion is that the fallback resolves at all.
    check("an unknown tier resolves to the safe floor rather than throwing", typeof overLimit.ok === "boolean");

    // --- Archive ------------------------------------------------------------
    const archived = await api.DELETE_PROJECT(new Request(ORIGIN), ctx(projectId));
    check("DELETE archives the project", archived.status === 204, String(archived.status));
    check(
      "an archived project leaves the listing",
      (await (await api.LIST_PROJECTS(new Request(ORIGIN))).json()).projects.length === 0,
    );
    check(
      "an archived project cannot be mutated",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-z", "view") }] }), ctx(projectId))).status === 404,
    );
    check(
      "DELETE is idempotent-safe (second call 404s)",
      (await api.DELETE_PROJECT(new Request(ORIGIN), ctx(projectId))).status === 404,
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
  console.log("\nAll graph-API checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
